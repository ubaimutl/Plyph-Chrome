import {PROVIDERS, getSettings} from './shared.js';

let settings = await getSettings();
let saveTimer;
const $ = selector => document.querySelector(selector);
const modelCache = new Map();

for (const select of [$('#provider'), $('#run-provider'), $('#action-provider')]) {
  if (select !== $('#provider')) select.add(new Option('Use active provider', ''));
  for (const provider of PROVIDERS) select.add(new Option(provider.name, provider.id));
}

$('#provider').value = settings.provider;
$('#preview').checked = settings.previewResults;
$('#selection-trigger').checked = settings.selectionTrigger;
$('#history-enabled').checked = settings.historyEnabled;
$('#history-limit').value = settings.historyLimit || '';
$('#feedback-placement').value = settings.feedbackPlacement;
$('#language').value = settings.variables.language;
$('#tone').value = settings.variables.tone;
$('#style').value = settings.variables.style;
$('#prompt-correct').value = settings.prompts.correct;
$('#prompt-rewrite').value = settings.prompts.rewrite;
$('#prompt-run').value = settings.prompts.prompt;
$('#run-provider').value = settings.promptOptions.provider;
$('#run-model').value = settings.promptOptions.model;
$('#run-input').value = settings.promptOptions.inputLimit || '';
$('#run-output').value = settings.promptOptions.outputLimit || '';
renderProviderFields();
renderActions();

document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
  document.querySelectorAll('.tab,.page').forEach(item => item.classList.remove('active'));
  tab.classList.add('active');
  $(`#${tab.dataset.page}`).classList.add('active');
}));

$('#provider').addEventListener('change', () => { settings.provider = $('#provider').value; renderProviderFields(); queueSave(); });
$('#preview').addEventListener('change', () => { settings.previewResults = $('#preview').checked; queueSave(); });
$('#selection-trigger').addEventListener('change', () => { settings.selectionTrigger = $('#selection-trigger').checked; queueSave(); });
$('#history-enabled').addEventListener('change', () => { settings.historyEnabled = $('#history-enabled').checked; queueSave(); });
$('#history-limit').addEventListener('input', () => {
  const raw = Number($('#history-limit').value);
  settings.historyLimit = raw > 0 ? Math.min(500, Math.floor(raw)) : 0;
  queueSave();
});
$('#feedback-placement').addEventListener('change', () => { settings.feedbackPlacement = $('#feedback-placement').value; queueSave(); });
for (const [selector, key] of [['#language', 'language'], ['#tone', 'tone'], ['#style', 'style']]) {
  $(selector).addEventListener('input', () => { settings.variables[key] = $(selector).value; queueSave(); });
}
for (const [selector, key] of [['#prompt-correct', 'correct'], ['#prompt-rewrite', 'rewrite'], ['#prompt-run', 'prompt']]) {
  $(selector).addEventListener('input', () => { settings.prompts[key] = $(selector).value; queueSave(); });
}
for (const [selector, key] of [['#run-provider', 'provider'], ['#run-model', 'model'], ['#run-input', 'inputLimit'], ['#run-output', 'outputLimit']]) {
  $(selector).addEventListener('input', () => { settings.promptOptions[key] = key.endsWith('Limit') ? Number($(selector).value) || 0 : $(selector).value; queueSave(); });
}

$('#shortcuts').addEventListener('click', () => chrome.tabs.create({url: 'chrome://extensions/shortcuts'}));
$('#add-action').addEventListener('click', () => openAction());
$('#action-form').addEventListener('submit', async event => {
  if (event.submitter?.value === 'cancel') return;
  event.preventDefault();
  const action = {
    id: $('#action-id').value || crypto.randomUUID(), name: $('#action-name').value.trim(), prompt: $('#action-prompt').value,
    inputMode: $('#action-mode').value, provider: $('#action-provider').value, model: $('#action-model').value.trim(),
    inputLimit: Number($('#action-input').value) || 0, outputLimit: Number($('#action-output').value) || 0, enabled: $('#action-enabled').checked,
  };
  if (!action.name || (!action.prompt.trim() && action.inputMode !== 'prompt')) return;
  const index = settings.customActions.findIndex(item => item.id === action.id);
  if (index >= 0) settings.customActions[index] = action; else settings.customActions.push(action);
  await saveNow();
  renderActions();
  $('#action-dialog').close();
});

