export const PROVIDERS = [
  {id: 'ollama', name: 'Ollama (local)'},
  {id: 'groq', name: 'Groq'},
  {id: 'gemini', name: 'Gemini'},
  {id: 'openrouter', name: 'OpenRouter'},
  {id: 'cerebras', name: 'Cerebras'},
  {id: 'openai', name: 'OpenAI'},
  {id: 'vercel', name: 'Vercel AI Gateway'},
];

export const DEFAULT_ACTIONS = [
  {
    id: 'default-professional-email',
    name: 'Professional email',
    prompt: 'Rewrite the selected text as a polished professional email. Preserve all facts and intent. Return only the email.',
    enabled: true, provider: '', model: '', inputMode: 'transform', inputLimit: 0, outputLimit: 0,
  },
  {
    id: 'default-summarize',
    name: 'Summarize clearly',
    prompt: 'Summarize the selected text clearly and concisely. Keep the important facts and return only the summary.',
    enabled: true, provider: '', model: '', inputMode: 'transform', inputLimit: 0, outputLimit: 0,
  },
  {
    id: 'default-translate',
    name: 'Translate to preferred language',
    prompt: 'Translate the selected text into ${language}. Preserve its meaning, tone, and formatting. Return only the translation.',
    enabled: true, provider: '', model: '', inputMode: 'transform', inputLimit: 0, outputLimit: 0,
  },
  {
    id: 'default-explain',
    name: 'Explain simply',
    prompt: 'Explain the selected text in simple, clear language. Keep the answer concise and accurate.',
    enabled: true, provider: '', model: '', inputMode: 'transform', inputLimit: 0, outputLimit: 0,
  },
];

export const DEFAULTS = {
  provider: 'groq',
  ollamaUrl: 'http://127.0.0.1:11434',
  models: {
    ollama: 'qwen2.5-coder:1.5b', groq: 'openai/gpt-oss-20b',
    gemini: 'gemini-3.5-flash-lite', openrouter: 'openrouter/free',
    cerebras: 'gpt-oss-120b', openai: 'gpt-4.1-mini',
    vercel: 'openai/gpt-5.4-mini',
  },
  apiKeys: {},
  prompts: {
    correct: 'Correct grammar, spelling, punctuation, clarity, and style. Preserve the language, meaning, and tone. Return only the corrected text, unchanged if already correct.',
    rewrite: 'Rewrite for clarity and natural flow. Preserve the language, meaning, and tone. Add no ideas or commentary. Return only the improved text.',
    prompt: 'Follow the provided instruction precisely. Produce the requested result directly. Do not add introductory commentary unless requested.',
  },
  variables: {language: 'English', tone: 'professional', style: 'clear and concise'},
  promptOptions: {provider: '', model: '', inputLimit: 0, outputLimit: 0},
  customActions: DEFAULT_ACTIONS,
  previewResults: true,
  selectionTrigger: true,
  // History is opt-in because results may contain private page content.
  historyEnabled: false,
  history: [],
  historyLimit: 50,
  feedbackPlacement: 'bottom',
  defaultActionsSeeded: false,
};

export async function getSettings() {
  const saved = await chrome.storage.local.get(DEFAULTS);
  const apiKeys = {...DEFAULTS.apiKeys, ...(saved.apiKeys || {})};
  // Older builds briefly exposed an Ollama API-key field. Never surface or use that obsolete value.
  delete apiKeys.ollama;
  return {
    ...DEFAULTS, ...saved,
    models: {...DEFAULTS.models, ...(saved.models || {})},
    apiKeys,
    prompts: {...DEFAULTS.prompts, ...(saved.prompts || {})},
    variables: {...DEFAULTS.variables, ...(saved.variables || {})},
    promptOptions: {...DEFAULTS.promptOptions, ...(saved.promptOptions || {})},
  };
}

export function enabledActions(settings) {
  return (settings.customActions || []).filter(action => action.enabled !== false && action.name?.trim());
}
