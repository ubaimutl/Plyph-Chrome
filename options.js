import {
  PROVIDERS,
  disableApiKeyVault,
  enableApiKeyVault,
  getSettings,
  lockApiKeyVault,
  resetApiKeyVault,
  saveSettings,
  unlockApiKeyVault,
} from './shared.js';

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
$('#run-output-format').value = settings.promptOptions.outputFormat || 'auto';
renderVaultState();
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
$('#vault-enabled').addEventListener('change', handleVaultToggle);
$('#vault-enable').addEventListener('click', enableVault);
$('#vault-cancel').addEventListener('click', () => {
  $('#vault-enabled').checked = false;
  clearVaultPasswords();
  renderVaultState();
});
$('#vault-unlock').addEventListener('click', unlockVault);
$('#vault-unlock-password').addEventListener('keydown', event => {
  if (event.key === 'Enter') unlockVault();
});
$('#vault-lock').addEventListener('click', lockVault);
$('#vault-disable').addEventListener('click', disableVault);
$('#vault-reset').addEventListener('click', resetVault);
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
for (const [selector, key] of [['#run-provider', 'provider'], ['#run-model', 'model'], ['#run-input', 'inputLimit'], ['#run-output', 'outputLimit'], ['#run-output-format', 'outputFormat']]) {
  $(selector).addEventListener('input', () => { settings.promptOptions[key] = key.endsWith('Limit') ? Number($(selector).value) || 0 : $(selector).value; queueSave(); });
  $(selector).addEventListener('change', () => { settings.promptOptions[key] = key.endsWith('Limit') ? Number($(selector).value) || 0 : $(selector).value; queueSave(); });
}

