import {enabledActions, getSettings} from './shared.js';

const actionsRoot = document.querySelector('#actions');
const status = document.querySelector('#status');
document.querySelector('#settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
document.querySelector('#history').addEventListener('click', () => chrome.tabs.create({url: chrome.runtime.getURL('history.html')}));

const settings = await getSettings();
const builtInActions = [
  {name: 'Correct selected text', mode: 'correct'},
  {name: 'Rewrite selected text', mode: 'rewrite'},
  {name: 'Run selected prompt', mode: 'prompt'},
];
const customActions = enabledActions(settings).map(action => ({name: action.name, mode: 'custom', actionId: action.id}));

for (const action of [...builtInActions, ...customActions]) {
  if (action === customActions[0]) {
    const separator = document.createElement('div');
    separator.className = 'menu-separator';
    actionsRoot.append(separator);
  }
  const button = document.createElement('button');
  button.className = 'action-row menu-row';
  button.innerHTML = `<span class="action-glyph" aria-hidden="true">${actionIcon(action.mode)}</span><span class="action-label"></span>`;
  button.querySelector('.action-label').textContent = action.name;
  button.addEventListener('click', () => run(action, button));
  actionsRoot.append(button);
}

function actionIcon(mode) {
  if (mode === 'correct') return '<svg viewBox="0 0 20 20"><path d="m4 10 3.2 3.2L16 4.8"/></svg>';
  if (mode === 'rewrite') return '<svg viewBox="0 0 20 20"><path d="M15.5 7A6 6 0 1 0 16 12"/><path d="M12 3h4v4"/></svg>';
  if (mode === 'prompt') return '<svg viewBox="0 0 20 20"><path class="filled" d="m7 4 8 6-8 6Z"/></svg>';
  return '<svg viewBox="0 0 20 20"><path d="m10 2 1.5 5.1L16.5 9l-5 1.9L10 16l-1.5-5.1L3.5 9l5-1.9Z"/></svg>';
}

async function run(action, button) {
  status.hidden = true;
  document.querySelectorAll('.action-row').forEach(item => item.disabled = true);
  button.classList.add('busy');
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  try {
    const response = await chrome.runtime.sendMessage({type: 'RUN_ACTION', tabId: tab?.id, action});
    if (!response?.ok) throw new Error(response?.error || 'Could not run this action.');
    window.close();
  } catch (error) {
    status.textContent = error.message || 'Could not run this action.';
    status.hidden = false;
    document.querySelectorAll('.action-row').forEach(item => item.disabled = false);
    button.classList.remove('busy');
  }
}
