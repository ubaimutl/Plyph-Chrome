const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('page-controller.js', 'utf8');
function declaration(name) {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf('\n  }', start) + 4);
}
function captureSetup(current) {
  const context = vm.createContext({snapshot:{kind:'range',text:'PREVIOUS_SELECTION'},
    passwordFieldFocused:()=>false,captureSelection:()=>current,findEditorTarget:()=>null});
  vm.runInContext(declaration('handleRuntimeMessage'),context);
  const capture = (extra={}) => {
    let response;
    context.handleRuntimeMessage({type:'CAPTURE_SELECTION',...extra},{},value=>response=value);
    return response;
  };
  return {context,capture};
}
test('empty and whitespace captures discard previous text',()=>{
  for (const current of [null,{kind:'range',text:''},{kind:'range',text:'  \n '}]) {
    const {context,capture}=captureSetup(current);
    assert.equal(capture().text,'');
    assert.equal(context.snapshot,null);
  }
});
test('fresh captures replace previous snapshots',()=>{
  const current={kind:'range',text:'NEW_SELECTION'};
  const {context,capture}=captureSetup(current);
  assert.equal(capture().text,current.text);
  assert.equal(context.snapshot,current);
});
test('only explicit toolbar captures preserve a saved selection after focus moves',()=>{
  const {context,capture}=captureSetup(null);
  const saved=context.snapshot;
  assert.equal(capture({useSavedSelection:true}).text,'PREVIOUS_SELECTION');
  assert.equal(context.snapshot,saved);
  assert.equal(capture().text,'');
  assert.equal(context.snapshot,null);
});
test('password guard also blocks explicitly saved selections',()=>{
  const {context,capture}=captureSetup(null);
  context.passwordFieldFocused=()=>true;
  const reply=capture({useSavedSelection:true});
  assert.equal(reply.blocked,true);
  assert.equal(reply.text,'');
  assert.equal(context.snapshot,null);
});
function replacementSetup(range) {
  const effects=[];
  const context=vm.createContext({snapshot:{kind:'range',range,text:'selected'},
    window:{getSelection:()=>{effects.push('getSelection');throw Error('Must not access the live selection');}},
    document:{execCommand:()=>{effects.push('edit');return true;}},
    showToast:(...args)=>effects.push(['toast',...args]),closeDialog:()=>effects.push('close')});
  vm.runInContext(declaration('replaceSelection'),context);
  return {context,effects};
}
test('null, detached, collapsed and cross-root ranges are rejected before changing selection or text',()=>{
  const root={};
  const connected={isConnected:true,getRootNode:()=>root};
  for (const range of [null,{},
    {startContainer:{isConnected:false},endContainer:connected},
    {startContainer:connected,endContainer:connected,collapsed:true},
    {startContainer:connected,endContainer:{isConnected:true,getRootNode:()=>({})},collapsed:false}]) {
    const {context,effects}=replacementSetup(range);
    assert.doesNotThrow(()=>context.replaceSelection('replacement'));
    assert.equal(effects.length,1);
    assert.equal(effects[0][0],'toast');
    assert.equal(effects[0][2],'error');
  }
});
test('valid shadow ranges use the selection belonging to their shadow root',()=>{
  let restored=null;
  const effects=[];
  const selection={rangeCount:0,removeAllRanges(){effects.push('clear');},addRange(range){restored=range;this.rangeCount=1;}};
  const root={getSelection:()=>selection};
  const node={isConnected:true,getRootNode:()=>root};
  const range={startContainer:node,endContainer:node,collapsed:false};
  const {context}=replacementSetup(range);
  context.document.execCommand=()=>{effects.push('edit');return true;};
  context.replaceSelection('replacement');
  assert.equal(restored,range);
  assert.deepEqual(effects,['clear','edit']);
  assert.equal(context.snapshot,null);
});
test('restoration errors are reported without changing page text',()=>{
  let edited=false;
  const root={getSelection:()=>({removeAllRanges(){},addRange(){throw Error('unsupported range');}})};
  const node={isConnected:true,getRootNode:()=>root};
  const {context,effects}=replacementSetup({startContainer:node,endContainer:node,collapsed:false});
  context.document.execCommand=()=>{edited=true;return true;};
  assert.doesNotThrow(()=>context.replaceSelection('replacement'));
  assert.equal(edited,false);
  assert.equal(effects[0][0],'toast');
  assert.equal(effects[0][2],'error');
});

test('background requests saved captures only for actions initiated in the page toolbar',async()=>{
  const background=fs.readFileSync('background.js','utf8');
  const start=background.indexOf('chrome.runtime.onMessage.addListener(');
  const listener=background.slice(start,background.indexOf('\n});',start)+4);
  let handler;
  const calls=[];
  const context=vm.createContext({chrome:{runtime:{onMessage:{addListener(value){handler=value;}}}},
    handleActionRequest:async(...args)=>{calls.push(args);return {ok:true};}});
  vm.runInContext(listener,context);
  handler({type:'RUN_ACTION',tabId:7,action:{mode:'correct'}},{},()=>{});
  handler({type:'RUN_ACTION_FROM_PAGE',action:{mode:'correct'},text:'chosen text'},{tab:{id:7}},()=>{});
  assert.equal(calls[0][3],undefined);
  assert.equal(calls[1][3],true);
});
test('saved-selection intent reaches the content script capture request',async()=>{
  const background=fs.readFileSync('background.js','utf8');
  const start=background.indexOf('async function runOnTab(');
  const code=background.slice(start,background.indexOf('\n}',start)+2);
  for(const useSavedSelection of [false,true]){
    const messages=[];
    const stop=new Error('Stop before processing text');
    const context=vm.createContext({ensureContent:async()=>{},getSettings:async()=>{throw stop;},
      chrome:{tabs:{sendMessage:async(_tab,message)=>{messages.push(message);return {text:'chosen text'};}}}});
    vm.runInContext(code,context);
    await assert.rejects(context.runOnTab(7,{mode:'correct'},'',useSavedSelection),error=>error===stop);
    const capture=messages.find(message=>message.type==='CAPTURE_SELECTION');
    assert.equal(capture.useSavedSelection,useSavedSelection);
  }
});
