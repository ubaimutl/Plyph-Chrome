const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');

// Real layout tests, without third-party dependencies. Set CHROME_BIN if needed.
test('selection popup positioning, isolation, collision handling and dismissal', async t => {
  const executable = process.env.CHROME_BIN || '/opt/google/chrome/chrome';
  if (!fs.existsSync(executable)) return t.skip('Set CHROME_BIN to run browser layout checks');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'plyph-popup-'));
  const chrome = spawn(executable, ['--headless=new', '--no-sandbox', '--disable-gpu',
    '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], {stdio: ['ignore', 'ignore', 'pipe']});
  let socket;
  t.after(async () => {
    socket?.close();
    chrome.kill();
    await new Promise(resolve => { if (chrome.exitCode !== null || chrome.signalCode !== null) resolve(); else chrome.once('exit', resolve); });
    fs.rmSync(profile, {recursive: true, force: true});
  });
  const endpoint = await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('Chrome startup timed out')), 10000);
    chrome.stderr.on('data', data => {
      output += data;
      const match = output.match(/DevTools listening on ws:\/\/(127\.0\.0\.1:\d+)/);
      if (match) { clearTimeout(timeout); resolve(`http://${match[1]}`); }
    });
    chrome.once('error', reject);
    chrome.once('exit', code => { clearTimeout(timeout); reject(new Error(`Chrome exited: ${code}\n${output}`)); });
  });
  const targets = await (await fetch(`${endpoint}/json/list`)).json();
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolve => socket.addEventListener('open', resolve, {once: true}));
  let nextId = 0;
  const requests = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const pending = requests.get(message.id);
    if (pending) { requests.delete(message.id); message.error ? pending.reject(message.error) : pending.resolve(message.result); }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId; requests.set(id, {resolve, reject}); socket.send(JSON.stringify({id, method, params}));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + result.exceptionDetails.exception?.description);
    return result.result.value;
  };
  await send('Emulation.setDeviceMetricsOverride', {width: 900, height: 650, deviceScaleFactor: 1, mobile: false});
  await evaluate(`document.body.innerHTML = '<style>body{margin:0;font:20px/28px sans-serif}p{margin:0;position:absolute;left:120px;top:160px;width:350px}input{position:absolute;left:120px;top:330px;width:350px}</style><p id="text">A selected passage with enough words to wrap onto several lines for testing backward selections.</p><input id="field" value="A selected input passage"><input id="stale" value="Old hidden selection" style="top:400px">';
    window.chrome = {runtime: {id: 'test', sendMessage: async () => ({selectionTrigger: true, toolbarActions: ['correct', 'rewrite']}), onMessage:{addListener(handler){window.__plyphRuntimeMessage=handler;},removeListener(){}}}};`);
  await evaluate(fs.readFileSync(path.join(__dirname, '..', 'page-controller.js'), 'utf8'));
  const settle = () => evaluate('new Promise(resolve => setTimeout(resolve, 420))');
  const popup = () => evaluate(`(() => {const h=document.getElementById('plyph-trigger'); if(!h)return null; const r=h.shadowRoot.querySelector('.wrapper').getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,topLayer:h.matches(':popover-open')};})()`);
  const select = async (backward = false) => {
    await evaluate(`(() => {
      document.activeElement?.blur();
      document.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,isPrimary:true}));
      const n=document.getElementById('text').firstChild;const s=getSelection();s.removeAllRanges();
      s.setBaseAndExtent(n,${backward ? 'n.length' : '0'},n,${backward ? '0' : 'n.length'});
      const rects=[...s.getRangeAt(0).getClientRects()];const r=rects[${backward ? '0' : 'rects.length-1'}];
      document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,isPrimary:true,clientX:r.${backward ? 'left' : 'right'},clientY:r.bottom-3}));
    })()`);
    await settle();
  };
  await select();
  assert.ok((await popup())?.topLayer, 'uses browser top layer');
  await evaluate("const unrelated=document.createElement('div');unrelated.id='scroll-panel';document.body.append(unrelated);unrelated.dispatchEvent(new Event('scroll'))");
  await settle(); assert.ok(await popup(), 'unrelated autocomplete scrolling does not dismiss popup');
  await send('Emulation.setDeviceMetricsOverride', {width: 900, height: 620, deviceScaleFactor: 1, mobile: false});
  await settle(); assert.ok(await popup(), 'viewport resize repositions instead of dismissing popup');
  await send('Emulation.setDeviceMetricsOverride', {width: 900, height: 650, deviceScaleFactor: 1, mobile: false});
  await settle();
  await evaluate("document.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}));document.dispatchEvent(new PointerEvent('pointercancel',{pointerType:'mouse'}));document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0,clientX:260,clientY:220}));");
  await settle(); assert.ok(await popup(), 'native mouseup still works after pointer cancellation');

  await evaluate("document.documentElement.style.transform='translate(35px, 20px)'");
  await settle();
  await select(true);
  let box = await popup();
  assert.ok(box && box.left >= 150 && box.top < 270, 'backward selection stays near first line despite transformed root');
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));document.dispatchEvent(new KeyboardEvent('keyup',{key:'Escape',bubbles:true}));document.dispatchEvent(new Event('selectionchange'))");
  await settle(); assert.equal(await popup(), null, 'Escape persists across selection events');
  await select();
  await evaluate("window.dispatchEvent(new Event('scroll'));document.dispatchEvent(new Event('selectionchange'))");
  await settle(); assert.equal(await popup(), null, 'scroll does not resurrect popup');
  await select();
  await evaluate("document.getElementById('text').style.top='200px'");
  await settle(); assert.equal(await popup(), null, 'layout shifts dismiss stale anchor');
  await evaluate("document.getElementById('text').style.top='160px';document.documentElement.style.transform='none'");
  await settle();
  await select();
  box = await popup(); assert.ok(box);
  await evaluate(`(() => {const b=document.createElement('button');b.id='obstacle';b.textContent='Website action';Object.assign(b.style,{position:'fixed',left:'${box.left}px',top:'${box.top}px',width:'${box.right-box.left}px',height:'${box.bottom-box.top}px',zIndex:'999'});document.body.append(b)})()`);
  await settle();
  const moved = await popup();
  assert.ok(!moved || moved.top !== box.top || moved.left !== box.left, 'moves away from late website popup');
  await evaluate("document.getElementById('obstacle').remove();document.getElementById('text').style.cssText='left:540px;top:540px;width:350px'");
  await select();
  box = await popup();
  assert.ok(box && box.right <= 892 && box.bottom <= 642, 'flips above near viewport edges');
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));document.getElementById('text').style.cssText='';");
  await evaluate(`(() => {document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',shiftKey:true,bubbles:true}));const n=document.getElementById('text').firstChild;getSelection().setBaseAndExtent(n,0,n,8);document.dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowRight',shiftKey:true,bubbles:true}));})()`);
  await settle(); assert.ok(await popup(), 'keyboard selections show popup');
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'x',bubbles:true}));document.dispatchEvent(new Event('selectionchange'))");
  await settle(); assert.equal(await popup(), null, 'typing dismisses popup');
  await evaluate("document.getElementById('stale').setSelectionRange(0,10)");
  await evaluate(`(() => {const f=document.getElementById('field');document.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,isPrimary:true}));f.focus();f.setSelectionRange(2,12);document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,isPrimary:true,clientX:230,clientY:345}));})()`);
  await settle();
  box = await popup(); assert.ok(box && box.top > 290 && box.top < 400, 'anchors only to focused input');
  await evaluate("document.getElementById('plyph-trigger').shadowRoot.querySelector('.dot').click()");
  assert.ok(await popup(), 'expansion keeps selected input available');
  await evaluate("document.getElementById('plyph-trigger').shadowRoot.querySelector('.more').click()");
  await settle();
  assert.ok(await popup(), 'opening menu retains selection');
  assert.equal(await evaluate("document.getElementById('plyph-trigger').shadowRoot.querySelector('.menu').hidden"), false, 'overflow menu is visible');
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));document.getElementById('field').blur();getSelection().removeAllRanges()");
  const drag = await evaluate(`(() => {const n=document.getElementById('text').firstChild;const r=document.createRange();r.setStart(n,0);r.setEnd(n,8);const b=r.getBoundingClientRect();return {x:b.left+1,y:b.top+b.height/2,end:b.right-1}})()`);
  await send('Input.dispatchMouseEvent', {type:'mouseMoved',x:drag.x,y:drag.y});
  await send('Input.dispatchMouseEvent', {type:'mousePressed',x:drag.x,y:drag.y,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent', {type:'mouseMoved',x:drag.end,y:drag.y,button:'left',buttons:1});
  await send('Input.dispatchMouseEvent', {type:'mouseReleased',x:drag.end,y:drag.y,button:'left',clickCount:1});
  await settle(); assert.ok(await popup(), 'real browser mouse drag shows popup');
  await evaluate(`(() => {
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    const shell=document.createElement('div');shell.id='search-shell';
    shell.style.cssText='position:absolute;left:100px;top:280px;width:600px;height:300px;z-index:99;background:white';
    shell.innerHTML='<textarea id="search" style="box-sizing:border-box;position:absolute;left:20px;top:20px;width:525px;height:50px;padding:14px 0 0;font:16px/22px sans-serif">Hello from the search field</textarea><div style="position:absolute;left:0;top:75px;width:600px;height:220px;z-index:999;background:white">Search suggestions</div>';
    document.body.append(shell);const f=shell.querySelector('textarea');
    document.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,isPrimary:true}));
    f.focus();f.setSelectionRange(0,f.value.length);
    document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,isPrimary:true,clientX:320,clientY:326}));
  })()`);
  await settle(); assert.ok(await popup(), 'padded search input and positioned suggestions do not suppress mouse popup');
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'a',ctrlKey:true,bubbles:true}));document.dispatchEvent(new KeyboardEvent('keyup',{key:'a',ctrlKey:true,bubbles:true}));");
  await settle(); assert.ok(await popup(), 'padded search input works with keyboard selection');
  await evaluate("document.getElementById('search').style.cssText='box-sizing:border-box;position:fixed;left:0;top:80px;width:900px;height:550px;padding:10px 10px 10px 20px;font:16px/27.2px sans-serif';document.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,isPrimary:true}));document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,isPrimary:true,clientX:245,clientY:115}));");
  await settle(); assert.ok(await popup(), 'full-window note textarea leaves the popup visible beside the release point');
  await evaluate("document.getElementById('search').blur();getSelection().removeAllRanges();document.dispatchEvent(new Event('selectionchange'))");
  await settle(); assert.ok(await popup(), 'another extension changing focus/selection does not discard the captured text');
  await evaluate("document.getElementById('search').value='The selected text was edited';");
  await settle(); assert.equal(await popup(), null, 'editing the captured text invalidates the popup');
  await evaluate("document.getElementById('search-shell').remove();");
  await evaluate(`(() => {document.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,isPrimary:true}));const f=document.getElementById('field');f.focus();f.setSelectionRange(0,8);document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,isPrimary:true,clientX:170,clientY:345}));})()`);
  await settle();
  await evaluate("document.getElementById('field').type='password';document.dispatchEvent(new Event('selectionchange'))");
  await settle(); assert.equal(await popup(), null, 'password fields never show selection popup');
  await evaluate(`(() => {document.getElementById('field').blur();const h=document.createElement('div');h.id='shadow';h.style.cssText='position:absolute;left:100px;top:100px';const root=h.attachShadow({mode:'open'});root.innerHTML='<p>Text inside a shadow root</p>';document.body.append(h);const p=root.querySelector('p');p.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,composed:true,button:0,isPrimary:true}));const s=getSelection();s.setBaseAndExtent(p.firstChild,0,p.firstChild,12);const r=root.getSelection().getRangeAt(0).getBoundingClientRect();p.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,composed:true,button:0,isPrimary:true,clientX:r.right,clientY:r.bottom-2}));})()`);
  await settle(); assert.ok(await popup(), 'selection inside shadow DOM uses its own text range');
  await evaluate(`(() => {const b=document.createElement('button');b.id='cover';b.style.cssText='position:fixed;inset:0;width:100vw;height:100vh;z-index:99999';document.body.append(b)})()`);
  await settle(); assert.equal(await popup(), null, 'hides when all nearby placements are obstructed');
  await evaluate("document.getElementById('cover').remove();document.dispatchEvent(new Event('selectionchange'))");
  await settle(); assert.equal(await popup(), null, 'clearing an obstruction does not resurrect dismissed popup');
  await evaluate(`(() => {
    document.getElementById('shadow').remove();
    document.getElementById('field').type='text';
    const f=document.getElementById('field');f.focus();f.setSelectionRange(0,8);
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'a',ctrlKey:true,bubbles:true}));
    document.dispatchEvent(new KeyboardEvent('keyup',{key:'a',ctrlKey:true,bubbles:true}));
  })()`);
  await settle(); assert.ok(await popup(), 'fresh selection is available for the toolbar capture check');
  await evaluate("document.getElementById('field').setSelectionRange(0,0);document.getElementById('field').blur();getSelection().removeAllRanges();");
  assert.equal(await evaluate("new Promise(resolve=>window.__plyphRuntimeMessage({type:'CAPTURE_SELECTION',useSavedSelection:true},{},reply=>resolve(reply.text)))"), 'A select', 'toolbar keeps the deliberate saved selection');
  assert.equal(await evaluate("new Promise(resolve=>window.__plyphRuntimeMessage({type:'CAPTURE_SELECTION'},{},reply=>resolve(reply.text)))"), '', 'ordinary capture does not return the old toolbar snapshot');
  await evaluate('globalThis.__plyphController.dispose()');
  await settle(); assert.equal(await popup(), null, 'disposing clears popup and watchers');
  const production = fs.readFileSync(path.join(__dirname, '..', 'page-controller.js'), 'utf8');
  const functionStart = production.indexOf('  function replaceSelection(');
  const replacementFunction = production.slice(functionStart, production.indexOf('\n  }', functionStart) + 4);
  const replacementResult = await evaluate(`(() => {
    const host=document.createElement('div');document.body.append(host);
    const root=host.attachShadow({mode:'open'});root.innerHTML='<div contenteditable="true">Shadow selected text</div>';
    const editor=root.firstChild;editor.focus();
    const range=document.createRange();range.selectNodeContents(editor);
    let snapshot={kind:'range',range,text:editor.textContent};
    const notices=[];const showToast=(...args)=>notices.push(args);const closeDialog=()=>{};
    ${replacementFunction}
    replaceSelection('Updated shadow text');
    const updated=editor.textContent;
    snapshot={kind:'range',range:null,text:updated};
    const before=document.body.innerHTML;
    replaceSelection('Must not be inserted');
    return {updated,unchanged:before===document.body.innerHTML,error:notices.at(-1)[1]};
  })()`);
  assert.equal(replacementResult.updated,'Updated shadow text', 'valid shadow DOM ranges can be replaced');
  assert.equal(replacementResult.unchanged,true, 'null-range preview replacement leaves the DOM untouched');
  assert.equal(replacementResult.error,'error');
});