function renderProviderFields() {
  const provider = $('#provider').value;
  const root = $('#provider-fields');
  root.replaceChildren();
  const fields = document.createElement('div'); fields.className = 'fields two provider-config';
  fields.append(modelField(provider));
  if (provider === 'ollama') fields.append(field('Server URL', settings.ollamaUrl, false, value => { settings.ollamaUrl = value; queueSave(); }));
  else fields.append(field('API key', settings.apiKeys[provider] || '', true, value => { settings.apiKeys[provider] = value; queueSave(); }));
  root.append(fields);
}

function modelField(provider) {
  const label = document.createElement('label');
  label.textContent = 'Model';
  const controls = document.createElement('div');
  controls.className = 'model-picker';
  const select = document.createElement('select');
  select.className = 'model-select';
  select.setAttribute('aria-label', 'Discovered models');
  const input = document.createElement('input');
  input.value = settings.models[provider] || '';
  input.placeholder = provider === 'ollama' ? 'Or type a model name manually' : 'Or type a model name manually';
  input.autocomplete = 'off';
  input.addEventListener('input', () => {
    settings.models[provider] = input.value.trim();
    select.value = modelCache.get(provider)?.some(model => model.id === input.value) ? input.value : '';
    queueSave();
  });
  select.addEventListener('change', () => {
    if (!select.value) return;
    input.value = select.value;
    settings.models[provider] = select.value;
    queueSave();
  });
  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.className = 'secondary model-refresh';
  refresh.textContent = 'Refresh';
  const models = modelCache.get(provider) || [];
  applyModelOptions(select, models, input.value);
  const status = document.createElement('small');
  status.className = 'model-status';
  status.textContent = modelCache.has(provider)
    ? `${models.length} models loaded`
    : provider === 'ollama' ? 'Click Refresh to load installed models.' : 'Add your API key, then click Refresh.';
  refresh.addEventListener('click', () => refreshModelList(provider, input, select, status, refresh));
  controls.append(select, input, refresh);
  label.append(controls, status);
  return label;
}

function applyModelOptions(select, models, currentValue = '') {
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = models.length ? 'Choose a discovered model…' : 'Refresh to load models…';
  select.replaceChildren(placeholder, ...models.map(model => {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = model.name && model.name !== model.id ? `${model.name} (${model.id})` : model.id;
    return option;
  }));
  select.value = models.some(model => model.id === currentValue) ? currentValue : '';
}

