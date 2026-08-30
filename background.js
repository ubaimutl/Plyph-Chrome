import {
  DEFAULTS,
  DEFAULT_ACTIONS,
  enabledActions,
  getSettings,
  resolveOutputFormat,
} from "./shared.js";

const PROVIDER_NAMES = {
  ollama: "Ollama",
  custom_openai: "Custom OpenAI-Compatible",
  groq: "Groq",
  cloudflare: "Cloudflare Workers AI",
  bai: "B.AI",
  deepseek: "DeepSeek",
  gemini: "Gemini",
  openrouter: "OpenRouter",
  cerebras: "Cerebras",
  openai: "OpenAI",
  vercel: "Vercel AI Gateway",
};

async function restrictStorageAccess() {
  for (const area of [chrome.storage.local, chrome.storage.session]) {
    if (!area?.setAccessLevel) continue;
    try {
      await area.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});
    } catch (error) {
      console.warn('Plyph could not restrict extension storage access:', error);
    }
  }
}
restrictStorageAccess();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_PAGE_CONFIG') {
    getPageConfig().then(sendResponse);
    return true;
  }
  if (message.type === "RUN_ACTION") {
    handleActionRequest(message.tabId, message.action).then((response) =>
      sendResponse(response),
    );
    return true;
  }
  if (message.type === "RUN_ACTION_FROM_PAGE") {
    const tabId = sender.tab?.id;
    handleActionRequest(tabId, message.action, message.text || "").then(
      (response) => sendResponse(response),
    );
    return true;
  }
  return false;
});

async function getPageConfig() {
  const settings = await getSettings();
  return {
    customActions: settings.customActions,
    selectionTrigger: settings.selectionTrigger,
    feedbackPlacement: settings.feedbackPlacement,
  };
}

function normaliseOllamaUrl(value) {
  const raw = String(value || "").trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(
      "Ollama server URL is invalid. Use a URL such as http://127.0.0.1:11434.",
    );
  }
  if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error("Ollama server URL must start with http:// or https://.");
  }
  if (parsed.search || parsed.hash) {
    throw new Error(
      "Ollama server URL must not include a query string or fragment.",
    );
  }
  return parsed.href.replace(/\/+$/, "");
}

const OLLAMA_DNR_RULES = [
  {
    id: 101,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [{ header: "Origin", operation: "remove" }],
    },
    condition: {
      urlFilter: "||127.0.0.1^",
      initiatorDomains: [chrome.runtime.id],
      resourceTypes: ["xmlhttprequest"],
    },
  },
  {
    id: 102,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [{ header: "Origin", operation: "remove" }],
    },
    condition: {
      urlFilter: "||localhost^",
      initiatorDomains: [chrome.runtime.id],
      resourceTypes: ["xmlhttprequest"],
    },
  },
  {
    id: 103,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [{ header: "Origin", operation: "remove" }],
    },
    condition: {
      urlFilter: "||[::1]^",
      initiatorDomains: [chrome.runtime.id],
      resourceTypes: ["xmlhttprequest"],
    },
  },
];

async function setupOllamaOriginRewrite() {
  if (!chrome.declarativeNetRequest?.updateDynamicRules) return;
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: OLLAMA_DNR_RULES.map((rule) => rule.id),
      addRules: OLLAMA_DNR_RULES,
    });
  } catch (error) {
    console.warn("Plyph could not install the Ollama origin fix:", error);
  }
}
setupOllamaOriginRewrite();

let menuBuild = Promise.resolve();

chrome.runtime.onInstalled.addListener(() => {
  initializeExtension().catch((error) => {
    console.error("Could not initialize Plyph:", error);
  });
});

async function initializeExtension() {
  await removeLegacyPageControls();
  const current = await chrome.storage.local.get(null);
  if (!Object.keys(current).length) {
    await chrome.storage.local.set({ ...DEFAULTS, defaultActionsSeeded: true });
  } else if (!current.defaultActionsSeeded) {
    const actions = Array.isArray(current.customActions)
      ? current.customActions
      : [];
    const actionIds = new Set(actions.map((action) => action.id));
    await chrome.storage.local.set({
      customActions: [
        ...actions,
        ...DEFAULT_ACTIONS.filter((action) => !actionIds.has(action.id)),
      ],
      defaultActionsSeeded: true,
    });
  }
  const migration = {};
  if (current.models?.ollama === "qwen3:4b") {
    migration.models = { ...current.models, ollama: DEFAULTS.models.ollama };
  }
  if (current.models?.deepseek === "deepseek-chat") {
    migration.models = { ...(migration.models || current.models), deepseek: DEFAULTS.models.deepseek };
  }
  if (current.models?.groq === "openai/gpt-oss-20b") {
    migration.models = { ...(migration.models || current.models), groq: DEFAULTS.models.groq };
  }
  if (current.apiKeys?.ollama) {
    migration.apiKeys = { ...current.apiKeys };
    delete migration.apiKeys.ollama;
  }
  if (Object.keys(migration).length) await chrome.storage.local.set(migration);
  scheduleMenuRebuild();
}

