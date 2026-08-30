(() => {
  const previousController = globalThis.__plyphController;
  if (previousController?.dispose) {
    try { previousController.dispose(); } catch { /* The previous extension context may already be gone. */ }
  }

  const lifecycle = new AbortController();

  let snapshot = null;
  let toastTimer = null;
  let toastAnchorListeners = null;
  let pointerPosition = null;
  let triggerEnabled = true;
  let triggerTimer = null;
  let cachedActions = [];
  let feedbackPlacement = 'bottom';
  let extensionAlive = true;

  globalThis.__plyphController = {dispose: disposeController};
  delete globalThis.__plyphLoaded;

  function isContextInvalidation(error) {
    return (error?.message || String(error || '')).includes('Extension context invalidated');
  }

  function disposeController() {
    if (!extensionAlive && lifecycle.signal.aborted) return;
    extensionAlive = false;
    triggerEnabled = false;
    clearTimeout(triggerTimer);
    clearTimeout(toastTimer);
    lifecycle.abort();
    try { chrome.runtime.onMessage.removeListener(handleRuntimeMessage); } catch { /* Context already invalidated. */ }
    removeTrigger();
    closeDialog();
    removeToast();
  }

  globalThis.addEventListener('unhandledrejection', event => {
    if (!isContextInvalidation(event.reason)) return;
    event.preventDefault();
    disposeController();
  }, {signal: lifecycle.signal});

  try {
    chrome.runtime.sendMessage({type: 'GET_PAGE_CONFIG'}).then(values => {
      if (!extensionAlive) return;
      triggerEnabled = values.selectionTrigger !== false;
      feedbackPlacement = values.feedbackPlacement || 'bottom';
      cachedActions = enabledCustomActions(values.customActions);
      if (triggerEnabled) scheduleTriggerUpdate();
    }).catch(error => {
      if (isContextInvalidation(error)) disposeController();
    });
  } catch (error) {
    if (isContextInvalidation(error)) disposeController();
  }
  document.addEventListener('selectionchange', scheduleTriggerUpdate, {signal: lifecycle.signal});
  document.addEventListener('mouseup', scheduleTriggerUpdate, {signal: lifecycle.signal});
  document.addEventListener('keyup', scheduleTriggerUpdate, {signal: lifecycle.signal});
  document.addEventListener('pointermove', event => {
    pointerPosition = {x: event.clientX, y: event.clientY};
  }, {passive: true, signal: lifecycle.signal});
  document.addEventListener('pointerdown', event => {
    pointerPosition = {x: event.clientX, y: event.clientY};
  }, {passive: true, signal: lifecycle.signal});
  document.addEventListener('mousedown', event => {
    const trigger = document.getElementById('plyph-trigger');
    if (trigger && !event.composedPath().includes(trigger)) removeTrigger();
  }, {capture: true, signal: lifecycle.signal});
  window.addEventListener('scroll', () => removeTrigger(), {capture: true, signal: lifecycle.signal});
  window.addEventListener('resize', () => removeTrigger(), {signal: lifecycle.signal});
  window.addEventListener('pagehide', () => removeTrigger(), {signal: lifecycle.signal});

  function handleRuntimeMessage(message, _sender, sendResponse) {
    if (message.type === 'PING') { sendResponse({ok: true}); return; }
    if (message.type === 'CAPTURE_SELECTION') {
      const current = captureSelection();
      if (current?.text) snapshot = current;
      sendResponse({text: snapshot?.text || ''});
      return;
    }
    if (message.type === 'WORKING') { removeTrigger(); showToast('Working…', 'working'); }
    if (message.type === 'SHOW_ERROR') showToast(message.message, 'error', 4000);
    if (message.type === 'SHOW_RESULT') showResult(message.output);
    if (message.type === 'REPLACE_RESULT') replaceSelection(message.output, message.label);
    if (message.type === 'SET_PAGE_CONFIG') {
      cachedActions = enabledCustomActions(message.customActions);
      triggerEnabled = message.selectionTrigger !== false;
      feedbackPlacement = message.feedbackPlacement || 'bottom';
      if (triggerEnabled) scheduleTriggerUpdate(); else removeTrigger();
    }
  }

  try {
    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
  } catch (error) {
    if (isContextInvalidation(error)) disposeController();
  }

  function captureSelection() {
    const active = document.activeElement;
    if (active instanceof HTMLTextAreaElement || (active instanceof HTMLInputElement && /^(text|search|url|tel|email|password)$/i.test(active.type))) {
      const start = active.selectionStart ?? 0;
      const end = active.selectionEnd ?? start;
      return {kind: 'control', element: active, start, end, text: active.value.slice(start, end)};
    }
    const selection = window.getSelection();
    if (selection?.rangeCount && !selection.isCollapsed) {
      return {kind: 'range', range: selection.getRangeAt(0).cloneRange(), text: selection.toString()};
    }
    return null;
  }

  function scheduleTriggerUpdate() {
    if (!extensionAlive) return;
    clearTimeout(triggerTimer);
    triggerTimer = setTimeout(updateTrigger, 90);
  }

  function updateTrigger() {
    if (!extensionAlive || !triggerEnabled || document.getElementById('plyph-host')) return removeTrigger();
    const current = captureSelection();
    if (!current?.text?.trim()) return removeTrigger();
    snapshot = current;
    const rect = selectionRect(current);
    if (!rect || (!rect.width && !rect.height)) return removeTrigger();
    if (rect.bottom < -20 || rect.top > window.innerHeight + 20 || rect.right < -20 || rect.left > window.innerWidth + 20) {
      return removeTrigger();
    }
    showTrigger(rect);
  }

  function selectionRect(selection) {
    if (selection.kind === 'range') {
      const rects = selection.range.getClientRects();
      if (rects.length > 0) {
        const last = rects[rects.length - 1];
        if (last && (last.width || last.height)) {
          return {
            left: last.left,
            right: last.right,
            top: last.top,
            bottom: last.bottom,
            width: last.width,
            height: last.height,
          };
        }
      }
      const rect = selection.range.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    }
    return controlCaretRect(selection.element, selection.end);
  }

  function controlCaretRect(element, position) {
    const style = getComputedStyle(element);
    const mirror = document.createElement('div');
    const properties = [
      'direction', 'boxSizing', 'width', 'overflowX', 'overflowY',
      'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
      'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
      'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize',
      'lineHeight', 'fontFamily', 'textAlign', 'textTransform', 'textIndent',
      'letterSpacing', 'wordSpacing', 'tabSize', 'whiteSpace', 'wordBreak', 'overflowWrap',
    ];
    Object.assign(mirror.style, {
      position: 'absolute',
      visibility: 'hidden',
      top: '0',
      left: '-9999px',
      height: 'auto',
      whiteSpace: element instanceof HTMLInputElement ? 'pre' : 'pre-wrap',
      overflowWrap: 'break-word',
      wordBreak: 'break-word',
    });
    for (const property of properties) {
      if (style[property]) mirror.style[property] = style[property];
    }
    mirror.textContent = element.value.slice(0, position);
    const marker = document.createElement('span');
    marker.textContent = '\u200B';
    mirror.append(marker);
    document.body.append(mirror);

    const elementRect = element.getBoundingClientRect();
    const markerLeft = marker.offsetLeft;
    const markerTop = marker.offsetTop;
    const lineHeight = Number.parseFloat(style.lineHeight) || (Number.parseFloat(style.fontSize) * 1.2) || 16;
    mirror.remove();

    return {
      left: elementRect.left + markerLeft - element.scrollLeft,
      right: elementRect.left + markerLeft - element.scrollLeft,
      top: elementRect.top + markerTop - element.scrollTop,
      bottom: elementRect.top + markerTop - element.scrollTop + lineHeight,
      width: 1,
      height: lineHeight,
    };
  }

  function getElementLuminance(element) {
    let el = element instanceof HTMLElement ? element : (element?.parentElement || document.body);
    while (el && el !== document.documentElement) {
      const bg = window.getComputedStyle(el).backgroundColor;
      if (bg && bg !== 'transparent' && !bg.includes('rgba(0, 0, 0, 0)')) {
        const match = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (match) {
          const r = Number(match[1]), g = Number(match[2]), b = Number(match[3]);
          return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        }
      }
      el = el.parentElement;
    }
    const bodyBg = window.getComputedStyle(document.body).backgroundColor;
    const match = bodyBg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (match && !bodyBg.includes('rgba(0, 0, 0, 0)')) {
      return (0.2126 * Number(match[1]) + 0.7152 * Number(match[2]) + 0.0722 * Number(match[3])) / 255;
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 0.1 : 0.9;
  }

  function showTrigger(rect) {
    let host = document.getElementById('plyph-trigger');
    const targetElement = snapshot?.element || (snapshot?.range?.startContainer instanceof HTMLElement ? snapshot?.range?.startContainer : snapshot?.range?.startContainer?.parentElement);
    const isDark = getElementLuminance(targetElement) < 0.5;

    if (!host) {
      host = document.createElement('div');
      host.id = 'plyph-trigger';
      const root = host.attachShadow({mode: 'open'});
      root.innerHTML = `
        <style>
          :host { all: initial; }
          .wrapper {
            display: inline-flex;
            position: relative;
            font-family: system-ui, -apple-system, sans-serif;
          }
          .wrapper.theme-light {
            --surface: #ffffff;
            --hover: #f1f3f7;
            --text: #1f2328;
            --icon-color: #1a1a1a;
            --muted: #656d76;
            --border: #d0d7de;
            --shadow: 0 3px 10px rgba(0, 0, 0, 0.18), 0 1px 3px rgba(0, 0, 0, 0.08);
          }
          .wrapper.theme-dark {
            --surface: #21262d;
            --hover: #30363d;
            --text: #f0f6fc;
            --icon-color: #ffffff;
            --muted: #8b949e;
            --border: #383e47;
            --shadow: 0 4px 14px rgba(0, 0, 0, 0.5), 0 1px 4px rgba(0, 0, 0, 0.25);
          }
          .dot {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 26px;
            height: 26px;
            padding: 0;
            border: 1px solid var(--border);
            border-radius: 50%;
            background: var(--surface);
            box-shadow: var(--shadow);
            cursor: pointer;
            transition: transform 0.12s ease, background 0.12s ease;
            box-sizing: border-box;
          }
          .dot:hover, .dot[aria-expanded="true"] {
            background: var(--hover);
            transform: scale(1.06);
          }
          .dot:active {
            transform: scale(0.96);
          }
          .dot-icon {
            display: block;
            width: 17px;
            height: 17px;
            pointer-events: none;
            user-select: none;
          }
          .menu {
            position: absolute;
            top: 32px;
            right: 0;
            width: 220px;
            max-width: calc(100vw - 16px);
            padding: 5px;
            border: 1px solid var(--border);
            border-radius: 10px;
            background: var(--surface);
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
            display: flex;
            flex-direction: column;
            z-index: 10;
            box-sizing: border-box;
          }
          .menu.align-left {
            left: 0;
            right: auto;
          }
          .menu.above {
            top: auto;
            bottom: 32px;
          }
          .menu[hidden] { display: none; }
          .item {
            width: 100%;
            min-height: 29px;
            padding: 5px 9px;
            border: 0;
            border-radius: 6px;
            background: transparent;
            color: var(--text);
            font: 13.5px/1.35 system-ui, -apple-system, sans-serif;
            text-align: left;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            box-sizing: border-box;
          }
          .item:hover, .item:focus {
            background: var(--hover);
            outline: 0;
          }
          .glyph {
            display: flex;
            flex: 0 0 16px;
            width: 16px;
            height: 16px;
            color: var(--muted);
          }
          .glyph svg {
            width: 16px;
            height: 16px;
            fill: none;
            stroke: currentColor;
            stroke-width: 1.7;
            stroke-linecap: round;
            stroke-linejoin: round;
          }
          .glyph .filled { fill: currentColor; stroke: none; }
          .label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
          .separator { height: 1px; margin: 4px 8px; background: var(--border); }
        </style>
        <div class="wrapper ${isDark ? 'theme-dark' : 'theme-light'}">
          <button class="dot" title="Plyph actions" aria-label="Open Plyph actions" aria-expanded="false">
            <svg class="dot-icon" viewBox="0 0 1024 1024" role="img" aria-label="Plyph logo">
              <path d="M 512 156 C 496 257 458 365 401 455 C 349 537 286 607 220 660 C 302 636 368 637 419 675 C 465 709 493 755 512 800 C 531 755 559 709 605 675 C 656 637 722 636 804 660 C 738 607 675 537 623 455 C 566 365 528 257 512 156 Z" fill="var(--icon-color)"/>
              <path d="M 512 405 C 461 405 424 439 424 487 C 424 539 444 594 468 650 C 490 702 505 751 512 800 C 509 757 507 714 511 678 C 516 635 532 612 559 586 C 589 557 600 527 600 488 C 600 440 563 405 512 405 Z" fill="var(--surface)"/>
              <circle cx="512" cy="493" r="37" fill="var(--icon-color)"/>
            </svg>
          </button>
          <div class="menu" role="menu" hidden></div>
        </div>`;
      document.documentElement.append(host);
      const dot = root.querySelector('.dot');
      dot.addEventListener('mousedown', event => event.preventDefault());
      dot.addEventListener('click', () => toggleTriggerMenu(root));
      root.addEventListener('keydown', event => { if (event.key === 'Escape') removeTrigger(); });
    } else {
      const wrapper = host.shadowRoot.querySelector('.wrapper');
      if (wrapper) {
        wrapper.className = `wrapper ${isDark ? 'theme-dark' : 'theme-light'}`;
      }
    }
    const x = Math.min(window.innerWidth - 32, Math.max(6, rect.right + 5));
    const y = Math.min(window.innerHeight - 32, Math.max(6, rect.bottom + 5));
    host.style.setProperty('position', 'fixed', 'important');
    host.style.setProperty('z-index', '2147483646', 'important');
    host.style.setProperty('left', `${x}px`, 'important');
    host.style.setProperty('top', `${y}px`, 'important');
    updateMenuPosition(host.shadowRoot?.querySelector('.menu'), x, y);
  }

  function updateMenuPosition(menu, x, y) {
    if (!menu) return;
    const MENU_WIDTH = 220;
    const MENU_HEIGHT = 260;
    menu.classList.toggle('align-left', x < MENU_WIDTH);
    menu.classList.toggle('above', y > window.innerHeight - MENU_HEIGHT);
  }

  function enabledCustomActions(actions) {
    return Array.isArray(actions)
      ? actions.filter(action => action?.enabled !== false && action?.name?.trim())
      : [];
  }

  function hasExtensionContext() {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  }

  function toggleTriggerMenu(root) {
    if (!extensionAlive || !hasExtensionContext()) return removeTrigger();
    const menu = root.querySelector('.menu');
    const dot = root.querySelector('.dot');
    if (!menu.hidden) { menu.hidden = true; dot.setAttribute('aria-expanded', 'false'); return; }
    const host = document.getElementById('plyph-trigger');
    const x = parseFloat(host?.style.left) || 0;
    const y = parseFloat(host?.style.top) || 0;
    updateMenuPosition(menu, x, y);
    const actions = [
      {name: 'Correct selected text', mode: 'correct'},
      {name: 'Rewrite selected text', mode: 'rewrite'},
      {name: 'Run selected prompt', mode: 'prompt'},
      ...cachedActions.map(action => ({name: action.name, mode: 'custom', actionId: action.id})),
    ];
    menu.replaceChildren();
    actions.forEach((action, index) => {
      if (index === 3) { const separator = document.createElement('div'); separator.className = 'separator'; menu.append(separator); }
      const button = document.createElement('button');
      button.className = 'item'; button.type = 'button'; button.setAttribute('role', 'menuitem');
      button.innerHTML = `<span class="glyph" aria-hidden="true">${triggerActionIcon(action.mode)}</span><span class="label"></span>`;
      button.querySelector('.label').textContent = action.name;
      button.addEventListener('mousedown', event => event.preventDefault());
      button.addEventListener('click', () => {
        if (!extensionAlive || !hasExtensionContext()) return removeTrigger();
        menu.hidden = true;
        dot.setAttribute('aria-expanded', 'false');
        try {
          chrome.runtime.sendMessage({
            type: 'RUN_ACTION_FROM_PAGE',
            action,
            text: snapshot?.text || '',
          }, response => {
            try {
              if (chrome.runtime.lastError) {
                removeTrigger();
                return;
              }
              if (!extensionAlive) return;
              if (!response?.ok)
                showToast(response?.error || 'Could not run this action.', 'error', 4000);
            } catch (error) {
              if (isContextInvalidation(error)) disposeController();
              removeTrigger();
            }
          });
        } catch {
          removeTrigger();
        }
      });
      menu.append(button);
    });
    menu.hidden = false;
    dot.setAttribute('aria-expanded', 'true');
  }

  function triggerActionIcon(mode) {
    if (mode === 'correct') return '<svg viewBox="0 0 20 20"><path d="m4 10 3.2 3.2L16 4.8"/></svg>';
    if (mode === 'rewrite') return '<svg viewBox="0 0 20 20"><path d="M15.5 7A6 6 0 1 0 16 12"/><path d="M12 3h4v4"/></svg>';
    if (mode === 'prompt') return '<svg viewBox="0 0 20 20"><path class="filled" d="m7 4 8 6-8 6Z"/></svg>';
    return '<svg viewBox="0 0 20 20"><path d="m10 2 1.5 5.1L16.5 9l-5 1.9L10 16l-1.5-5.1L3.5 9l5-1.9Z"/></svg>';
  }

  function removeTrigger() {
    clearTimeout(triggerTimer);
    document.getElementById('plyph-trigger')?.remove();
  }

  function replaceSelection(text, label = 'Replaced') {
    if (!snapshot) { showToast('The original selection is no longer available.', 'error', 3500); return; }
    if (snapshot.kind === 'control' && snapshot.element?.isConnected) {
      const element = snapshot.element;
      element.focus();
      element.setSelectionRange(snapshot.start, snapshot.end);
      element.setRangeText(text, snapshot.start, snapshot.end, 'end');
      element.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertText', data: text}));
      element.dispatchEvent(new Event('change', {bubbles: true}));
    } else if (snapshot.kind === 'range') {
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(snapshot.range);
      if (!document.execCommand('insertText', false, text)) {
        snapshot.range.deleteContents();
        const node = document.createTextNode(text);
        snapshot.range.insertNode(node);
        snapshot.range.setStartAfter(node);
        snapshot.range.collapse(true);
      }
    } else {
      showToast('The original field is no longer available.', 'error', 3500);
      return;
    }
    const completedSelection = snapshot;
    snapshot = null;
    closeDialog();
    showToast(`${label}. Use the page’s undo command to revert.`, 'normal', 1800, completedSelection);
  }

  function showResult(output) {
    removeToast();
    clearTimeout(toastTimer);
    closeDialog();
    const host = document.createElement('div');
    host.id = 'plyph-host';
    const root = host.attachShadow({mode: 'open'});

    root.innerHTML = `
      <style>
        :host {
          all: initial;
          --pp-bg: #ffffff;
          --pp-text: #111827;
          --pp-muted: #6b7280;
          --pp-border: #e5e7eb;
          --pp-card-bg: #f9fafb;
          --pp-card-border: #e5e7eb;
          --pp-btn-sec-bg: #f3f4f6;
          --pp-btn-sec-text: #374151;
          --pp-btn-sec-border: #e5e7eb;
          --pp-btn-sec-hover: #e5e7eb;
          --pp-btn-pri-bg: #1f2937;
          --pp-btn-pri-text: #ffffff;
          --pp-btn-pri-hover: #111827;
          --pp-focus-ring: rgba(31, 41, 55, 0.15);
        }

        @media (prefers-color-scheme: dark) {
          :host {
            --pp-bg: #1d1e21;
            --pp-text: #f3f4f6;
            --pp-muted: #9ca3af;
            --pp-border: rgba(255, 255, 255, 0.08);
            --pp-card-bg: #161719;
            --pp-card-border: rgba(255, 255, 255, 0.09);
            --pp-btn-sec-bg: #27282c;
            --pp-btn-sec-text: #e5e7eb;
            --pp-btn-sec-border: rgba(255, 255, 255, 0.08);
            --pp-btn-sec-hover: #313338;
            --pp-btn-pri-bg: #808086;
            --pp-btn-pri-text: #141517;
            --pp-btn-pri-hover: #96969d;
            --pp-focus-ring: rgba(255, 255, 255, 0.12);
          }
        }

        @keyframes ppFade {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes ppZoom {
          from { opacity: 0; transform: scale(0.97); }
          to { opacity: 1; transform: scale(1); }
        }

        .backdrop {
          position: fixed;
          inset: 0;
          z-index: 2147483647;
          background: rgba(0, 0, 0, 0.5);
          backdrop-filter: blur(4px);
          -webkit-backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          box-sizing: border-box;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, Helvetica, Arial, sans-serif;
          color: var(--pp-text);
          animation: ppFade 0.15s ease-out forwards;
        }

        .dialog {
          width: min(540px, calc(100vw - 32px));
          background: var(--pp-bg);
          border: 1px solid var(--pp-border);
          border-radius: 14px;
          padding: 20px 22px;
          box-shadow: 0 20px 50px -10px rgba(0, 0, 0, 0.45), 0 0 1px 1px var(--pp-border);
          display: flex;
          flex-direction: column;
          box-sizing: border-box;
          animation: ppZoom 0.18s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          transition: width 0.22s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .dialog.expanded {
          width: min(860px, calc(100vw - 32px));
        }

        .dialog-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 14px;
        }

        .header-left {
          display: flex;
          align-items: baseline;
          gap: 9px;
        }

        .dialog-title {
          font-size: 15px;
          font-weight: 600;
          letter-spacing: -0.01em;
          color: var(--pp-text);
          margin: 0;
        }

        .header-divider {
          color: var(--pp-muted);
          opacity: 0.4;
          font-size: 13px;
          user-select: none;
        }

        .muted-counter {
          font-size: 13px;
          color: var(--pp-muted);
          font-weight: 400;
        }

        .btn-expand {
          background: none;
          border: none;
          color: var(--pp-muted);
          cursor: pointer;
          padding: 4px 6px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s ease;
        }

        .btn-expand:hover {
          color: var(--pp-text);
          background: var(--pp-btn-sec-bg);
        }

        .card {
          background: var(--pp-card-bg);
          border: 1px solid var(--pp-card-border);
          border-radius: 10px;
          padding: 12px 14px;
          display: flex;
          flex-direction: column;
          box-sizing: border-box;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }

        .card:focus-within {
          border-color: var(--pp-muted);
          box-shadow: 0 0 0 2px var(--pp-focus-ring);
        }

        .card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
        }

        .btn-card-action {
          background: none;
          border: none;
          color: var(--pp-muted);
          font-size: 13px;
          font-family: inherit;
          cursor: pointer;
          padding: 2px 4px;
          border-radius: 4px;
          transition: color 0.15s ease;
        }

        .btn-card-action:hover {
          color: var(--pp-text);
        }

        .btn-card-action.active {
          color: var(--pp-text);
          font-weight: 600;
        }

        textarea {
          width: 100%;
          min-height: 180px;
          max-height: 48vh;
          resize: vertical;
          border: none;
          background: transparent;
          padding: 0;
          margin: 0;
          font-family: inherit;
          font-size: 14px;
          line-height: 1.6;
          color: var(--pp-text);
          box-sizing: border-box;
          outline: none;
          transition: min-height 0.22s ease;
        }

        .dialog.expanded textarea {
          min-height: 380px;
          max-height: 68vh;
        }

        textarea::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }

        textarea::-webkit-scrollbar-thumb {
          background: var(--pp-border);
          border-radius: 3px;
        }

        .dialog-footer {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          margin-top: 16px;
        }

        .btn {
          font-family: inherit;
          font-size: 13px;
          font-weight: 500;
          padding: 7px 16px;
          border-radius: 8px;
          border: 1px solid transparent;
          cursor: pointer;
          transition: all 0.15s ease;
          line-height: 1.3;
        }

        .btn:active {
          transform: scale(0.98);
        }

        .btn-secondary {
          background: var(--pp-btn-sec-bg);
          color: var(--pp-btn-sec-text);
          border-color: var(--pp-btn-sec-border);
        }

        .btn-secondary:hover {
          background: var(--pp-btn-sec-hover);
        }

        .btn-primary {
          background: var(--pp-btn-pri-bg);
          color: var(--pp-btn-pri-text);
          font-weight: 600;
        }

        .btn-primary:hover {
          background: var(--pp-btn-pri-hover);
        }
      </style>
      <div class="backdrop" role="presentation">
        <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="pp-title">
          <header class="dialog-header">
            <div class="header-left">
              <h2 id="pp-title" class="dialog-title">Preview</h2>
              <span class="header-divider">|</span>
              <span class="muted-counter count-text">0 words · 0 chars</span>
            </div>
            <button class="btn-expand" type="button" title="Expand preview size">
              <svg class="expand-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10 2h4v4M6 14H2v-4M14 2l-5.5 5.5M2 14l5.5-5.5"/>
              </svg>
            </button>
          </header>
          
          <div class="card">
            <div class="card-header">
              <button class="btn-card-action btn-wrap active" type="button" title="Toggle line wrapping">wrap</button>
              <button class="btn-card-action btn-strip-md strip-md" type="button" title="Remove markdown formatting">remove markdown</button>
            </div>
            <textarea aria-label="Generated result" spellcheck="false"></textarea>
          </div>

          <div class="dialog-footer">
            <button class="btn btn-secondary cancel" type="button">Cancel</button>
            <button class="btn btn-secondary copy" type="button">Copy</button>
            <button class="btn btn-primary replace" type="button">Replace</button>
          </div>
        </section>
      </div>`;

    document.documentElement.append(host);
    const textarea = root.querySelector('textarea');
    textarea.value = output;
    updateCount(root, output);
    textarea.addEventListener('input', () => updateCount(root, textarea.value));

    const expandBtn = root.querySelector('.btn-expand');
    const dialog = root.querySelector('.dialog');
    const expandIcon = expandBtn?.querySelector('svg');
    let isExpanded = false;
    expandBtn?.addEventListener('click', () => {
      isExpanded = !isExpanded;
      dialog?.classList.toggle('expanded', isExpanded);
      if (expandBtn) expandBtn.title = isExpanded ? 'Collapse preview size' : 'Expand preview size';
      if (expandIcon) {
        expandIcon.innerHTML = isExpanded
          ? '<path d="M14 6h-4V2M2 10h4v4M10 6l5-5M6 10l-5 5"/>'
          : '<path d="M10 2h4v4M6 14H2v-4M14 2l-5.5 5.5M2 14l5.5-5.5"/>';
      }
    });

    const wrapBtn = root.querySelector('.btn-wrap');
    let isWrapped = true;
    wrapBtn?.addEventListener('click', () => {
      isWrapped = !isWrapped;
      textarea.wrap = isWrapped ? 'soft' : 'off';
      wrapBtn.classList.toggle('active', isWrapped);
      wrapBtn.title = isWrapped ? 'Disable line wrapping' : 'Enable line wrapping';
    });
    
    const stripButton = root.querySelector('.strip-md');
    if (stripButton) {
      stripButton.addEventListener('click', () => {
        const cleaned = stripMarkdown(textarea.value);
        if (cleaned !== textarea.value) {
          textarea.value = cleaned;
          updateCount(root, cleaned);
          stripButton.classList.add('active');
          stripButton.textContent = 'removed markdown';
          setTimeout(() => {
            stripButton.classList.remove('active');
            stripButton.textContent = 'remove markdown';
          }, 1500);
        }
      });
    }

    root.querySelector('.cancel')?.addEventListener('click', closeDialog);
    
    const copyButton = root.querySelector('.copy');
    copyButton?.addEventListener('click', () => {
      copyResult(textarea)
        .then(() => {
          showToast('Copied');
          if (copyButton) {
            const orig = copyButton.textContent;
            copyButton.textContent = 'Copied';
            setTimeout(() => { copyButton.textContent = orig; }, 1500);
          }
        })
        .catch(error => showToast(error.message || 'Could not copy the result.', 'error', 3500));
    });

    root.querySelector('.replace')?.addEventListener('click', () => replaceSelection(textarea.value));
    
    let backdropMouseDownTarget = null;
    const backdrop = root.querySelector('.backdrop');
    backdrop?.addEventListener('mousedown', event => {
      backdropMouseDownTarget = event.target;
    });
    backdrop?.addEventListener('click', event => {
      if (event.target === backdrop && backdropMouseDownTarget === backdrop) {
        closeDialog();
      }
      backdropMouseDownTarget = null;
    });

    root.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeDialog();
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') replaceSelection(textarea.value);
    });
    textarea.focus();
  }

  function updateCount(root, value) {
    const words = value.trim() ? value.trim().split(/\s+/u).length : 0;
    const countEl = root.querySelector('.count-text');
    if (countEl) {
      countEl.textContent = `${words} ${words === 1 ? 'word' : 'words'} · ${value.length} chars`;
    }
  }

  async function copyResult(textarea) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(textarea.value);
        return;
      } catch { /* HTTP pages need the user-activated fallback below. */ }
    }
    textarea.focus();
    textarea.select();
    if (!document.execCommand('copy')) throw new Error('Could not copy the result.');
  }

  function closeDialog() { document.getElementById('plyph-host')?.remove(); }

  function showToast(message, type = 'normal', duration = 1800, anchor = snapshot) {
    removeToast();
    const host = document.createElement('div');
    host.id = 'plyph-toast';
    const root = host.attachShadow({mode: 'open'});
    root.innerHTML = `<style>:host{all:initial}.toast{position:fixed;z-index:2147483647;left:50%;bottom:32px;transform:translateX(-50%);max-width:min(560px,calc(100vw - 40px));padding:13px 18px;border-radius:11px;background:#172033;color:#fff;box-shadow:0 12px 30px rgba(0,0,0,.25);font:600 15px/1.45 system-ui,sans-serif;text-align:center}.toast.error{background:#b42318}.working{padding-left:38px}.working:before{content:'';position:absolute;margin-left:-22px;margin-top:2px;width:13px;height:13px;border:2px solid #ffffff66;border-top-color:#fff;border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}</style><div class="toast"></div>`;
    const toast = root.querySelector('.toast');
    if (type === 'error') toast.classList.add('error');
    if (type === 'working') toast.classList.add('working');
    toast.textContent = message;
    document.documentElement.append(host);

    const placement = feedbackPlacement;
    const followsSelection = placement === 'pointer' && anchor;
    const followsMouse = placement === 'mouse' && pointerPosition;
    if (followsSelection || followsMouse) {
      const onMove = event => {
        if (event) pointerPosition = {x: event.clientX, y: event.clientY};
        positionToast(host, anchor, placement);
      };
      positionToast(host, anchor, placement);
      requestAnimationFrame(() => positionToast(host, anchor, placement));
      if (followsSelection) {
        window.addEventListener('scroll', onMove, {capture: true, passive: true});
        window.addEventListener('resize', onMove);
      }
      if (followsMouse) window.addEventListener('pointermove', onMove, {passive: true});
      toastAnchorListeners = () => {
        window.removeEventListener('scroll', onMove, {capture: true});
        window.removeEventListener('resize', onMove);
        window.removeEventListener('pointermove', onMove);
      };
    }
    if (type !== 'working') toastTimer = setTimeout(removeToast, duration);
  }

  function positionToast(host, selection, placement) {
    const toast = host.shadowRoot?.querySelector('.toast');
    if (!toast) return;
    const toastRect = toast.getBoundingClientRect();
    if (placement === 'mouse' && pointerPosition) {
      const gap = 14;
      let x = pointerPosition.x + gap;
      let y = pointerPosition.y + gap;
      if (x + toastRect.width > window.innerWidth - 6) x = pointerPosition.x - toastRect.width - gap;
      if (y + toastRect.height > window.innerHeight - 6) y = pointerPosition.y - toastRect.height - gap;
      setToastPosition(toast, x, y);
      return;
    }
    const rect = selection && selectionRect(selection);
    if (!rect) return;
    const x = rect.left + (rect.width - toastRect.width) / 2;
    const above = rect.top - toastRect.height - 10;
    const y = above >= 6 ? above : rect.bottom + 10;
    setToastPosition(toast, x, y);
  }

  function setToastPosition(toast, x, y) {
    const maxX = Math.max(6, window.innerWidth - toast.getBoundingClientRect().width - 6);
    const maxY = Math.max(6, window.innerHeight - toast.getBoundingClientRect().height - 6);
    toast.style.left = `${Math.max(6, Math.min(maxX, x))}px`;
    toast.style.top = `${Math.max(6, Math.min(maxY, y))}px`;
    toast.style.bottom = 'auto';
    toast.style.transform = 'none';
  }

  function removeToast() {
    clearTimeout(toastTimer);
    toastTimer = null;
    if (toastAnchorListeners) { toastAnchorListeners(); toastAnchorListeners = null; }
    document.getElementById('plyph-toast')?.remove();
  }

  function stripMarkdown(text) {
    let output = String(text || '');
    if (!output) return '';

    // 1. Fenced code blocks -> preserve code content
    output = output.replace(/^```[a-z0-9_-]*\s*\n?([\s\S]*?)\n?```$/gm, '$1');

    // 2. Inline code `code` -> code
    output = output.replace(/`([^`\n]+)`/g, '$1');

    // 3. Markdown links [text](url) -> text
    output = output.replace(/\[([^\]\n]+)\]\((?:https?:\/\/[^\s\)]+|#[^\s\)]+)\)/g, '$1');

    // 4. Images ![alt](url) -> alt
    output = output.replace(/!\[([^\]\n]*)\]\([^\s\)]+\)/g, '$1');

    // 5. ATX Headings # Title -> Title
    output = output.replace(/^(?:#{1,6})\s+(.+)$/gm, '$1');

    // 6. Blockquotes > text -> text
    output = output.replace(/^>\s+(.+)$/gm, '$1');

    // 7. Table separator lines |---|---| -> remove
    output = output.replace(/^\|(?:\s*:?-+:?\s*\|)+\s*$/gm, '');

    // 8. Table cell borders | cell | cell | -> cell   cell
    output = output.replace(/^\|\s*(.+?)\s*\|$/gm, (_m, row) => {
      return row.split('|').map(c => c.trim()).filter(Boolean).join('   ');
    });

    // 9. Word-bounded Bold **text** and __text__
    output = output.replace(/(?<=^|\s)\*\*([^*\n]+?)\*\*(?=\s|[.,!?;:)]|$)/g, '$1');
    output = output.replace(/(?<=^|\s)__([^_\n]+?)__(?=\s|[.,!?;:)]|$)/g, '$1');

    // 10. Word-bounded Italic *text* and _text_ (strictly avoiding snake_case_variables)
    output = output.replace(/(?<=^|\s)\*([^*\n]+?)\*(?=\s|[.,!?;:)]|$)/g, '$1');
    output = output.replace(/(?<=^|\s)_([^_\n]+?)_(?=\s|[.,!?;:)]|$)/g, '$1');

    // 11. Strikethrough ~~text~~
    output = output.replace(/(?<=^|\s)~~([^~\n]+?)~~(?=\s|[.,!?;:)]|$)/g, '$1');

    return output.trim();
  }
})();
