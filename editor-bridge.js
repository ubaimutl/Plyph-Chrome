(() => {
  const guard = Symbol.for('plyph.editorBridge');
  if (window[guard]) return;
  window[guard] = true;

  const REQUEST = 'plyph:editor-request';
  const RESPONSE = 'plyph:editor-response';

  function selectedEditors() {
    const out = [];
    try {
      const aceGlobal = window.ace;
      if (aceGlobal && typeof aceGlobal.edit === 'function') {
        for (const el of document.querySelectorAll('.ace_editor')) {
          try {
            const ed = aceGlobal.edit(el);
            const text = typeof ed.getSelectedText === 'function' ? ed.getSelectedText() : '';
            if (typeof text === 'string' && text.trim()) {
              out.push({
                text,
                replace: value => { ed.focus(); ed.session.replace(ed.getSelectionRange(), value); },
              });
            }
          } catch { }
        }
      }
      for (const el of document.querySelectorAll('.CodeMirror')) {
        try {
          const cm = el.CodeMirror;
          const text = cm && typeof cm.getSelection === 'function' ? cm.getSelection() : '';
          if (typeof text === 'string' && text.trim()) {
            out.push({text, replace: value => { cm.focus(); cm.replaceSelection(value); }});
          }
        } catch { }
      }
    } catch { }
    return out;
  }

  document.addEventListener(REQUEST, event => {
    const request = event.detail && typeof event.detail === 'object' ? event.detail : {};
    let result = {ok: false};
    try {
      const editors = selectedEditors();
      if (request.op === 'read') {
        result = {ok: true, texts: editors.map(editor => editor.text)};
      } else if (request.op === 'replace' && editors.length) {
        editors[0].replace(String(request.text ?? ''));
        result = {ok: true};
      }
    } catch { result = {ok: false}; }
    document.dispatchEvent(new CustomEvent(RESPONSE, {detail: result}));
  });
})();
