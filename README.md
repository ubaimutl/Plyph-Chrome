# Plyph for Chrome

<p align="left">
  <strong>Use AI on selected text directly in Chrome.</strong> Correct grammar, polish writing, rewrite phrasing, run custom prompts, and transform text in place.
</p>

<p align="left">
  <a href="https://chromewebstore.google.com/detail/plyph/oofbibaakbobdiidfockjbokcdajmeep">
    <img src="https://img.shields.io/badge/Chrome_Web_Store-v0.1.4-4285F4?style=flat-square&logo=googlechrome&logoColor=white" alt="Chrome Web Store">
  </a>
  <img src="https://img.shields.io/badge/Manifest-V3-3B82F6?style=flat-square" alt="Manifest V3">
  <img src="https://img.shields.io/badge/Privacy-Local_First-10B981?style=flat-square" alt="Local First">
  <img src="https://img.shields.io/badge/Telemetry-None-F59E0B?style=flat-square" alt="No Telemetry">
</p>

<p align="left">
  <a href="https://chromewebstore.google.com/detail/plyph/oofbibaakbobdiidfockjbokcdajmeep">
    <img src="https://img.shields.io/badge/Install%20from-Chrome%20Web%20Store-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Install from Chrome Web Store" height="38">
  </a>
</p>

![Plyph in Chrome](store-assets/plyph-store-hero.png)

---

## Key Features

- **Multiple AI Providers** — Connect to local Ollama, Groq, DeepSeek, Gemini, OpenAI, OpenRouter, Cerebras, Cloudflare Workers AI, B.AI, Vercel AI Gateway, or any **Custom OpenAI-Compatible** endpoint.
- **Model Discovery** — Automatically discover models from configured endpoints or type any model name manually.
- **Output Format Controls** — Choose between `Auto` (smart Markdown preservation), strict `Plain text`, or explicit `Markdown` output.
- **Compact Preview & Editor** — Review and edit generated text before replacing, with instant Markdown removal, line-wrapping toggle, and an expandable wide view.
- **Flexible Triggering** — Access Plyph via the floating selection button, right-click context menu, toolbar popup, or custom keyboard shortcuts.
- **Custom Actions** — Build and save reusable prompt templates with custom variables, provider overrides, and token limits.
- **Local-First Privacy** — Credentials and history are stored locally in Chrome storage with optional password-based vault encryption. Zero analytics or tracking.

---

## Installation

### From the Chrome Web Store (Recommended)

Install directly from the [**Chrome Web Store**](https://chromewebstore.google.com/detail/plyph/oofbibaakbobdiidfockjbokcdajmeep).

### Manual / Developer Installation

1. Clone or download this repository.
2. Navigate to `chrome://extensions` in Google Chrome.
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked** and select the `Plyph-Chrome` folder.
5. Open Plyph settings, pick your preferred AI provider, and enter your API key or local Ollama URL.

---

## How to Use

1. **Select any text** on a webpage or inside an editable field (`<input>`, `<textarea>`, contenteditable).
2. **Choose an action** from:
   - The floating action dot beside the selection
   - Right-click context menu (**Plyph → Action**)
   - Toolbar popup icon
   - Keyboard shortcuts (`Alt+Shift+C` to correct, `Alt+Shift+R` to rewrite)
3. **Preview & Replace**: Review the generated result in the compact dialog, make edits, and press **Replace** (`Ctrl+Enter` / `⌘Enter`) to insert it directly.

---

## Default Keyboard Shortcuts

| Shortcut                                          | Action                          |
| :------------------------------------------------ | :------------------------------ |
| <kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>C</kbd>  | Correct selected text           |
| <kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>R</kbd>  | Rewrite selected text           |
| <kbd>Ctrl</kbd> / <kbd>⌘</kbd> + <kbd>Enter</kbd> | Replace selection from Preview  |
| <kbd>Esc</kbd>                                    | Dismiss Preview or floating dot |

> Shortcuts can be customized anytime at `chrome://extensions/shortcuts`.

---

## Privacy & Security

- **User-Initiated Only**: Text is sent to your chosen AI provider only when you explicitly execute an action.
- **Local Storage**: API keys are saved locally in Chrome's `storage.local`. Optional password encryption keeps unlocked keys in memory-only `storage.session` until the browser closes.
- **Local AI Support**: When using a locally running Ollama or localhost server, your data never leaves your machine.
- **No Telemetry**: Plyph contains zero analytics, tracking scripts, or background telemetry.