async function removeLegacyPageControls() {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(
    tabs
      .filter((tab) => tab.id)
      .map((tab) =>
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            document.getElementById("plyph-trigger")?.remove();
            document.getElementById("plyph-host")?.remove();
            document.getElementById("plyph-toast")?.remove();
          },
        }),
      ),
  );
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;

  if (changes.customActions) scheduleMenuRebuild();

  if (
    changes.customActions ||
    changes.selectionTrigger ||
    changes.feedbackPlacement
  ) {
    broadcastPageConfig().catch((error) =>
      console.error("Could not update page controls:", error),
    );
  }
});

async function broadcastPageConfig() {
  const settings = await getSettings();
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(
    tabs
      .filter((tab) => tab.id)
      .map((tab) =>
        chrome.tabs.sendMessage(tab.id, {
          type: "SET_PAGE_CONFIG",
          customActions: settings.customActions,
          selectionTrigger: settings.selectionTrigger,
          feedbackPlacement: settings.feedbackPlacement,
        }),
      ),
  );
}

function scheduleMenuRebuild() {
  menuBuild = menuBuild
    .then(rebuildMenus)
    .catch((error) =>
      console.error("Could not rebuild Plyph menus:", error),
    );
  return menuBuild;
}

async function rebuildMenus() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: "plyph-root",
    title: "Plyph",
    contexts: ["selection", "editable"],
  });
  chrome.contextMenus.create({
    id: "correct",
    parentId: "plyph-root",
    title: "Correct selected text",
    contexts: ["selection", "editable"],
  });
  chrome.contextMenus.create({
    id: "rewrite",
    parentId: "plyph-root",
    title: "Rewrite selected text",
    contexts: ["selection", "editable"],
  });
  chrome.contextMenus.create({
    id: "prompt",
    parentId: "plyph-root",
    title: "Run selected prompt",
    contexts: ["selection", "editable"],
  });
  const settings = await getSettings();
  for (const action of enabledActions(settings)) {
    chrome.contextMenus.create({
      id: `custom:${action.id}`,
      parentId: "plyph-root",
      title: action.name,
      contexts: ["selection", "editable"],
    });
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "plyph-root") return;
  const action = info.menuItemId.startsWith("custom:")
    ? { mode: "custom", actionId: info.menuItemId.slice(7) }
    : { mode: info.menuItemId };
  runOnTab(tab.id, action, info.selectionText || "").catch((error) =>
    showError(tab.id, error),
  );
});

chrome.commands.onCommand.addListener((command) => {
  runCommand(command).catch((error) =>
    console.error("Could not run Plyph command:", error),
  );
});

async function runCommand(command) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await runOnTab(tab.id, {
      mode: command === "run-prompt" ? "prompt" : command,
    });
  } catch (error) {
    await showError(tab.id, error);
  }
}

async function handleActionRequest(tabId, action, fallbackText = "") {
  try {
    await runOnTab(tabId, action, fallbackText);
    return { ok: true };
  } catch (error) {
    await showError(tabId, error);
    return { ok: false, error: error.message || String(error) };
  }
}

async function ensureContent(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PING" });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["page-controller.js"],
    });
  }
}

async function runOnTab(tabId, actionRequest, fallbackText = "") {
  if (!tabId) throw new Error("No active tab.");
  await ensureContent(tabId);
  const capture = await chrome.tabs.sendMessage(tabId, {
    type: "CAPTURE_SELECTION",
  });
  const text = capture?.text || fallbackText;
  if (!text?.trim()) throw new Error("Select text first.");
  await chrome.tabs.sendMessage(tabId, { type: "WORKING" });
  const settings = await getSettings();
  const action = resolveAction(settings, actionRequest);
  const output = await transform(text, action, settings);
  const label =
    action.mode === "rewrite"
      ? "Rewritten"
      : action.inputMode === "prompt"
        ? "Generated"
        : "Corrected";
  const actionName = action.name?.trim() || label;
  const provider = action.provider || settings.provider;
  const model = action.model || settings.models[provider];
  try {
    await recordHistory({
      ts: Date.now(),
      action: action.mode,
      actionName,
      inputMode: action.inputMode,
      input: text,
      output,
      provider,
      model,
    });
  } catch (error) {
    console.error("Could not save Plyph history:", error);
  }
  await chrome.tabs.sendMessage(tabId, {
    type: settings.previewResults ? "SHOW_RESULT" : "REPLACE_RESULT",
    output,
    label,
  });
}