async function refreshModelList(provider, input, select, status, button) {
  const originalText = button.textContent;
  button.disabled = true;
  status.className = 'model-status';
  status.textContent = 'Loading models…';
  try {
    const models = await fetchProviderModels(provider);
    modelCache.set(provider, models);
    applyModelOptions(select, models, input.value);
    status.textContent = models.length
      ? `${models.length} models loaded. Choose one above or type a custom model name.`
      : 'No models were returned. You can still type a custom model name.';
    if (!input.value && models[0]) {
      input.value = models[0].id;
      select.value = models[0].id;
      settings.models[provider] = models[0].id;
      queueSave();
    }
  } catch (error) {
    status.className = 'model-status error';
    status.textContent = error.message || 'Could not load models. You can type one manually.';
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function fetchProviderModels(provider) {
  const providerName = PROVIDERS.find(item => item.id === provider)?.name || provider;
  let data;
  if (provider === 'ollama') {
    const baseUrl = String(settings.ollamaUrl || '').trim().replace(/\/+$/, '');
    if (!baseUrl) throw new Error('Enter the Ollama server URL first.');
    data = await fetchModelJson(`${baseUrl}/api/tags`, {}, providerName);
    return uniqueModels((data.models || []).map(model => ({id: model.model || model.name, name: model.name})));
  }

  const key = settings.apiKeys[provider];
  if (!key) throw new Error(`Add your ${providerName} API key first.`);
  const endpoints = {
    groq: 'https://api.groq.com/openai/v1/models',
    gemini: `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(key)}`,
    openrouter: 'https://openrouter.ai/api/v1/models?output_modalities=text',
    cerebras: 'https://api.cerebras.ai/v1/models',
    openai: 'https://api.openai.com/v1/models',
    vercel: 'https://ai-gateway.vercel.sh/v1/models',
  };
  const headers = provider === 'gemini' ? {} : {Authorization: `Bearer ${key}`};
  data = await fetchModelJson(endpoints[provider], headers, providerName);
  if (provider === 'gemini') {
    return uniqueModels((data.models || [])
      .filter(model => model.supportedGenerationMethods?.includes('generateContent'))
      .map(model => ({id: model.name?.replace(/^models\//, ''), name: model.displayName || model.name})));
  }
  let models = (data.data || [])
    .filter(model => model.type ? model.type === 'language' : true)
    .map(model => ({id: model.id, name: model.name || model.id}));
  if (provider === 'openai') {
    models = models.filter(model => /^(gpt-|o\d)/.test(model.id) && !/(audio|image|realtime|search|transcribe|tts)/.test(model.id));
  } else if (provider === 'groq') {
    models = models.filter(model => !/(guard|whisper|tts)/i.test(model.id));
  }
  return uniqueModels(models);
}

async function fetchModelJson(url, headers, providerName) {
  let response;
  try {
    response = await fetch(url, {headers, signal: AbortSignal.timeout(20000)});
  } catch {
    throw new Error(`Could not connect to ${providerName}. Check the URL or your connection.`);
  }
  let data = {};
  try { data = await response.json(); } catch { /* handled below */ }
  if (response.ok) return data;
  const providerError = data?.error?.message || data?.error;
  const detail = typeof providerError === 'string' ? providerError : '';
  if (response.status === 401 || response.status === 403) throw new Error(`${providerName} rejected the API key. Check it and try again.`);
  if (response.status === 404) throw new Error(`${providerName} model list is unavailable.`);
  if (response.status === 429) throw new Error(`${providerName} rate limit reached. Try again later.`);
  throw new Error(detail || `${providerName} rejected the request (${response.status}).`);
}

function uniqueModels(models) {
  const seen = new Set();
  return models
    .filter(model => model?.id && !seen.has(model.id) && seen.add(model.id))
    .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
}

function field(labelText, value, secret, onInput) {
  const label = document.createElement('label'); label.textContent = labelText;
  const input = document.createElement('input'); input.value = value; input.type = secret ? 'password' : 'text'; input.autocomplete = 'off';
  input.addEventListener('input', () => onInput(input.value)); label.append(input); return label;
}

function renderActions() {
  const root = $('#action-list'); root.replaceChildren();
  if (!settings.customActions.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'No custom actions yet.'; root.append(empty); return; }
  settings.customActions.forEach((action, index) => {
    const row = document.createElement('div'); row.className = 'custom-row';
    const text = document.createElement('div'); text.className = 'custom-copy';
    const name = document.createElement('strong'); name.textContent = action.name;
    const detail = document.createElement('small'); detail.textContent = `${action.inputMode === 'prompt' ? 'Prompt' : 'Transform'} · ${action.provider ? PROVIDERS.find(p => p.id === action.provider)?.name : 'Active provider'}${action.enabled === false ? ' · Disabled' : ''}`;
    text.append(name, detail);
    const controls = document.createElement('div'); controls.className = 'row-buttons';
    controls.append(rowButton('Edit', () => openAction(action)), rowButton('↑', () => move(index, -1)), rowButton('↓', () => move(index, 1)), rowButton('Delete', () => removeAction(action.id), true));
    row.append(text, controls); root.append(row);
  });
}

function rowButton(text, click, danger = false) { const button = document.createElement('button'); button.className = danger ? 'text-button danger' : 'text-button'; button.textContent = text; button.addEventListener('click', click); return button; }
function move(index, direction) { const next = index + direction; if (next < 0 || next >= settings.customActions.length) return; [settings.customActions[index], settings.customActions[next]] = [settings.customActions[next], settings.customActions[index]]; saveNow(); renderActions(); }
function removeAction(id) { settings.customActions = settings.customActions.filter(item => item.id !== id); saveNow(); renderActions(); }

function openAction(action = {}) {
  $('#action-dialog-title').textContent = action.id ? 'Edit custom action' : 'New custom action';
  $('#action-id').value = action.id || ''; $('#action-name').value = action.name || ''; $('#action-prompt').value = action.prompt || '';
  $('#action-mode').value = action.inputMode || 'transform'; $('#action-provider').value = action.provider || ''; $('#action-model').value = action.model || '';
  $('#action-input').value = action.inputLimit || ''; $('#action-output').value = action.outputLimit || ''; $('#action-enabled').checked = action.enabled !== false;
  $('#action-dialog').showModal(); $('#action-name').focus();
}

function queueSave() { clearTimeout(saveTimer); $('#save-status').textContent = 'Saving…'; saveTimer = setTimeout(saveNow, 350); }
async function saveNow() { clearTimeout(saveTimer); await chrome.storage.local.set(settings); $('#save-status').textContent = 'Saved'; setTimeout(() => { $('#save-status').textContent = ''; }, 1200); }