$('#shortcuts').addEventListener('click', () => chrome.tabs.create({url: 'chrome://extensions/shortcuts'}));
$('#add-action').addEventListener('click', () => openAction());
$('#action-form').addEventListener('submit', async event => {
  if (event.submitter?.value === 'cancel') return;
  event.preventDefault();
  const action = {
    id: $('#action-id').value || crypto.randomUUID(), name: $('#action-name').value.trim(), prompt: $('#action-prompt').value,
    inputMode: $('#action-mode').value, outputFormat: $('#action-output-format').value || 'auto', provider: $('#action-provider').value, model: $('#action-model').value.trim(),
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
  if (provider === 'ollama') {
    fields.append(field('Server URL', settings.ollamaUrl, false, value => { settings.ollamaUrl = value; queueSave(); }));
  } else if (provider === 'custom_openai') {
    fields.append(field('Base URL', settings.customOpenAiUrl || '', false, async value => {
      settings.customOpenAiUrl = value.trim();
      queueSave();
      await ensureOriginPermission(value);
    }, false, 'e.g. http://127.0.0.1:8000/v1 or https://api.example.com/v1'));
    fields.append(field(
      'API key (optional)',
      settings.apiKeys[provider] || '',
      true,
      value => { settings.apiKeys[provider] = value; queueSave(); },
      settings.vaultLocked,
    ));
  } else {
    if (provider === 'cloudflare') {
      fields.append(field('Account ID', settings.cloudflareAccountId || '', false, value => { settings.cloudflareAccountId = value.trim(); queueSave(); }));
    }
    fields.append(field(
      provider === 'cloudflare' ? 'API token' : 'API key',
      settings.apiKeys[provider] || '',
      true,
      value => { settings.apiKeys[provider] = value; queueSave(); },
      settings.vaultLocked,
    ));
  }
  root.append(fields);
  if (provider === 'cloudflare') {
    root.append(
      reasoningOption(),
      providerNotice('ⓘ', 'Free usage', 'Free tier includes 10,000 Neurons per day.'),
    );
  }
  root.append(providerNotice(
    '⚠',
    provider === 'ollama' ? 'Model resource usage' : 'Model usage and cost',
    provider === 'ollama'
      ? 'Larger models may require more memory, processing power, and response time on your device.'
      : 'Larger models may use provider allowances faster or incur charges, depending on your account.',
    true,
  ));
}

function renderVaultState() {
  const enabled = Boolean(settings.apiKeyVault);
  $('#vault-enabled').checked = enabled;
  $('#vault-setup').hidden = enabled || !$('#vault-enabled').checked;
  $('#vault-locked').hidden = !enabled || !settings.vaultLocked;
  $('#vault-unlocked').hidden = !enabled || settings.vaultLocked;
  if (!enabled && !$('#vault-enabled').checked) $('#vault-setup').hidden = true;
}

function handleVaultToggle() {
  setVaultMessage('');
  if ($('#vault-enabled').checked && !settings.apiKeyVault) {
    $('#vault-setup').hidden = false;
    $('#vault-password').focus();
    return;
  }
  if (!$('#vault-enabled').checked && settings.apiKeyVault) {
    $('#vault-enabled').checked = true;
    disableVault();
  }
}

async function enableVault() {
  const password = $('#vault-password').value;
  if (password.length < 8) {
    setVaultMessage('Use a vault password with at least 8 characters.', true);
    return;
  }
  if (password !== $('#vault-password-confirm').value) {
    setVaultMessage('The vault passwords do not match.', true);
    return;
  }
  $('#vault-enable').disabled = true;
  try {
    clearTimeout(saveTimer);
    settings.apiKeyVault = await enableApiKeyVault(settings.apiKeys, password);
    settings.vaultLocked = false;
    await saveSettings(settings);
    clearVaultPasswords();
    renderVaultState();
    renderProviderFields();
    setVaultMessage('API-key encryption is enabled. Keep this password safe; Plyph cannot recover it.');
  } catch (error) {
    settings = await getSettings();
    renderVaultState();
    renderProviderFields();
    setVaultMessage(error.message || 'Could not enable API-key encryption.', true);
  } finally {
    $('#vault-enable').disabled = false;
  }
}

async function unlockVault() {
  const password = $('#vault-unlock-password').value;
  if (!password) {
    setVaultMessage('Enter the vault password.', true);
    return;
  }
  $('#vault-unlock').disabled = true;
  try {
    settings.apiKeys = await unlockApiKeyVault(settings.apiKeyVault, password);
    settings.vaultLocked = false;
    $('#vault-unlock-password').value = '';
    renderVaultState();
    renderProviderFields();
    setVaultMessage('Vault unlocked for this Chrome session.');
  } catch (error) {
    setVaultMessage(error.message || 'Could not unlock the API-key vault.', true);
  } finally {
    $('#vault-unlock').disabled = false;
  }
}

async function lockVault() {
  clearTimeout(saveTimer);
  try {
    await saveSettings(settings);
  } catch (error) {
    setVaultMessage(error.message || 'Could not save API keys before locking.', true);
    return;
  }
  await lockApiKeyVault();
  settings.apiKeys = {};
  settings.vaultLocked = true;
  renderVaultState();
  renderProviderFields();
  setVaultMessage('Vault locked.');
}

async function disableVault() {
  if (settings.vaultLocked) {
    $('#vault-enabled').checked = true;
    setVaultMessage('Unlock the vault before turning off encryption.', true);
    $('#vault-unlock-password').focus();
    return;
  }
  if (!confirm('Turn off encryption? Your API keys will be saved unencrypted in Chrome extension storage.')) {
    $('#vault-enabled').checked = true;
    return;
  }
  await disableApiKeyVault(settings.apiKeys);
  settings.apiKeyVault = null;
  settings.vaultLocked = false;
  await saveSettings(settings);
  renderVaultState();
  renderProviderFields();
  setVaultMessage('Encryption is off. API keys now use the standard no-password storage.');
}

async function resetVault() {
  if (!confirm('Reset the encrypted vault? This permanently deletes every saved API key. Other Plyph settings will remain.')) return;
  await resetApiKeyVault();
  settings.apiKeys = {};
  settings.apiKeyVault = null;
  settings.vaultLocked = false;
  renderVaultState();
  renderProviderFields();
  setVaultMessage('Encrypted API keys were deleted. Encryption is off.');
}

function clearVaultPasswords() {
  $('#vault-password').value = '';
  $('#vault-password-confirm').value = '';
  $('#vault-unlock-password').value = '';
}

function setVaultMessage(message, error = false) {
  const element = $('#vault-message');
  element.textContent = message;
  element.classList.toggle('error', error);
}

function reasoningOption() {
  const label = document.createElement('label');
  label.className = 'check-row provider-reasoning';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = settings.cloudflareReasoningEnabled === true;
  input.addEventListener('change', () => {
    settings.cloudflareReasoningEnabled = input.checked;
    queueSave();
  });
  const copy = document.createElement('span');
  const title = document.createElement('strong');
  title.textContent = 'Enable Qwen reasoning';
  const description = document.createElement('small');
  description.textContent = 'Optional for supported Qwen 3 models. Leave off for faster, lower-usage text transformations.';
  copy.append(title, description);
  label.append(input, copy);
  return label;
}

function providerNotice(symbol, titleText, descriptionText, warning = false) {
  const row = document.createElement('div');
  row.className = `provider-notice${warning ? ' warning' : ''}`;
  const icon = document.createElement('span');
  icon.className = 'provider-notice-icon';
  icon.textContent = symbol;
  icon.setAttribute('aria-hidden', 'true');
  const copy = document.createElement('span');
  const title = document.createElement('strong');
  title.textContent = titleText;
  const description = document.createElement('small');
  description.textContent = descriptionText;
  copy.append(title, description);
  row.append(icon, copy);
  return row;
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
    : provider === 'ollama'
      ? 'Click Refresh to load installed models.'
      : provider === 'cloudflare'
        ? 'Add your API token and Account ID, then click Refresh.'
        : 'Add your API key, then click Refresh.';
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

  if (provider === 'custom_openai') {
    const rawUrl = String(settings.customOpenAiUrl || '').trim();
    if (!rawUrl) throw new Error('Enter the Custom OpenAI Base URL first.');
    await ensureOriginPermission(rawUrl);
    const baseUrl = rawUrl.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
    const key = settings.apiKeys[provider];
    const headers = key ? {Authorization: `Bearer ${key}`} : {};
    try {
      data = await fetchModelJson(`${baseUrl}/models`, headers, providerName, provider);
    } catch (error) {
      throw new Error(`${error.message || 'Could not load models from /models.'} You can type your model name directly.`);
    }
    const rawList = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
    const models = rawList
      .filter(model => model && (model.id || model.name))
      .map(model => ({id: model.id || model.name, name: model.name || model.id}));
    return uniqueModels(models);
  }

  if (settings.vaultLocked) throw new Error('Unlock your encrypted API keys first.');
  const key = settings.apiKeys[provider];
  if (!key) throw new Error(provider === 'cloudflare'
    ? 'Add your Cloudflare Workers AI API token first.'
    : `Add your ${providerName} API key first.`);
  if (provider === 'cloudflare') {
    const accountId = String(settings.cloudflareAccountId || '').trim();
    if (!accountId) throw new Error('Add your Cloudflare Account ID first.');
    data = await fetchModelJson(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/models/search?task=${encodeURIComponent('Text Generation')}&hide_experimental=true&per_page=100`,
      {Authorization: `Bearer ${key}`}, providerName, provider);
    return uniqueModels((Array.isArray(data.result) ? data.result : []).map(model => ({
      id: model.name || model.id,
      name: model.name || model.id,
    })));
  }
  const endpoints = {
    groq: 'https://api.groq.com/openai/v1/models',
    bai: 'https://api.b.ai/v1/models',
    deepseek: 'https://api.deepseek.com/models',
    gemini: `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(key)}`,
    openrouter: 'https://openrouter.ai/api/v1/models?output_modalities=text',
    cerebras: 'https://api.cerebras.ai/v1/models',
    openai: 'https://api.openai.com/v1/models',
    vercel: 'https://ai-gateway.vercel.sh/v1/models',
  };
  const headers = provider === 'gemini' ? {} : {Authorization: `Bearer ${key}`};
  data = await fetchModelJson(endpoints[provider], headers, providerName, provider);
  if (provider === 'gemini') {
    return uniqueModels((data.models || [])
      .filter(model => model.supportedGenerationMethods?.includes('generateContent'))
      .map(model => ({id: model.name?.replace(/^models\//, ''), name: model.displayName || model.name})));
  }
  let models = (data.data || [])
    .filter(model => provider !== 'bai' || !model.supported_endpoint_types || model.supported_endpoint_types.includes('openai'))
    .filter(model => model.type ? model.type === 'language' : true)
    .map(model => ({id: model.id, name: model.name || model.id}));
  if (provider === 'openai') {
    models = models.filter(model => /^(gpt-|o\d)/.test(model.id) && !/(audio|image|realtime|search|transcribe|tts)/.test(model.id));
  } else if (provider === 'groq') {
    models = models.filter(model => !/(guard|whisper|tts)/i.test(model.id));
  }
  return uniqueModels(models);
}

async function ensureOriginPermission(url) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) return;
    const originPattern = `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}/*`;
    const has = await chrome.permissions.contains({origins: [originPattern]});
    if (!has) {
      await chrome.permissions.request({origins: [originPattern]});
    }
  } catch {
    /* ignore incomplete URLs until finished */
  }
}

async function fetchModelJson(url, headers, providerName, provider = '') {
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
  if (response.status === 401 || response.status === 403) throw new Error(provider === 'cloudflare'
    ? 'Cloudflare rejected the API token or Account ID. Check them and try again.'
    : `${providerName} rejected the API key. Check it and try again.`);
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

function field(labelText, value, secret, onInput, disabled = false, placeholder = '') {
  const label = document.createElement('label'); label.textContent = labelText;
  const input = document.createElement('input'); input.value = value; input.type = secret ? 'password' : 'text'; input.autocomplete = 'off';
  input.disabled = disabled;
  if (disabled) input.placeholder = 'Unlock encrypted API keys below';
  else if (placeholder) input.placeholder = placeholder;
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
  $('#action-mode').value = action.inputMode || 'transform'; $('#action-output-format').value = action.outputFormat || 'auto';
  $('#action-provider').value = action.provider || ''; $('#action-model').value = action.model || '';
  $('#action-input').value = action.inputLimit || ''; $('#action-output').value = action.outputLimit || ''; $('#action-enabled').checked = action.enabled !== false;
  $('#action-dialog').showModal(); $('#action-name').focus();
}

function queueSave() { clearTimeout(saveTimer); $('#save-status').textContent = 'Saving…'; saveTimer = setTimeout(saveNow, 350); }
async function saveNow() {
  clearTimeout(saveTimer);
  try {
    await saveSettings(settings);
    $('#save-status').textContent = 'Saved';
    setTimeout(() => { $('#save-status').textContent = ''; }, 1200);
  } catch (error) {
    $('#save-status').textContent = 'Could not save';
    console.error('Could not save Plyph settings:', error);
  }
}
