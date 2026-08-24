import {
  DEFAULTS,
  DEFAULT_ACTIONS,
  enabledActions,
  getSettings,
} from "./shared.js";

const PROVIDER_NAMES = {
  ollama: "Ollama",
  groq: "Groq",
  gemini: "Gemini",
  openrouter: "OpenRouter",
  cerebras: "Cerebras",
  openai: "OpenAI",
  vercel: "Vercel AI Gateway",
};

const TOOLBAR_ICON_SETS = {
  light: {
    16: "toolbar/for-light-theme/icon16.png",
    32: "toolbar/for-light-theme/icon32.png",
  },
  dark: {
    16: "toolbar/for-dark-theme/icon16.png",
    32: "toolbar/for-dark-theme/icon32.png",
  },
};

function applyToolbarIcon(dark) {
  if (!chrome.action?.setIcon) return;
  try {
    chrome.action
      .setIcon({ path: TOOLBAR_ICON_SETS[dark ? "dark" : "light"] })
      .catch(() => {});
  } catch {
    /* The action icon may not be ready yet. */
  }
}

async function setupToolbarIconDocument() {
  if (!chrome.offscreen?.createDocument) return;
  try {
    const existing = await chrome.runtime.getContexts?.({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [chrome.runtime.getURL("offscreen-icon.html")],
    });
    if (existing?.length) return;
    await chrome.offscreen.createDocument({
      url: "offscreen-icon.html",
      reasons: ["MATCH_MEDIA"],
      justification:
        "Watch the browser color scheme so the toolbar icon uses the matching glyph.",
    });
  } catch (error) {
    console.warn(
      "PromptPaste could not create the offscreen icon document:",
      error,
    );
  }
}
setupToolbarIconDocument();

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
    console.warn("PromptPaste could not install the Ollama origin fix:", error);
  }
}
setupOllamaOriginRewrite();

let menuBuild = Promise.resolve();

chrome.runtime.onInstalled.addListener(() => {
  initializeExtension().catch((error) => {
    console.error("Could not initialize PromptPaste:", error);
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
            document.getElementById("promptpaste-trigger")?.remove();
            document.getElementById("promptpaste-host")?.remove();
            document.getElementById("promptpaste-toast")?.remove();
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
      console.error("Could not rebuild PromptPaste menus:", error),
    );
  return menuBuild;
}

async function rebuildMenus() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: "promptpaste-root",
    title: "PromptPaste",
    contexts: ["selection", "editable"],
  });
  chrome.contextMenus.create({
    id: "correct",
    parentId: "promptpaste-root",
    title: "Correct selected text",
    contexts: ["selection", "editable"],
  });
  chrome.contextMenus.create({
    id: "rewrite",
    parentId: "promptpaste-root",
    title: "Rewrite selected text",
    contexts: ["selection", "editable"],
  });
  chrome.contextMenus.create({
    id: "prompt",
    parentId: "promptpaste-root",
    title: "Run selected prompt",
    contexts: ["selection", "editable"],
  });
  const settings = await getSettings();
  for (const action of enabledActions(settings)) {
    chrome.contextMenus.create({
      id: `custom:${action.id}`,
      parentId: "promptpaste-root",
      title: action.name,
      contexts: ["selection", "editable"],
    });
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "promptpaste-root") return;
  const action = info.menuItemId.startsWith("custom:")
    ? { mode: "custom", actionId: info.menuItemId.slice(7) }
    : { mode: info.menuItemId };
  runOnTab(tab.id, action, info.selectionText || "").catch((error) =>
    showError(tab.id, error),
  );
});

chrome.commands.onCommand.addListener((command) => {
  runCommand(command).catch((error) =>
    console.error("Could not run PromptPaste command:", error),
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "REPORT_COLOR_SCHEME") {
    applyToolbarIcon(message.dark === true);
    return;
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
    console.error("Could not save PromptPaste history:", error);
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
    };
  }
  if (request.mode === "prompt")
    return {
      ...settings.promptOptions,
      mode: "prompt",
      inputMode: "prompt",
      prompt: settings.prompts.prompt,
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
  };
}

