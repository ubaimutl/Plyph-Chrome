const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('page-controller.js', 'utf8');
function declaration(name) {
  const start = source.indexOf(`  function ${name}(`);
  const end = source.indexOf('\n  }', start) + 4;
  return source.slice(start, end);
}
class HTMLInputElement { constructor(type) { this.type = type; } }
class HTMLTextAreaElement {}
function setup(active) {
  const context = vm.createContext({HTMLInputElement, HTMLTextAreaElement,
    document: {activeElement: active}, snapshot: {text: 'old selection'},
    aggregateSelection: () => { throw new Error('Must not read password selection'); },
    legacyCaptureSelection: () => { throw new Error('Must not read password selection'); }});
  vm.runInContext(['passwordFieldFocused', 'isTextField', 'captureSelection'].map(declaration).join('\n'), context);
  return context;
}
test('password fields are excluded while supported text fields remain enabled', () => {
  const c = setup(null);
  assert.equal(c.isTextField(new HTMLInputElement('password')), false);
  for (const type of ['text', 'search', 'url', 'tel', 'email'])
    assert.equal(c.isTextField(new HTMLInputElement(type)), true);
  assert.equal(c.isTextField(new HTMLTextAreaElement()), true);
});
test('focused passwords clear cached selections without reading input', () => {
  for (const active of [new HTMLInputElement('password'),
    {shadowRoot: {activeElement: new HTMLInputElement('password')}}]) {
    const c = setup(active);
    assert.equal(c.captureSelection(), null);
    assert.equal(c.snapshot, null);
    let reply;
    c.sendResponse = value => { reply = value; };
    c.message = {type: 'CAPTURE_SELECTION'};
    vm.runInContext(declaration('handleRuntimeMessage'), c);
    c.handleRuntimeMessage(c.message, {}, c.sendResponse);
    assert.equal(reply.blocked, true);
    assert.equal(reply.text, '');
  }
});