const MAX_HISTORY_CHARS = 20000;
let historyWriteQueue = Promise.resolve();

function recordHistory(entry) {
  const write = historyWriteQueue.then(() => writeHistory(entry));
  historyWriteQueue = write.catch(() => {});
  return write;
}

async function writeHistory(entry) {
  const stored = await chrome.storage.local.get({
    history: [],
    historyLimit: 50,
    historyEnabled: DEFAULTS.historyEnabled,
  });
  if (stored.historyEnabled !== true) return;
  const limit = Math.min(500, positiveInt(stored.historyLimit) || 50);
  const list = Array.isArray(stored.history) ? stored.history : [];
  const trimmed = {
    ...entry,
    id: `h_${entry.ts}_${Math.random().toString(36).slice(2, 8)}`,
    input: String(entry.input || "").slice(0, MAX_HISTORY_CHARS),
    output: String(entry.output || "").slice(0, MAX_HISTORY_CHARS),
  };
  const updated = [trimmed, ...list].slice(0, limit);
  while (updated.length > 1 && JSON.stringify(updated).length > 3500000)
    updated.pop();

  for (let count = updated.length; count > 0; count -= 1) {
    try {
      await chrome.storage.local.set({ history: updated.slice(0, count) });
      return;
    } catch (error) {
      if (count === 1) throw error;
    }
  }
}

async function showError(tabId, error) {
  if (!tabId) return;
  try {
    await ensureContent(tabId);
    await chrome.tabs.sendMessage(tabId, {
      type: "SHOW_ERROR",
      message: error.message || String(error),
    });
  } catch {
    /* Chrome blocks extension scripts on internal pages. */
  }
}

function resolveAction(settings, request) {
  if (request.mode === "custom") {
    const item = enabledActions(settings).find(
      (action) => action.id === request.actionId,
    );
    if (!item) throw new Error("That custom action no longer exists.");
    return {
      ...item,
      mode: "custom",
      inputMode: item.inputMode === "prompt" ? "prompt" : "transform",
      outputFormat: item.outputFormat || "auto",
    };
  }
  if (request.mode === "prompt")
    return {
      ...settings.promptOptions,
      mode: "prompt",
      inputMode: "prompt",
      prompt: settings.prompts.prompt,
      outputFormat: settings.promptOptions?.outputFormat || "auto",
    };
  const mode = request.mode === "rewrite" ? "rewrite" : "correct";
  return {
    mode,
    inputMode: "transform",
    prompt: settings.prompts[mode],
    provider: "",
    model: "",
    inputLimit: 0,
    outputLimit: 0,
    outputFormat: "auto",
  };
}

function estimateTokens(text) {
  return Math.ceil((text || "").length / 4);
}
function maxTokens(text, value = 0) {
  const explicit = positiveInt(value);
  if (explicit) return explicit;
  // By default, allow generous output headroom (at least 2048 tokens + text tokens)
  // so reasoning models and expansions are never prematurely cut off.
  return Math.max(2048, Math.min(8192, estimateTokens(text) * 4 + 1024));
}
function positiveInt(value) {
  return Number.isSafeInteger(Number(value)) && Number(value) > 0
    ? Number(value)
    : 0;
}
function payload(text) {
  return `Transform only the text inside the tags.\nReturn only the transformed text.\n<text>\n${text}\n</text>`;
}

function isCloudflareQwenReasoningModel(provider, model) {
  return provider === "cloudflare" && /^@cf\/qwen\/qwen3(?:[.-]|$)/.test(model || "");
}

function expandPrompt(prompt, text, variables) {
  const values = { ...variables, selection: text };
  return (prompt || "").replace(
    /\$\{(selection|language|tone|style)\}/g,
    (_match, name) => values[name] || "",
  );
}

function cleanOutput(text, inputMode) {
  let output = text.trim();
  if (inputMode === "prompt") return output;
  const tagged = output.match(/^<text>\s*([\s\S]*?)\s*<\/text>$/i);
  if (tagged) output = tagged[1].trim();
  const fenced = output.match(/^```(?:text)?\s*\n?([\s\S]*?)\n?```$/i);
  return fenced ? fenced[1].trim() : output;
}

