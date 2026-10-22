(() => {
  const previousController = globalThis.__plyphController;
  if (previousController?.dispose) {
    try { previousController.dispose(); } catch {  }
  }

  const lifecycle = new AbortController();

  let snapshot = null;
  let toastTimer = null;
  let toastAnchorListeners = null;
  let pointerPosition = null;
  let triggerEnabled = true;
  let triggerTimer = null;
  let cachedActions = [];
  let toolbarActionIds = ['ask', 'correct', 'rewrite', 'prompt'];
  let feedbackPlacement = 'bottom';
  let extensionAlive = true;
  let actionRunning = false;
  let dismissedSelection = null;
  let selectingPointer = false;
  let selectionGesture = 0;
  let triggerIntent = false;
  let selectionPoint = null;
  let selectionScope = null;
  let triggerWatch = null;
  const fieldSelectMark = new WeakMap();

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
    try { chrome.runtime.onMessage.removeListener(handleRuntimeMessage); } catch {  }
    removeTrigger();
    closeDialog();
    removeToast();
  }

  globalThis.addEventListener('unhandledrejection', event => {
    if (!isContextInvalidation(event.reason)) return;
    event.preventDefault();
    disposeController();
  }, {signal: lifecycle.signal});  function applyPageConfig(values) {
    if (Array.isArray(values.toolbarActions) && values.toolbarActions.length)
      toolbarActionIds = values.toolbarActions.filter(id => typeof id === 'string').slice(0, 4);
    cachedActions = enabledCustomActions(values.customActions);
    const host = document.getElementById('plyph-trigger');
    if (host?.shadowRoot) renderQuickActions(host.shadowRoot);
  }

  try {
    chrome.runtime.sendMessage({type: 'GET_PAGE_CONFIG'}).then(values => {
      if (!extensionAlive) return;
      triggerEnabled = values.selectionTrigger !== false;
      feedbackPlacement = values.feedbackPlacement || 'bottom';
      applyPageConfig(values);
      if (triggerEnabled) scheduleTriggerUpdate();
    }).catch(error => {
      if (isContextInvalidation(error)) disposeController();
    });
  } catch (error) {
    if (isContextInvalidation(error)) disposeController();
  }
  function isPlyphEvent(event) {
    return event.composedPath().some(node => node?.id === 'plyph-trigger' || node?.id === 'plyph-host');
  }

  function isSelectionKey(event) {
    return (event.shiftKey && /^(ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End|PageUp|PageDown)$/.test(event.key)) ||
      ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a');
  }

  document.addEventListener('selectionchange', event => {
    if (document.getElementById('plyph-host')) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && isTextField(active)) fieldSelectMark.set(active, selectionGesture);
    scheduleTriggerUpdate(event);
  }, {signal: lifecycle.signal});
  document.addEventListener('select', event => {
    if (event.target instanceof HTMLElement) fieldSelectMark.set(event.target, selectionGesture);
  }, {capture: true, signal: lifecycle.signal});
  function beginSelectionGesture(event) {
    if (isPlyphEvent(event)) return;
    noteSelectionGesture(event);
    removeTrigger(true);
    selectingPointer = event.button === 0 && event.isPrimary !== false;
    selectionScope = event.composedPath()[0]?.getRootNode?.();
    triggerIntent = selectingPointer;
    selectionPoint = null;
    if (triggerIntent) dismissedSelection = null;
  }

  function finishSelectionGesture(event) {
    if (isPlyphEvent(event) || event.button !== 0 || !selectingPointer) return;
    selectingPointer = false;
    triggerIntent = true;
    selectionPoint = {x: event.clientX, y: event.clientY};
    scheduleTriggerUpdate(event);
  }

  // Native text selection/dragging can cancel the mouse's pointer stream.
  // Like TWP, use mouseup for mouse selection; keep pointer events for touch/pen.
  document.addEventListener('mousedown', beginSelectionGesture, {capture: true, signal: lifecycle.signal});
  document.addEventListener('mouseup', finishSelectionGesture, {capture: true, signal: lifecycle.signal});
  document.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'mouse') beginSelectionGesture(event);
  }, {capture: true, signal: lifecycle.signal});
  document.addEventListener('pointerup', event => {
    if (event.pointerType !== 'mouse') finishSelectionGesture(event);
  }, {capture: true, signal: lifecycle.signal});
  document.addEventListener('pointercancel', event => {
    if (event.pointerType === 'mouse') return;
    selectingPointer = false;
    removeTrigger(true);
  }, {signal: lifecycle.signal});
  document.addEventListener('pointermove', event => {
    pointerPosition = {x: event.clientX, y: event.clientY};
  }, {passive: true, signal: lifecycle.signal});
  document.addEventListener('keydown', event => {
    if (isPlyphEvent(event)) return;
    // Let Tab reach the toolbar without collapsing it.
    if (event.key === 'Tab' && document.getElementById('plyph-trigger')) return;
    noteSelectionGesture(event);
    removeTrigger(true);
    triggerIntent = isSelectionKey(event);
    selectionScope = document.activeElement?.getRootNode();
    selectionPoint = null;
    if (triggerIntent) dismissedSelection = null;
  }, {capture: true, signal: lifecycle.signal});
  document.addEventListener('keyup', event => {
    if (isSelectionKey(event)) scheduleTriggerUpdate(event);
  }, {signal: lifecycle.signal});
  window.addEventListener('scroll', event => {
    const target = event.target;
    const node = snapshot?.element || snapshot?.range?.commonAncestorContainer;
    // Autocomplete panels and unrelated page widgets scroll independently.
    if (target === document || target === window || (node && target?.contains?.(node))) removeTrigger(true);
  }, {capture: true, passive: true, signal: lifecycle.signal});
  window.addEventListener('resize', refreshTriggerPosition, {signal: lifecycle.signal});
  window.visualViewport?.addEventListener('resize', refreshTriggerPosition, {signal: lifecycle.signal});
  window.visualViewport?.addEventListener('scroll', () => removeTrigger(true), {signal: lifecycle.signal});
  window.addEventListener('pagehide', () => removeTrigger(true), {signal: lifecycle.signal});
  window.addEventListener('blur', () => { selectingPointer = false; removeTrigger(true); }, {signal: lifecycle.signal});
  document.addEventListener('visibilitychange', () => { if (document.hidden) removeTrigger(true); }, {signal: lifecycle.signal});
  document.addEventListener('contextmenu', () => removeTrigger(true), {capture: true, signal: lifecycle.signal});

  function handleRuntimeMessage(message, _sender, sendResponse) {
    if (message.type === 'PING') { sendResponse({ok: true}); return; }
    if (message.type === 'CAPTURE_SELECTION') {
      if (passwordFieldFocused()) {
        snapshot = null;
        sendResponse({text: '', blocked: true});
        return;
      }
      // Page actions explicitly reuse the selection captured by our toolbar.
      // Shortcuts, context menus and the browser popup must read a fresh selection.
      const current = message.useSavedSelection ? snapshot : captureSelection();
      snapshot = current?.text?.trim() ? current : null;
      const editor = findEditorTarget(snapshot);
      if (editor) snapshot = {kind: 'editor', text: editor.text, replace: editor.replace};
      sendResponse({text: snapshot?.text || ''});
      return;
    }
    if (message.type === 'SHOW_ASK') { showAsk(message.text); sendResponse({ok: true}); return; }
    if (message.type === 'WORKING') { actionRunning = true; removeTrigger(); showToast('Working…', 'working'); }
    if (['SHOW_ERROR', 'SHOW_RESULT', 'REPLACE_RESULT'].includes(message.type)) actionRunning = false;
    if (message.type === 'SHOW_ERROR') showErrorDialog(message.message);
    if (message.type === 'SHOW_RESULT') showResult(message.output, message.original, message.showChanges);
    if (message.type === 'REPLACE_RESULT') {
      if (snapshot?.kind === 'editor' || snapshot?.kind === 'multi' || (snapshot?.kind === 'range' && !snapshot.range)) showResult(message.output, message.original, message.showChanges);
      else replaceSelection(message.output, message.label);
    }
    if (message.type === 'SET_PAGE_CONFIG') {
      applyPageConfig(message);
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

  function noteSelectionGesture(event) {
    try {
      if (event.composedPath().some(node => node?.id === 'plyph-trigger' || node?.id === 'plyph-host')) return;
    } catch { }
    selectionGesture++;
  }

  function passwordFieldFocused() {
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return active instanceof HTMLInputElement && active.type === 'password';
  }

  function isTextField(el) {
    if (el instanceof HTMLTextAreaElement) return true;
    if (el instanceof HTMLInputElement) return /^(text|search|url|tel|email)?$/i.test(el.type || '');
    return false;
  }

  function isVisibleField(el) {
    if (!isTextField(el)) return false;
    if (el.disabled) return false;
    if (el.closest('#plyph-trigger,#plyph-host')) return false;
    let style = null;
    try { style = getComputedStyle(el); } catch { return false; }
    if (!style || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    let rect = null;
    try { rect = el.getBoundingClientRect(); } catch { return false; }
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    if (rect.right < -2000 || rect.bottom < -2000) return false;
    return true;
  }

  function fieldSlice(el) {
    try {
      const start = el.selectionStart ?? 0;
      const end = el.selectionEnd ?? start;
      if (end <= start) return '';
      return el.value.slice(start, end);
    } catch { return ''; }
  }

  function elementOrder() {
    const order = new Map();
    let index = 0;
    try {
      const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT);
      let node = walker.currentNode;
      while (node) { order.set(node, index++); node = walker.nextNode(); }
    } catch { }
    return order;
  }

  function collectShadowTexts(scope, order, hostOrder, out) {
    let els = null;
    try { els = scope.querySelectorAll('*'); } catch { return; }
    for (const el of els) {
      if (!el.shadowRoot) continue;
      if (el.id === 'plyph-trigger' || el.id === 'plyph-host') continue;
      let text = '';
      try { text = el.shadowRoot.getSelection()?.toString() || ''; } catch { }
      const currentOrder = order.get(el) ?? hostOrder;
      if (text && text.trim()) {
        let rect = null;
        try { rect = el.getBoundingClientRect(); } catch { }
        out.push({order: currentOrder, text, rect});
      }
      collectShadowTexts(el.shadowRoot, order, currentOrder, out);
    }
  }

  function aggregateSelection() {
    const selection = window.getSelection();
    const hasRange = !!(selection?.rangeCount && !selection.isCollapsed);
    const rangeText = hasRange ? selection.toString() : '';
    const anchorEl = hasRange
      ? (selection.anchorNode instanceof Element ? selection.anchorNode : selection.anchorNode?.parentElement)
      : null;
    const focusEl = hasRange
      ? (selection.focusNode instanceof Element ? selection.focusNode : selection.focusNode?.parentElement)
      : null;
    const anchorField = anchorEl?.closest?.('textarea,input') || null;
    const anchorInField = !!(anchorField && isTextField(anchorField));
    const order = elementOrder();
    const parts = [];
    if (rangeText && rangeText.trim() && !anchorInField) {
      parts.push({order: order.get(anchorEl) ?? -1, text: rangeText, range: selection.getRangeAt(0).cloneRange()});
    }
    try {
      const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT);
      let node = walker.currentNode;
      while (node) {
        if (isVisibleField(node)) {
          const text = fieldSlice(node);
          if (text && text.trim()) {
            const isAnchor = anchorInField && node === anchorField;
            const fresh = fieldSelectMark.get(node) === selectionGesture;
            if (isAnchor) {
              parts.push({order: order.get(node) ?? -1, text, element: node, start: node.selectionStart ?? 0, end: node.selectionEnd ?? 0});
            } else if (fresh && (!rangeText || (focusEl && node.contains(focusEl)))) {
              parts.push({order: order.get(node) ?? -1, text, element: node, start: node.selectionStart ?? 0, end: node.selectionEnd ?? 0});
            }
          }
        }
        node = walker.nextNode();
      }
    } catch { }
    if (parts.length) {
      const shadowParts = [];
      collectShadowTexts(document, order, -1, shadowParts);
      for (const part of shadowParts) parts.push(part);
    }
    const usable = parts.filter(part => part.text && part.text.trim());
    if (!usable.length) return null;
    usable.sort((a, b) => a.order - b.order);
    if (usable.length === 1 && usable[0].range) {
      return {kind: 'range', range: usable[0].range, text: usable[0].text};
    }
    if (usable.length === 1 && usable[0].element) {
      return {kind: 'control', element: usable[0].element, start: usable[0].start, end: usable[0].end, text: usable[0].text};
    }
    if (usable.length === 1) {
      return {kind: 'range', range: null, rect: usable[0].rect || null, text: usable[0].text};
    }
    return {kind: 'multi', fragments: usable, text: usable.map(part => part.text).join('\n')};
  }

  function bridgeRequest(payload) {
    let response = null;
    const onResponse = event => { response = event.detail; };
    document.addEventListener('plyph:editor-response', onResponse);
    try {
      document.dispatchEvent(new CustomEvent('plyph:editor-request', {detail: payload}));
    } catch { }
    document.removeEventListener('plyph:editor-response', onResponse);
    return response;
  }

  function snapshotInEditor(snap) {
    try {
      if (snap?.kind === 'control' && snap.element?.closest?.('.ace_editor,.CodeMirror,.monaco-editor')) return true;
      if (snap?.kind === 'range' && snap.range) {
        const at = node => node instanceof Element ? node : node?.parentElement;
        const start = at(snap.range.startContainer), end = at(snap.range.endContainer);
        if (start?.closest?.('.ace_editor,.CodeMirror,.monaco-editor')) return true;
        if (end?.closest?.('.ace_editor,.CodeMirror,.monaco-editor')) return true;
      }
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.closest('.ace_editor,.CodeMirror,.monaco-editor')) return true;
    } catch { }
    return false;
  }

  function findEditorTarget(snap) {
    try {
      if (!snapshotInEditor(snap)) return null;
      const response = bridgeRequest({op: 'read'});
      const texts = response?.ok && Array.isArray(response.texts)
        ? response.texts.filter(text => typeof text === 'string' && text.trim())
        : [];
      if (!texts.length) return null;
      return {text: texts.join('\n'), replace: value => bridgeRequest({op: 'replace', text: value})?.ok === true};
    } catch { return null; }
  }

  function captureSelection() {
    if (passwordFieldFocused()) { snapshot = null; return null; }
    try {
      const aggregated = aggregateSelection();
      if (aggregated?.text?.trim()) return aggregated;
    } catch { }
    return legacyCaptureSelection();
  }

  function legacyCaptureSelection() {
    const active = document.activeElement;
    if (active instanceof HTMLTextAreaElement || (active instanceof HTMLInputElement && /^(text|search|url|tel|email)$/i.test(active.type))) {
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

  function scheduleTriggerUpdate(event) {
    if (!extensionAlive || event?.composedPath().some(node => node?.id === 'plyph-trigger' || node?.id === 'plyph-host')) return;
    clearTimeout(triggerTimer);
    if (!triggerIntent) return;
    triggerTimer = setTimeout(updateTrigger, 180);
  }

  function updateTrigger() {
    if (!extensionAlive || !triggerEnabled || actionRunning || document.getElementById('plyph-host')) return removeTrigger();
    if (selectingPointer) return;
    const current = captureTriggerSelection();
    if (!current?.text?.trim()) return removeTrigger();
    if (sameSelection(current, dismissedSelection)) return removeTrigger();
    snapshot = current;
    const rect = triggerSelectionRect(current);
    if (!rect || (!rect.width && !rect.height)) return removeTrigger();
    if (rect.bottom < -20 || rect.top > window.innerHeight + 20 || rect.right < -20 || rect.left > window.innerWidth + 20) {
      return removeTrigger();
    }
    showTrigger(rect);
    // Showing the button completes this gesture. Other extensions can adjust
    // focus/selection later; only a new user gesture should recapture it.
    triggerIntent = false;
  }

  // Automatic UI follows only the active selection. Explicit commands can still
  // aggregate multiple fields through captureSelection(). Never anchor to stale fields.
  function captureTriggerSelection() {
    if (passwordFieldFocused()) return null;
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    if (isTextField(active)) {
      if (!isVisibleField(active)) return null;
      const start = active.selectionStart ?? 0, end = active.selectionEnd ?? start;
      return end > start ? {kind: 'control', element: active, start, end, text: active.value.slice(start, end), backwards: active.selectionDirection === 'backward'} : null;
    }
    const scope = active?.getRootNode();
    const selection = selectionScope?.getSelection?.() || scope?.getSelection?.() || window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0).cloneRange();
    if (!range.startContainer.isConnected || !range.endContainer.isConnected) return null;
    return {kind: 'range', range, text: selection.toString(),
      backwards: selection.focusNode === range.startContainer && selection.focusOffset === range.startOffset};
  }

  function triggerSelectionRect(current) {
    if (!current) return null;
    if (current.kind === 'control') {
      if (!current.element.isConnected) return null;
      const field = current.element.getBoundingClientRect();
      if (!field.width || !field.height) return null;
      // Mouse selections use the release position, as TWP does. Measuring a
      // caret with a mirror is unreliable in styled/scrolling search editors.
      if (selectionPoint) {
        const x = Math.max(field.left, Math.min(field.right, selectionPoint.x));
        const y = Math.max(field.top, Math.min(field.bottom, selectionPoint.y));
        return {left: x, right: x, top: y, bottom: y, width: 1, height: 1};
      }
      const position = current.backwards ? current.start : current.end;
      let caret;
      try { caret = controlCaretRect(current.element, position); } catch { }
      if (!caret || caret.bottom < field.top || caret.top > field.bottom || caret.left < field.left || caret.left > field.right) return domRect(field);
      return {...caret, top: Math.max(caret.top, field.top), bottom: Math.min(caret.bottom, field.bottom)};
    }
    if (!current.range?.startContainer.isConnected || !current.range.endContainer.isConnected) return null;
    const rects = [...current.range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
    if (!rects.length) return null;
    if (selectionPoint) {
      const distance = rect => Math.hypot(Math.max(rect.left - selectionPoint.x, 0, selectionPoint.x - rect.right),
        Math.max(rect.top - selectionPoint.y, 0, selectionPoint.y - rect.bottom));
      const nearest = rects.reduce((a, b) => distance(a) <= distance(b) ? a : b);
      return domRect(nearest);
    }
    return domRect(current.backwards ? rects[0] : rects[rects.length - 1]);
  }

  function domRect(rect) {
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
  }

  function rangeRect(range) {
    const rects = range.getClientRects();
    if (rects.length > 0) {
      const last = rects[rects.length - 1];
      if (last && (last.width || last.height)) return domRect(last);
    }
    return domRect(range.getBoundingClientRect());
  }

  function unionRect(box, rect) {
    if (!rect) return box;
    if (!box) return domRect(rect);
    return {
      left: Math.min(box.left, rect.left),
      right: Math.max(box.right, rect.right),
      top: Math.min(box.top, rect.top),
      bottom: Math.max(box.bottom, rect.bottom),
      width: Math.max(box.right, rect.right) - Math.min(box.left, rect.left),
      height: Math.max(box.bottom, rect.bottom) - Math.min(box.top, rect.top),
    };
  }

  function selectionRect(selection) {
    if (selection.kind === 'multi') {
      let box = null;
      for (const fragment of selection.fragments || []) {
        try {
          if (fragment.range) box = unionRect(box, rangeRect(fragment.range));
          else if (fragment.element) box = unionRect(box, controlCaretRect(fragment.element, fragment.end));
          else if (fragment.rect) box = unionRect(box, fragment.rect);
        } catch { }
      }
      return box;
    }
    if (selection.kind === 'range') {
      if (selection.range) {
        try { return rangeRect(selection.range); } catch { }
      }
      if (selection.rect) return domRect(selection.rect);
      return null;
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
    mirror.style.whiteSpace = element instanceof HTMLInputElement ? 'pre' : 'pre-wrap';
    mirror.textContent = element.value.slice(0, position);
    const marker = document.createElement('span');
    marker.textContent = element.value.slice(position) || '\u200B';
    mirror.append(marker);
    const measurementHost = document.createElement('div');
    measurementHost.style.setProperty('all', 'initial', 'important');
    measurementHost.style.setProperty('position', 'fixed', 'important');
    measurementHost.style.setProperty('visibility', 'hidden', 'important');
    measurementHost.attachShadow({mode: 'closed'}).append(mirror);
    document.documentElement.append(measurementHost);

    const elementRect = element.getBoundingClientRect();
    const markerLeft = marker.offsetLeft;
    const markerTop = marker.offsetTop;
    const lineHeight = Number.parseFloat(style.lineHeight) || (Number.parseFloat(style.fontSize) * 1.2) || 16;
    measurementHost.remove();

    const scaleX = elementRect.width / (element.offsetWidth || elementRect.width);
    const scaleY = elementRect.height / (element.offsetHeight || elementRect.height);
    const caretLeft = elementRect.left + (markerLeft - element.scrollLeft) * scaleX;
    const caretTop = element instanceof HTMLInputElement
      ? elementRect.top + (elementRect.height - lineHeight * scaleY) / 2
      : elementRect.top + (markerTop - element.scrollTop) * scaleY;
    return {
      left: caretLeft,
      right: caretLeft,
      top: caretTop,
      bottom: caretTop + lineHeight * scaleY,
      width: 1,
      height: lineHeight * scaleY,
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

  function resolveQuickActions() {
    const builtins = {
      ask: {name: 'Ask', mode: 'ask'},
      correct: {name: 'Correct', mode: 'correct'},
      rewrite: {name: 'Rewrite', mode: 'rewrite'},
      prompt: {name: 'Run Prompt', mode: 'prompt'},
    };
    const resolved = [];
    for (const id of toolbarActionIds.slice(0, 4)) {
      if (builtins[id]) { resolved.push({name: builtins[id].name, mode: builtins[id].mode}); continue; }
      const custom = cachedActions.find(action => action.id === id);
      if (custom) resolved.push({name: custom.name, mode: 'custom', actionId: custom.id});
    }
    return resolved;
  }

  function renderQuickActions(root) {
    const quick = root.querySelector('.quick-actions');
    if (!quick) return;
    quick.replaceChildren();
    for (const action of resolveQuickActions()) {
      const button = document.createElement('button');
      button.type = 'button'; button.title = action.name; button.setAttribute('aria-label', action.name);
      button.innerHTML = `<span class="glyph">${triggerActionIcon(action.mode)}</span><span class="quick-label"></span>`;
      button.querySelector('.quick-label').textContent = action.name;
      button.addEventListener('click', () => runPageAction(action));
      quick.append(button);
    }
    const more = document.createElement('button');
    more.type = 'button'; more.title = 'More actions'; more.setAttribute('aria-label', 'More actions');
    more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', 'false');
    more.className = 'more'; more.innerHTML = `<span class="glyph">${triggerActionIcon('more')}</span>`;
    more.addEventListener('click', event => { event.stopPropagation(); toggleTriggerMenu(root); });

    more.hidden = overflowActions().length === 0;
    quick.append(more);
    const menu = root.querySelector('.menu');
    if (menu) { menu.hidden = true; }
  }

  function showTrigger(rect) {
    let host = document.getElementById('plyph-trigger');
    const target = snapshot?.element || snapshot?.range?.startContainer?.parentElement;
    const isDark = getElementLuminance(target) < 0.5;
    if (!host) {
      host = document.createElement('div');
      host.id = 'plyph-trigger';
      // Manual top-layer popovers escape transformed/clipped page ancestors and
      // coexist with the site's own popovers without closing them.
      host.style.setProperty('all', 'initial', 'important');
      for (const [key, value] of Object.entries({margin: '0', padding: '0', border: '0', inset: 'auto',
        width: 'max-content', height: 'auto', overflow: 'visible', background: 'transparent',
        transform: 'none', zoom: '1', transition: 'none', animation: 'none'})) host.style.setProperty(key, value, 'important');
      if (typeof host.showPopover === 'function') host.setAttribute('popover', 'manual');
      const root = host.attachShadow({mode: 'open'});
      root.innerHTML = `
        <style>
          :host { all: initial; color-scheme: light dark; }
          :host::backdrop { display: none; }
          .wrapper { max-width: calc(100vw - 16px); box-sizing: border-box; display: flex; position: relative; align-items: center; gap: 2px; padding: 3px;
            border: 1px solid var(--border); border-radius: 18px; background: var(--surface);
            box-shadow: 0 3px 14px #0002; font: 12px/1.4 system-ui, sans-serif; color: var(--text); }
          .theme-light { --surface: #fff; --hover: #f0f2f5; --text: #20242b; --border: #d8dce2; --muted: #565f6c; }
          .theme-dark { --surface: #23262c; --hover: #353a43; --text: #f4f5f7; --border: #454a54; --muted: #b8bfca; }
          button { display: flex; align-items: center; justify-content: center; gap: 5px; min-height: 28px;
            padding: 5px 7px; border: 0; border-radius: 14px; background: transparent; color: inherit;
            font: inherit; white-space: nowrap; cursor: pointer; box-sizing: border-box; }
          button:hover, button[aria-expanded="true"] { background: var(--hover); }
          button:focus-visible { outline: 2px solid var(--text); outline-offset: -2px; }
          .dot { width: 28px; padding: 5px; }
          .dot svg { display: block; width: 18px; height: 18px; }
          .quick-actions { display: flex; flex-wrap: wrap; min-width: 0; align-items: center; gap: 2px; border-left: 1px solid var(--border); padding-left: 3px; }
          [hidden] { display: none !important; }
          .glyph { display: flex; width: 16px; height: 16px; flex: 0 0 16px; }
          .glyph svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
          .menu { position: absolute; top: calc(100% + 6px); right: 0; display: flex; flex-direction: column;
            width: 230px; max-width: calc(100vw - 16px); max-height: min(360px, 55vh); overflow-y: auto;
            padding: 5px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface);
            box-shadow: 0 6px 24px #0003; box-sizing: border-box; }
          .menu.above { top: auto; bottom: calc(100% + 6px); }
          .item { justify-content: flex-start; width: 100%; text-align: left; }
          .label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
          .separator { height: 1px; flex-shrink: 0; margin: 4px 6px; background: var(--border); }
          @media (max-width: 420px) { .quick-label { display: none; } }
        </style>
        <div class="wrapper" role="toolbar" aria-label="Selected text actions">
          <button class="dot" type="button" title="Open Plyph actions" aria-label="Open Plyph actions" aria-expanded="false">
            <svg viewBox="0 0 1024 1024" aria-hidden="true"><path d="M512 156C496 257 458 365 401 455C349 537 286 607 220 660C302 636 368 637 419 675C465 709 493 755 512 800C531 755 559 709 605 675C656 637 722 636 804 660C738 607 675 537 623 455C566 365 528 257 512 156Z" fill="currentColor"/><path d="M512 405C461 405 424 439 424 487C424 539 444 594 468 650C490 702 505 751 512 800C509 757 507 714 511 678C516 635 532 612 559 586C589 557 600 527 600 488C600 440 563 405 512 405Z" fill="var(--surface)"/><circle cx="512" cy="493" r="37" fill="currentColor"/></svg>
          </button>
          <div class="quick-actions" hidden></div>
          <div class="menu" role="menu" hidden></div>
        </div>`;
      renderQuickActions(root);
      document.documentElement.append(host);
      if (host.hasAttribute('popover')) {
        try { host.showPopover(); } catch { host.removeAttribute('popover'); }
      }
      triggerWatch = setInterval(() => {
        if (!host.isConnected) return;
        if (passwordFieldFocused()) return removeTrigger(true);
        // Keep the captured text even if another extension moves focus or
        // changes the live selection while showing its delayed toolbar.
        const interacting = document.activeElement === host;
        const anchor = triggerSelectionRect(snapshot);
        const previous = host._plyphSelectionRect;
        const field = snapshot?.kind === 'control' ? snapshot.element.getBoundingClientRect() : null;
        if (field && host._plyphFieldRect && ['left', 'top', 'right', 'bottom'].some(key => Math.abs(field[key] - host._plyphFieldRect[key]) > 2)) return removeTrigger(true);
        const textChanged = snapshot?.kind === 'control'
          ? snapshot.element.value.slice(snapshot.start, snapshot.end) !== snapshot.text
          : snapshot?.range?.toString() !== snapshot?.text;
        if (textChanged || !anchor ||
            ['left', 'top', 'right', 'bottom'].some(key => Math.abs(anchor[key] - previous[key]) > 2)) return removeTrigger(true);
        if (!interacting) positionTrigger(host, previous);
      }, 150);
      root.addEventListener('mousedown', event => event.preventDefault());
      for (const type of ['pointerdown', 'pointerup', 'click']) root.addEventListener(type, event => event.stopPropagation());
      const dot = root.querySelector('.dot');
      dot.addEventListener('click', () => {
        const quick = root.querySelector('.quick-actions');
        quick.hidden = !quick.hidden;
        dot.setAttribute('aria-expanded', String(!quick.hidden));
        dot.title = quick.hidden ? 'Open Plyph actions' : 'Collapse Plyph actions';
        dot.setAttribute('aria-label', dot.title);
        root.querySelector('.menu').hidden = true;
        root.querySelector('.more')?.setAttribute('aria-expanded', 'false');
        positionTrigger(host, host._plyphSelectionRect);
      });
      root.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); removeTrigger(true); }
        if (['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          const buttons = [...root.querySelectorAll('button')].filter(button => !button.closest('[hidden]'));
          const index = buttons.indexOf(root.activeElement);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
            : (index + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) + buttons.length) % buttons.length;
          event.preventDefault(); buttons[next]?.focus();
        }
      });
    }
    host.dataset.anchor = selectionPoint ? 'pointer' : 'selection';
    host._plyphSelectionRect = rect;
    host._plyphFieldRect = snapshot?.kind === 'control' ? domRect(snapshot.element.getBoundingClientRect()) : null;
    host.shadowRoot.querySelector('.wrapper').className = `wrapper ${isDark ? 'theme-dark' : 'theme-light'}`;
    positionTrigger(host, rect);
  }

  function refreshTriggerPosition() {
    const host = document.getElementById('plyph-trigger');
    if (!host) return;
    const previous = host._plyphFieldRect;
    const field = snapshot?.kind === 'control' ? snapshot.element.getBoundingClientRect() : null;
    if (selectionPoint && field && previous) {
      selectionPoint.x += field.left - previous.left;
      selectionPoint.y += field.top - previous.top;
    }
    const rect = triggerSelectionRect(snapshot);
    if (!rect) return removeTrigger(true);
    host._plyphSelectionRect = rect;
    host._plyphFieldRect = field ? domRect(field) : null;
    positionTrigger(host, rect);
  }

  function popupCandidates(rect, width, height, viewport, point) {
    const gap = 10, edge = 8;
    const clampX = x => Math.max(viewport.left + edge, Math.min(viewport.right - width - edge, x));
    const clampY = y => Math.max(viewport.top + edge, Math.min(viewport.bottom - height - edge, y));
    const x = point ? Math.max(rect.left, Math.min(rect.right, point.x)) : rect.right;
    const y = point ? Math.max(rect.top, Math.min(rect.bottom, point.y)) : rect.bottom;
    // Prefer a small offset from the release point. Try both sides and above/
    // below, then clamp at viewport edges instead of losing every candidate.
    const positions = point ? [
      {left: x + gap, top: y - height - gap},
      {left: x + gap, top: rect.bottom + gap},
      {left: x - width - gap, top: y - height - gap},
      {left: x - width - gap, top: rect.bottom + gap},
    ] : [];
    const alignments = [rect.right, rect.right - width, rect.left];
    for (const top of [rect.bottom + gap, rect.top - height - gap]) {
      for (const left of alignments) positions.push({left, top});
    }
    return positions.map(p => ({left: clampX(p.left), top: clampY(p.top)}));
  }

  function popupObstructed(host, box) {
    // Hit-test beneath our host, including controls inside open shadow roots.
    const previous = host.style.getPropertyValue('pointer-events');
    host.style.setProperty('pointer-events', 'none', 'important');
    try {
      const xs = [box.left + 2, box.left + box.width / 2, box.left + box.width - 2];
      const ys = [box.top + 2, box.top + box.height / 2, box.top + box.height - 2];
      return xs.some(x => ys.some(y => {
        let element = document.elementFromPoint(x, y);
        while (element?.shadowRoot?.elementFromPoint) {
          const inner = element.shadowRoot.elementFromPoint(x, y);
          if (!inner || inner === element) break;
          element = inner;
        }
        while (element && element !== document.documentElement) {
          if (element === host) return false;
          const selectedNode = snapshot?.element || snapshot?.range?.commonAncestorContainer;
          // The selected editor/dialog is the context, not a competing popup.
          if (selectedNode && element.contains(selectedNode)) {
            element = element.parentElement || element.getRootNode()?.host;
            continue;
          }
          if (element.matches('button,a[href],input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="toolbar"],[role="menu"],[role="dialog"],[popover]')) return true;
          // A z-index is not evidence of a popup: search pages and editors
          // routinely put their entire content in positioned layers.
          element = element.parentElement || element.getRootNode()?.host;
        }
        return false;
      }));
    } finally {
      if (previous) host.style.setProperty('pointer-events', previous, 'important');
      else host.style.removeProperty('pointer-events');
    }
  }

  function positionTrigger(host, rect) {
    host.style.setProperty('position', 'fixed', 'important');
    host.style.setProperty('z-index', '2147483646', 'important');
    const wrapper = host.shadowRoot.querySelector('.wrapper');
    const {width, height} = wrapper.getBoundingClientRect();
    const visual = window.visualViewport;
    const viewport = {left: visual?.offsetLeft || 0, top: visual?.offsetTop || 0,
      right: (visual?.offsetLeft || 0) + (visual?.width || window.innerWidth),
      bottom: (visual?.offsetTop || 0) + (visual?.height || window.innerHeight)};
    const menu = host.shadowRoot.querySelector('.menu');
    const menuRect = menu.hidden ? null : menu.getBoundingClientRect();
    const footprintWidth = Math.max(width, menuRect?.width || 0);
    const footprintHeight = height + (menuRect ? menuRect.height + 6 : 0);
    const candidates = popupCandidates(rect, footprintWidth, footprintHeight, viewport, selectionPoint);
    const placement = candidates.find(p => !popupObstructed(host, {...p, width: footprintWidth, height: footprintHeight}));
    // Prefer hiding to covering controls or clamping the popup far from its text.
    if (!placement) return removeTrigger(true);
    const x = placement.left;
    const above = placement.top < rect.top;
    const y = placement.top + (above && menuRect ? menuRect.height + 6 : 0);
    host.style.setProperty('left', `${x}px`, 'important');
    host.style.setProperty('top', `${y}px`, 'important');
    const actual = wrapper.getBoundingClientRect();
    if (Math.abs(actual.left - x) > 2 || Math.abs(actual.top - y) > 2) return removeTrigger(true);
    menu.style.right = 'auto';
    menu.style.left = '0';
    menu.classList.toggle('above', above);
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
    const more = root.querySelector('.more');
    if (!menu.hidden) { menu.hidden = true; more.setAttribute('aria-expanded', 'false'); return; }
    const actions = overflowActions();
    menu.replaceChildren();
    if (!actions.length) { menu.hidden = true; more.setAttribute('aria-expanded', 'false'); return; }
    actions.forEach((action, index) => {
      if (index === 1) { const separator = document.createElement('div'); separator.className = 'separator'; menu.append(separator); }
      const button = document.createElement('button');
      button.className = 'item'; button.type = 'button'; button.setAttribute('role', 'menuitem');
      button.innerHTML = `<span class="glyph">${triggerActionIcon(action.mode)}</span><span class="label"></span>`;
      button.querySelector('.label').textContent = action.name;
      button.addEventListener('click', () => runPageAction(action));
      menu.append(button);
    });
    menu.hidden = false;
    const host = root.host;
    positionTrigger(host, host._plyphSelectionRect);
    if (!host.isConnected) return;
    more.setAttribute('aria-expanded', 'true');
    menu.querySelector('button')?.focus();
  }

  function runPageAction(action, selectedText = snapshot?.text || '') {
    if (!extensionAlive || !hasExtensionContext()) return removeTrigger();
    const editor = findEditorTarget(snapshot);
    if (editor) {
      selectedText = editor.text;
      snapshot = {kind: 'editor', text: editor.text, replace: editor.replace};
    }
    if (action.mode === 'ask' && !action.instruction) { showAsk(selectedText || ''); return; }
    removeTrigger(true);
    actionRunning = true;
    try {
      chrome.runtime.sendMessage({type: 'RUN_ACTION_FROM_PAGE', action, text: selectedText}, response => {
        try {
          if (chrome.runtime.lastError) {
            actionRunning = false;
            showToast(chrome.runtime.lastError.message || 'Reload this page to reconnect Plyph.', 'error', 4000);
            return;
          }
          if (!extensionAlive) return;
          actionRunning = false;

        } catch (error) {
          actionRunning = false;
          if (isContextInvalidation(error)) disposeController();
        }
      });
    } catch (error) {
      actionRunning = false;
      if (isContextInvalidation(error)) disposeController();
      else showToast(error.message || 'Could not run this action.', 'error', 4000);
    }
  }

  function triggerActionIcon(mode) {
    const paths = {
      ask: '<path d="M5 3.5h14A1.5 1.5 0 0 1 20.5 5v11a1.5 1.5 0 0 1-1.5 1.5h-7L7 21v-3.5H5A1.5 1.5 0 0 1 3.5 16V5A1.5 1.5 0 0 1 5 3.5Z"/><path d="M9.8 8a2.2 2.2 0 1 1 3.6 1.7c-.9.6-1.4 1-1.4 2"/><circle cx="12" cy="14.5" r=".7" fill="currentColor" stroke="none"/>',
      correct: '<path d="m8.5 10.5 11 11 2-2-11-11Z"/><path d="m11 13 2-2M5 2v4M3 4h4M16 2v4M14 4h4M3 12v4M1 14h4"/>',
      rewrite: '<path d="M10 5H5a1 1 0 0 0-1 1v14h14v-6M11 13l1-4L19 2l3 3-7 7ZM17 4l3 3"/>',
      prompt: '<path d="M6 3.5a.7.7 0 0 1 1.1-.6l14 8.5a.7.7 0 0 1 0 1.2l-14 8.5a.7.7 0 0 1-1.1-.6Z" fill="currentColor" stroke="none"/>',
      more: '<circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
      custom: '<path d="m10 4 2.3 6.7L19 13l-6.7 2.3L10 22l-2.3-6.7L1 13l6.7-2.3ZM19 1l1.1 3.9L24 6l-3.9 1.1L19 11l-1.1-3.9L14 6l3.9-1.1Z"/>',
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[mode] || paths.custom}</svg>`;
  }

  function overflowActions() {
    const quickIds = new Set(toolbarActionIds);
    const builtins = [
      {id: 'ask', name: 'Ask', mode: 'ask'},
      {id: 'correct', name: 'Correct', mode: 'correct'},
      {id: 'rewrite', name: 'Rewrite', mode: 'rewrite'},
      {id: 'prompt', name: 'Run selected prompt', mode: 'prompt'},
    ];
    return [
      ...builtins.filter(item => !quickIds.has(item.id)),
      ...cachedActions
        .filter(action => !quickIds.has(action.id))
        .map(action => ({name: action.name, mode: 'custom', actionId: action.id})),
    ];
  }

  function sameSelection(a, b) {
    if (!a || !b || a.kind !== b.kind || a.text !== b.text) return false;
    if (a.kind === 'control') return a.element === b.element && a.start === b.start && a.end === b.end;
    if (a.kind === 'multi') return true;
    if (a.kind === 'editor') return true;
    if (!a.range || !b.range) return true;
    return a.range.startContainer === b.range.startContainer && a.range.startOffset === b.range.startOffset &&
      a.range.endContainer === b.range.endContainer && a.range.endOffset === b.range.endOffset;
  }

  function removeTrigger(suppress = false) {
    clearTimeout(triggerTimer);
    clearInterval(triggerWatch);
    triggerWatch = null;
    if (suppress) { dismissedSelection = snapshot; triggerIntent = false; }
    document.getElementById('plyph-trigger')?.remove();
  }

  function showAsk(text) {
    if (!text?.trim()) { showToast('Select text first.', 'error', 3000); return; }
    const originalSelection = snapshot;
    const originalFocus = document.activeElement;
    removeTrigger(true);
    removeToast();
    closeDialog();
    const host = document.createElement('div');
    host.id = 'plyph-host';
    const root = host.attachShadow({mode: 'open'});
    root.innerHTML = `
      <style>
        :host { all: initial; color-scheme: light dark; }
        dialog { width: min(480px, calc(100vw - 40px)); max-height: calc(100vh - 48px); overflow: auto;
          box-sizing: border-box; padding: 24px; border: 1px solid #d8dce2; border-radius: 16px;
          background: #fff; color: #20242b; box-shadow: 0 18px 60px #0004; font: 14px/1.5 system-ui, sans-serif; }
        dialog::backdrop { background: #0005; }
        form { display: flex; flex-direction: column; gap: 16px; margin: 0; }
        h2 { margin: 0; font-size: 20px; font-weight: 600; }
        label { display: flex; flex-direction: column; gap: 8px; }
        textarea { width: 100%; min-height: 108px; resize: vertical; padding: 12px; box-sizing: border-box;
          border: 1px solid #bbc2cc; border-radius: 8px; background: #f8f9fb; color: inherit; font: inherit; }
        textarea:focus { outline: 2px solid #626e80; outline-offset: 2px; }
        details { padding: 10px 12px; border: 1px solid #e0e3e8; border-radius: 8px; }
        summary { cursor: pointer; color: #616b79; }
        .selection { max-height: 140px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; margin: 10px 0 0; }
        footer { display: flex; justify-content: flex-end; align-items: center; gap: 8px; }
        button { min-height: 36px; padding: 7px 15px; border: 1px solid #d8dce2; border-radius: 8px;
          background: #f1f3f6; color: inherit; font: inherit; cursor: pointer; }
        button[type=submit] { background: #252b35; border-color: #252b35; color: #fff; }
        button:disabled { opacity: .5; cursor: default; }
        button:focus-visible { outline: 2px solid #626e80; outline-offset: 2px; }
        @media (prefers-color-scheme: dark) {
          dialog { background: #23262c; color: #f4f5f7; border-color: #454a54; }
          textarea { background: #191c21; border-color: #545b67; }
          details, button { border-color: #454a54; }
          summary { color: #b8bfca; }
          button { background: #353a43; }
          button[type=submit] { background: #e1e5ec; color: #20242b; border-color: #e1e5ec; }
        }
      </style>
      <dialog aria-labelledby="ask-title">
        <form><h2 id="ask-title">Ask Plyph</h2>
          <details><summary>Selected text</summary><p class="selection"></p></details>
          <label>What would you like to do?<textarea placeholder="Explain this, shorten it, change the tone…" required autofocus></textarea></label>
          <footer><button type="button" class="cancel">Cancel</button><button type="submit" disabled>Send</button></footer>
        </form>
      </dialog>`;
    root.querySelector('.selection').textContent = text;
    document.documentElement.append(host);
    const dialog = root.querySelector('dialog');
    const field = root.querySelector('textarea');
    const submit = root.querySelector('button[type=submit]');
    const cancel = () => { closeDialog(); if (originalFocus?.isConnected) originalFocus.focus({preventScroll: true}); };
    field.addEventListener('input', () => { submit.disabled = !field.value.trim(); });
    root.querySelector('.cancel').addEventListener('click', cancel);
    dialog.addEventListener('cancel', event => { event.preventDefault(); cancel(); });
    root.querySelector('form').addEventListener('submit', event => {
      event.preventDefault();
      const instruction = field.value.trim();
      if (!instruction) return;
      snapshot = originalSelection;
      closeDialog();
      runPageAction({mode: 'ask', instruction}, text);
    });
    root.addEventListener('keydown', event => {
      event.stopPropagation();
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        if (field.value.trim()) root.querySelector('form').requestSubmit();
      }
    });
    dialog.showModal();
    field.focus();
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
      const range = snapshot.range;
      // Shadow selections may have text/geometry without a usable DOM range.
      // Reject these before touching either the live selection or page contents.
      if (!range || !range.startContainer?.isConnected || !range.endContainer?.isConnected || range.collapsed ||
          range.startContainer.getRootNode() !== range.endContainer.getRootNode()) {
        showToast('The original selection is no longer available. Select the text again, or copy the result.', 'error', 3500);
        return;
      }
      const scope = range.startContainer.getRootNode();
      const selection = scope.getSelection?.() || window.getSelection();
      if (!selection) { showToast('The original selection is no longer available.', 'error', 3500); return; }
      try {
        selection.removeAllRanges();
        selection.addRange(range);
        if (!selection.rangeCount) throw new Error('Selection could not be restored');
      } catch {
        showToast('The original selection could not be restored. Select the text again, or copy the result.', 'error', 3500);
        return;
      }
      if (!document.execCommand('insertText', false, text)) {
        range.deleteContents();
        const node = document.createTextNode(text);
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
      }
    } else if (snapshot.kind === 'editor' && typeof snapshot.replace === 'function') {
      if (!snapshot.replace(text)) { showToast('The original field is no longer available.', 'error', 3500); return; }
    } else {
      showToast('The original field is no longer available.', 'error', 3500);
      return;
    }
    const completedSelection = snapshot;
    snapshot = null;
    closeDialog();
    showToast(`${label}. Use the page’s undo command to revert.`, 'normal', 1800, completedSelection.kind === 'editor' ? null : completedSelection);
  }

  function showResult(output, original = null, showChangesDefault = false) {
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
          box-shadow: 0 24px 64px -12px rgba(0, 0, 0, 0.5), 0 0 1px 1px var(--pp-border);
        }

        .header-actions {
          display: flex;
          align-items: center;
          gap: 2px;
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
          transition: color 0.15s ease, background-color 0.15s ease;
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
          min-height: 140px;
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
        }

        .diff-view {
          width: 100%;
          min-height: 140px;
          max-height: 48vh;
          overflow: auto;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
          font-family: inherit;
          font-size: 14px;
          line-height: 1.6;
          color: var(--pp-text);
          box-sizing: border-box;
          outline: none;
        }

        .diff-view.nowrap {
          white-space: pre;
          overflow-wrap: normal;
        }

        .dialog.expanded .diff-view {
          max-height: 68vh;
        }

        .diff-added {
          background: #19452b;
          color: #b9f6ca;
          text-decoration: underline;
          border-radius: 2px;
        }

        .diff-removed {
          background: #58252b;
          color: #ffcdd2;
          text-decoration: line-through;
          border-radius: 2px;
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
          transition: background-color 0.15s ease, transform 0.15s ease;
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
            <div class="header-actions">
              <button class="btn-card-action btn-changes" type="button" aria-pressed="false" hidden>Show changes</button>
              <button class="btn-expand" type="button" title="Expand preview size">
                <svg class="expand-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M10 2h4v4M6 14H2v-4M14 2l-5.5 5.5M2 14l5.5-5.5"/>
                </svg>
              </button>
            </div>
          </header>

          <div class="card">
            <div class="card-header">
              <button class="btn-card-action btn-wrap active" type="button" title="Toggle line wrapping">wrap</button>
            </div>
            <textarea aria-label="Generated result" spellcheck="false"></textarea>
            <div class="diff-view" role="region" aria-label="Changes from the original text" tabindex="0" hidden></div>
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
    const diffView = root.querySelector('.diff-view');
    const changesButton = root.querySelector('.btn-changes');
    const expandBtn = root.querySelector('.btn-expand');
    const dialog = root.querySelector('.dialog');
    const expandIcon = expandBtn?.querySelector('svg');
    let isExpanded = false;
    let isWrapped = true;
    let showChangesView = false;

    textarea.value = output;
    updateCount(root, output);

    if (original !== null && showChangesDefault && original !== output)
      changesButton.classList.add('active');

    const refreshChanges = () => {
      if (!changesButton) return;
      const changed = original !== null && original !== textarea.value;
      if (!changed) changesButton.classList.remove('active');
      changesButton.hidden = original === null;
      changesButton.disabled = !changed;
      showChangesView = changed && changesButton.classList.contains('active');
      changesButton.textContent = !changed ? 'No changes' : showChangesView ? 'Show result' : 'Show changes';
      changesButton.title = !changed ? 'No changes from the original text'
        : showChangesView ? 'Show the editable result' : 'Show changes from the original text';
      changesButton.setAttribute('aria-pressed', String(showChangesView));
      if (showChangesView) renderDiff(diffView, original, textarea.value);
      textarea.hidden = showChangesView;
      diffView.hidden = !showChangesView;
    };

    changesButton?.addEventListener('click', () => {
      changesButton.classList.toggle('active');
      refreshChanges();
      fitDialog();
      if (showChangesView) diffView.focus({preventScroll: true});
      else textarea.focus({preventScroll: true});
    });

    const fitDialog = () => {
      const longest = textarea.value.split('\n').reduce((max, line) => Math.max(max, line.length), 0);
      const available = Math.max(320, window.innerWidth - 32);
      const width = Math.min(available, isExpanded
        ? Math.min(860, available)
        : Math.max(540, Math.min(680, Math.round(longest * 8.2 + 48))));
      dialog.style.width = `${width}px`;
      if (showChangesView) return;
      const cap = isExpanded ? window.innerHeight * 0.68 : window.innerHeight * 0.48;
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.max(140, Math.min(cap, textarea.scrollHeight))}px`;
    };

    textarea.addEventListener('input', () => {
      updateCount(root, textarea.value);
      refreshChanges();
      fitDialog();
    });

    expandBtn?.addEventListener('click', () => {
      isExpanded = !isExpanded;
      dialog?.classList.toggle('expanded', isExpanded);
      if (expandBtn) expandBtn.title = isExpanded ? 'Collapse preview size' : 'Expand preview size';
      if (expandIcon) {
        expandIcon.innerHTML = isExpanded
          ? '<path d="M14 6h-4V2M2 10h4v4M10 6l5-5M6 10l-5 5"/>'
          : '<path d="M10 2h4v4M6 14H2v-4M14 2l-5.5 5.5M2 14l5.5-5.5"/>';
      }
      fitDialog();
    });

    const wrapBtn = root.querySelector('.btn-wrap');
    wrapBtn?.addEventListener('click', () => {
      isWrapped = !isWrapped;
      textarea.wrap = isWrapped ? 'soft' : 'off';
      diffView.classList.toggle('nowrap', !isWrapped);
      wrapBtn.classList.toggle('active', isWrapped);
      wrapBtn.title = isWrapped ? 'Disable line wrapping' : 'Enable line wrapping';
      fitDialog();
    });

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
    refreshChanges();
    fitDialog();
    if (showChangesView) diffView.focus({preventScroll: true});
    else textarea.focus();
  }

  function updateCount(root, value) {
    const words = value.trim() ? value.trim().split(/\s+/u).length : 0;
    const countEl = root.querySelector('.count-text');
    if (countEl) {
      countEl.textContent = `${words} ${words === 1 ? 'word' : 'words'} · ${value.length} chars`;
    }
  }

  function diffTokens(text) {
    return text.match(/[\p{L}\p{N}\p{M}_]+|\s+|[^\p{L}\p{N}\p{M}_\s]/gu) ?? [];
  }

  function diffParts(original, result) {
    const before = diffTokens(original);
    const after = diffTokens(result);
    let start = 0;
    while (start < before.length && start < after.length && before[start] === after[start])
      start++;
    let endBefore = before.length;
    let endAfter = after.length;
    while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
      endBefore--;
      endAfter--;
    }
    const parts = [];
    const append = (type, text) => {
      if (!text) return;
      if (parts.at(-1)?.type === type)
        parts.at(-1).text += text;
      else
        parts.push({type, text});
    };
    append('equal', before.slice(0, start).join(''));
    const rows = endBefore - start;
    const columns = endAfter - start;
    if ((rows + 1) * (columns + 1) > 1000000) {
      append('removed', before.slice(start, endBefore).join(''));
      append('added', after.slice(start, endAfter).join(''));
    } else {
      const stride = columns + 1;
      const lengths = new Uint32Array((rows + 1) * stride);
      for (let i = rows - 1; i >= 0; i--) {
        for (let j = columns - 1; j >= 0; j--) {
          lengths[i * stride + j] = before[start + i] === after[start + j]
            ? lengths[(i + 1) * stride + j + 1] + 1
            : Math.max(lengths[(i + 1) * stride + j], lengths[i * stride + j + 1]);
        }
      }
      let i = 0;
      let j = 0;
      while (i < rows || j < columns) {
        if (i < rows && j < columns && before[start + i] === after[start + j]) {
          append('equal', before[start + i++]);
          j++;
        } else if (i < rows && (j === columns || lengths[(i + 1) * stride + j] >= lengths[i * stride + j + 1])) {
          append('removed', before[start + i++]);
        } else {
          append('added', after[start + j++]);
        }
      }
    }
    append('equal', before.slice(endBefore).join(''));
    return parts;
  }

  function renderDiff(container, original, result) {
    container.replaceChildren();
    for (const {type, text} of diffParts(original, result)) {
      if (type === 'equal') {
        container.append(document.createTextNode(text));
        continue;
      }
      const span = document.createElement('span');
      span.className = type === 'added' ? 'diff-added' : 'diff-removed';
      span.textContent = text;
      container.append(span);
    }
  }

  function showErrorDialog(message) {
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
          --pp-btn-sec-bg: #f3f4f6;
          --pp-btn-sec-text: #374151;
          --pp-btn-sec-border: #e5e7eb;
          --pp-btn-sec-hover: #e5e7eb;
          --pp-btn-pri-bg: #1f2937;
          --pp-btn-pri-text: #ffffff;
          --pp-btn-pri-hover: #111827;
        }
        @media (prefers-color-scheme: dark) {
          :host {
            --pp-bg: #1d1e21;
            --pp-text: #f3f4f6;
            --pp-muted: #9ca3af;
            --pp-border: rgba(255, 255, 255, 0.08);
            --pp-btn-sec-bg: #27282c;
            --pp-btn-sec-text: #e5e7eb;
            --pp-btn-sec-border: rgba(255, 255, 255, 0.08);
            --pp-btn-sec-hover: #313338;
            --pp-btn-pri-bg: #808086;
            --pp-btn-pri-text: #141517;
            --pp-btn-pri-hover: #96969d;
          }
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
        }
        .dialog {
          width: min(600px, calc(100vw - 40px));
          background: var(--pp-bg);
          border: 1px solid var(--pp-border);
          border-radius: 14px;
          padding: 20px 22px;
          box-shadow: 0 20px 50px -10px rgba(0, 0, 0, 0.45), 0 0 1px 1px var(--pp-border);
          display: flex;
          flex-direction: column;
          box-sizing: border-box;
        }
        h2 {
          margin: 0 0 12px;
          font-size: 15px;
          font-weight: 600;
          letter-spacing: -0.01em;
          color: var(--pp-text);
        }
        .error-body {
          max-height: min(320px, 50vh);
          overflow-y: auto;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
          user-select: text;
          padding: 12px 14px;
          border: 1px solid var(--pp-border);
          border-radius: 10px;
          background: rgba(128, 128, 128, 0.08);
          font-size: 13.5px;
          line-height: 1.55;
          color: var(--pp-text);
          box-sizing: border-box;
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
          line-height: 1.3;
        }
        .btn:focus-visible { outline: 2px solid var(--pp-muted); outline-offset: 2px; }
        .btn-secondary {
          background: var(--pp-btn-sec-bg);
          color: var(--pp-btn-sec-text);
          border-color: var(--pp-btn-sec-border);
        }
        .btn-secondary:hover { background: var(--pp-btn-sec-hover); }
        .btn-primary {
          background: var(--pp-btn-pri-bg);
          color: var(--pp-btn-pri-text);
          font-weight: 600;
        }
        .btn-primary:hover { background: var(--pp-btn-pri-hover); }
      </style>
      <div class="backdrop" role="presentation">
        <section class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="pp-error-title">
          <h2 id="pp-error-title">Plyph couldn’t complete the action</h2>
          <div class="error-body" tabindex="0"></div>
          <div class="dialog-footer">
            <button class="btn btn-secondary copy" type="button">Copy error</button>
            <button class="btn btn-primary close" type="button">Close</button>
          </div>
        </section>
      </div>`;
    root.querySelector('.error-body').textContent = message || 'Unknown error.';
    document.documentElement.append(host);
    root.querySelector('.close').addEventListener('click', closeDialog);
    root.querySelector('.copy').addEventListener('click', () => {
      copyText(message || '')
        .then(() => showToast('Copied'))
        .catch(() => showToast('Could not copy the error.', 'error', 3000));
    });
    let backdropMouseDownTarget = null;
    const backdrop = root.querySelector('.backdrop');
    backdrop?.addEventListener('mousedown', event => { backdropMouseDownTarget = event.target; });
    backdrop?.addEventListener('click', event => {
      if (event.target === backdrop && backdropMouseDownTarget === backdrop) closeDialog();
      backdropMouseDownTarget = null;
    });
    root.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeDialog();
    });
    root.querySelector('.close').focus();
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch {  }
    }
    const area = document.createElement('textarea');
    area.value = text;
    area.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.append(area);
    area.focus();
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    if (!copied) throw new Error('Could not copy.');
  }

  async function copyResult(textarea) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(textarea.value);
        return;
      } catch {  }
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

})();