function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}
function maxTokens(text, value = 0) {
  return (
    positiveInt(value) ||
    Math.min(2000, Math.max(220, estimateTokens(text) + 180))
  );
}
function positiveInt(value) {
  return Number.isSafeInteger(Number(value)) && Number(value) > 0
    ? Number(value)
    : 0;
}
function payload(text) {
  return `Transform only the text inside the tags.\nReturn only the transformed text.\n<text>\n${text}\n</text>`;
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
    if (response.status === 401 || response.status === 403) {
      if (provider === "ollama") {
        const detail =
          typeof data?.error?.message === "string"
            ? data.error.message
            : typeof data?.error === "string"
              ? data.error
              : "";
        const server =
          response.headers.get("server") || response.headers.get("via") || "";
        const isOllamaCors =
          !server && !detail && !response.headers.get("content-type");
        if (isOllamaCors) {
          // Ollama rejects the extension's chrome-extension:// origin with a 403
          // unless the Origin header matches its OLLAMA_ORIGINS allow-list.
          // The extension strips Origin on the way out, so reaching this error
          // means the rewrite did not apply (stale extension, or a custom
          // Ollama URL outside 127.0.0.1/localhost).
          throw new Error(
            `Ollama rejected the request with a ${response.status} because of its cross-origin (CORS) check. The extension removes the Origin header automatically for 127.0.0.1 and localhost — reload the extension so this takes effect. If your Ollama runs on another host, add its origin to Ollama's OLLAMA_ORIGINS environment variable (e.g. OLLAMA_ORIGINS=* ) and restart Ollama.`,
          );
        }
        throw new Error(
          `Ollama request was rejected with a ${response.status} (to ${url}).${server ? ` The response is from “${server}”, not from Ollama itself.` : ""}${detail ? ` ${detail}` : ""} A proxy, firewall, or another service is answering for that address — verify nothing else listens on port 11434 and that 127.0.0.1 and localhost are in your proxy's “No proxy for” list.`,
        );
      }
      throw new Error(
        `${PROVIDER_NAMES[provider]} rejected the API key. Check it in Settings.`,
      );
    }
    if (response.status === 404)
      throw new Error(
        `${PROVIDER_NAMES[provider]} could not find model “${model}”.`,
      );
    if (response.status === 429)
      throw new Error(
        `${PROVIDER_NAMES[provider]} rate limit reached. Wait and try again.`,
      );
    const detail = data?.error?.message || data?.error;
    throw new Error(
      typeof detail === "string"
        ? detail
        : `${PROVIDER_NAMES[provider]} rejected the request (${response.status}).`,
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
  const prompt = expandPrompt(action.prompt, text, settings.variables);
  const userText = action.inputMode === "prompt" ? text : payload(text);
  const messages = [
    ...(prompt.trim() ? [{ role: "system", content: prompt }] : []),
    { role: "user", content: userText },
  ];
  const limit = maxTokens(
    text,
    positiveInt(action.outputLimit) ||
      (action.inputMode === "prompt" ? 2000 : 0),
  );
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
    if (data.done_reason === "length")
      throw new Error(
        "Response reached the output limit. Increase the limit or select less text.",
      );
    if (!data.message?.content)
      throw new Error("Ollama returned an empty response.");
    return cleanOutput(data.message.content, action.inputMode);
  }
  const key = settings.apiKeys[provider];
  if (!key)
    throw new Error(`Add a ${PROVIDER_NAMES[provider]} API key in Settings.`);
  if (provider === "gemini") {
    const body = {
      contents: [{ role: "user", parts: [{ text: userText }] }],
      generationConfig: { maxOutputTokens: limit },
    };
    if (prompt.trim()) body.systemInstruction = { parts: [{ text: prompt }] };
    data = await requestJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
      {},
      body,
      provider,
      model,
    );
    if (data.candidates?.[0]?.finishReason === "MAX_TOKENS")
      throw new Error(
        "Response reached the output limit. Increase the limit or select less text.",
      );
    const output = data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("");
    if (!output) throw new Error("Gemini returned an empty response.");
    return cleanOutput(output, action.inputMode);
  }
  const urls = {
    groq: "https://api.groq.com/openai/v1/chat/completions",
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
  if (provider === "groq" && model.startsWith("openai/gpt-oss-"))
    Object.assign(body, { reasoning_effort: "low", include_reasoning: false });
  data = await requestJson(
    urls[provider],
    {
      Authorization: `Bearer ${key}`,
      ...(provider === "openrouter" ? { "X-Title": "PromptPaste" } : {}),
    },
    body,
    provider,
    model,
  );
  if (data.choices?.[0]?.finish_reason === "length")
    throw new Error(
      "Response reached the output limit. Increase the limit or select less text.",
    );
  const output = data.choices?.[0]?.message?.content;
  if (!output)
    throw new Error(`${PROVIDER_NAMES[provider]} returned an empty response.`);
  return cleanOutput(output, action.inputMode);
}