async function requestJson(url, headers, body, provider, model) {
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45000),
    });
  } catch {
    throw new Error(
      `Could not connect to ${PROVIDER_NAMES[provider]}. Check your connection.`,
    );
  }
  let data = {};
  try {
    data = await response.json();
  } catch {
    /* handled below */
  }
  if (!response.ok) {
    const directError = data?.error?.message || data?.error;
    const errors = Array.isArray(data?.errors)
      ? data.errors.map(item => item?.message || item).filter(item => typeof item === "string").join(" ")
      : "";
    const detail = typeof directError === "string" ? directError : errors;
    if (response.status === 401 || response.status === 403) {
      if (provider === "ollama") {
        const server =
          response.headers.get("server") || response.headers.get("via") || "";
        const isOllamaCors =
          !server && !detail && !response.headers.get("content-type");
        if (isOllamaCors) {
          throw new Error(
            `Ollama rejected the request with a ${response.status} because of its cross-origin (CORS) check. The extension removes the Origin header automatically for 127.0.0.1 and localhost — reload the extension so this takes effect. If your Ollama runs on another host, add its origin to Ollama's OLLAMA_ORIGINS environment variable (e.g. OLLAMA_ORIGINS=* ) and restart Ollama.`,
          );
        }
        throw new Error(
          `Ollama request was rejected with a ${response.status} (to ${url}).${server ? ` The response is from “${server}”, not from Ollama itself.` : ""}${detail ? ` ${detail}` : ""} A proxy, firewall, or another service is answering for that address — verify nothing else listens on port 11434 and that 127.0.0.1 and localhost are in your proxy's “No proxy for” list.`,
        );
      }
      throw new Error(
        provider === "cloudflare"
          ? "Cloudflare rejected the API token or Account ID. Check them in Settings."
          : `${PROVIDER_NAMES[provider]} rejected the API key. Check it in Settings.`,
      );
    }
    if (response.status === 404)
      throw new Error(
        provider === "cloudflare"
          ? `Cloudflare could not find the account or model “${model}”.`
          : `${PROVIDER_NAMES[provider]} could not find model “${model}”.`,
      );
    if (response.status === 429)
      throw new Error(
        `${PROVIDER_NAMES[provider]} rate limit reached. Wait and try again.`,
      );
    throw new Error(
      detail || `${PROVIDER_NAMES[provider]} rejected the request (${response.status}).`,
    );
  }
  return data;
}

async function transform(text, action, settings) {
  const inputLimit = positiveInt(action.inputLimit);
  const estimate = estimateTokens(text);
  if (inputLimit && estimate > inputLimit)
    throw new Error(
      `Selected text is about ${estimate} tokens, above this action's ${inputLimit}-token input limit.`,
    );
  const provider = action.provider || settings.provider;
  const model = action.model || settings.models[provider];

  const effectivePrompt = action.inputMode === "prompt"
    ? `${text} ${action.prompt || ""}`
    : (action.prompt || "");
  const formatMode = resolveOutputFormat(action, text, effectivePrompt);
  let formatInstruction = "";
  if (formatMode === "text") {
    formatInstruction = "Output format requirement: Return clean plain text only. Do not use Markdown formatting (no **bold**, *italics*, # headers, backticks, or bullet markers).";
  } else if (formatMode === "markdown") {
    formatInstruction = "Output format requirement: Use clean, well-formatted Markdown where appropriate.";
  } else if (formatMode === "preserve-markdown") {
    formatInstruction = "Output format requirement: Preserve the input's existing Markdown formatting and structure without unnecessary restructuring.";
  }

  const prompt = expandPrompt(action.prompt, text, settings.variables);
  const systemPrompt = [prompt.trim(), formatInstruction].filter(Boolean).join("\n\n");
  const userText = action.inputMode === "prompt" ? text : payload(text);
  const messages = [
    ...(systemPrompt.trim() ? [{ role: "system", content: systemPrompt }] : []),
    { role: "user", content: userText },
  ];
  const requestedOutputLimit = positiveInt(action.outputLimit);
  let limit = maxTokens(text, requestedOutputLimit);
  const cloudflareReasoningModel = isCloudflareQwenReasoningModel(provider, model);
  const cloudflareReasoningEnabled =
    cloudflareReasoningModel && settings.cloudflareReasoningEnabled === true;
  if (cloudflareReasoningEnabled && !requestedOutputLimit)
    limit = Math.max(limit, 4096);

  let data;
  if (provider === "ollama") {
    const ollamaUrl = normaliseOllamaUrl(settings.ollamaUrl);
    data = await requestJson(
      `${ollamaUrl}/api/chat`,
      {},
      { model, messages, stream: false, options: { num_predict: limit } },
      provider,
      model,
    );
    if (!data.message?.content && data.done_reason === "length")
      throw new Error(
        "Response reached the output limit. Increase the limit or select less text.",
      );
    if (!data.message?.content)
      throw new Error("Ollama returned an empty response.");
    return cleanOutput(data.message.content, action.inputMode);
  }
  if (settings.vaultLocked)
    throw new Error('Unlock your encrypted API keys in Plyph Settings.');
  const key = settings.apiKeys[provider];
  if (!key && !["ollama", "custom_openai"].includes(provider))
    throw new Error(
      provider === "cloudflare"
        ? "Add a Cloudflare Workers AI API token in Settings."
        : `Add a ${PROVIDER_NAMES[provider]} API key in Settings.`,
    );
  if (provider === "gemini") {
    const body = {
      contents: [{ role: "user", parts: [{ text: userText }] }],
      generationConfig: { maxOutputTokens: limit },
    };
    if (systemPrompt.trim()) body.systemInstruction = { parts: [{ text: systemPrompt }] };
    data = await requestJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
      {},
      body,
      provider,
      model,
    );
    const output = data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("");
    if (!output && data.candidates?.[0]?.finishReason === "MAX_TOKENS")
      throw new Error(
        "Response reached the output limit. Increase the limit or select less text.",
      );
    if (!output) throw new Error("Gemini returned an empty response.");
    return cleanOutput(output, action.inputMode);
  }
  let cloudflareAccountId = "";
  if (provider === "cloudflare") {
    cloudflareAccountId = String(settings.cloudflareAccountId || "").trim();
    if (!cloudflareAccountId)
      throw new Error("Add your Cloudflare Account ID in Settings.");
  }
  let customOpenAiEndpoint = "";
  if (provider === "custom_openai") {
    const rawUrl = String(settings.customOpenAiUrl || "").trim();
    if (!rawUrl)
      throw new Error("Enter the Custom OpenAI Base URL in Settings.");
    const base = rawUrl.replace(/\/+$/, "");
    customOpenAiEndpoint = base.endsWith("/chat/completions")
      ? base
      : `${base}/chat/completions`;
    if (!model)
      throw new Error("Enter a model name for Custom OpenAI-Compatible in Settings.");
  }
  const urls = {
    custom_openai: customOpenAiEndpoint,
    groq: "https://api.groq.com/openai/v1/chat/completions",
    cloudflare: `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(cloudflareAccountId)}/ai/v1/chat/completions`,
    bai: "https://api.b.ai/v1/chat/completions",
    deepseek: "https://api.deepseek.com/chat/completions",
    openrouter: "https://openrouter.ai/api/v1/chat/completions",
    cerebras: "https://api.cerebras.ai/v1/chat/completions",
    openai: "https://api.openai.com/v1/chat/completions",
    vercel: "https://ai-gateway.vercel.sh/v1/chat/completions",
  };
  const body = {
    model,
    messages,
    [provider === "cerebras" ? "max_completion_tokens" : "max_tokens"]: limit,
  };
  if (cloudflareReasoningModel)
    body.chat_template_kwargs = { enable_thinking: cloudflareReasoningEnabled };
  if (provider === "groq" && model.startsWith("openai/gpt-oss-"))
    Object.assign(body, { reasoning_effort: "low", include_reasoning: false });
  data = await requestJson(
    urls[provider],
    {
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      ...(provider === "cloudflare" ? { "cf-aig-gateway-id": "default" } : {}),
      ...(provider === "openrouter" ? { "X-Title": "Plyph" } : {}),
    },
    body,
    provider,
    model,
  );
  const message = data.choices?.[0]?.message;
  const output =
    message?.content ||
    (!cloudflareReasoningEnabled && cloudflareReasoningModel
      ? message?.reasoning_content || message?.reasoning
      : "");
  if (!output && data.choices?.[0]?.finish_reason === "length")
    throw new Error(
      "Response reached the output limit. Increase the limit or select less text.",
    );
  if (!output)
    throw new Error(`${PROVIDER_NAMES[provider]} returned an empty response.`);
  return cleanOutput(output, action.inputMode);
}
