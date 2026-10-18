# Plyph Chrome Web Store listing

## Summary

Correct, rewrite, and transform selected text directly on any webpage.

## English description

Plyph helps you improve selected text without interrupting your workflow.

Select text in an editable field, on a webpage, or in a code editor, then choose an action from the compact popup, the selection toolbar, or Chrome's context menu. Plyph can correct writing, rewrite text, ask a question about the selection, run a prompt, or apply your own reusable actions.

Features:

- Correct spelling, grammar, and punctuation
- Rewrite selected text while preserving its meaning
- Ask a question about selected text and get an answer
- Create and manage reusable custom actions
- Choose which actions appear on the floating selection toolbar
- Preview a result, review word-level changes, and edit it before replacing the original text
- Choose plain text, Markdown, or automatic output formatting for each action
- Work with selections in ACE and CodeMirror code editors
- Access actions from the toolbar, selection toolbar, keyboard shortcuts, or context menu
- Match Chrome's light or dark appearance automatically
- Choose between compatible local and hosted text-generation services, or sign in with an existing AI plan account instead of using an API key
- Store settings and credentials in Chrome extension storage, with optional password-based credential encryption

Plyph sends selected text only to the service you configure when you run an action. A local service can be used when you prefer processing on your own computer. Plyph does not include advertising or analytics.

## Submission note

Do not add a list of service or model brand names to the Web Store description. Provider details belong in the extension's settings and privacy policy, where they are necessary to explain configuration and data handling.

In the Developer Dashboard privacy form, disclose authentication information and website content. Selected text may also contain personal communications or user-generated content, as already explained in the privacy policy. Confirm the Limited Use certification and link the published privacy policy before submitting an update.

## Reviewer notes (test instructions)

- **Main-world script:** `editor-bridge.js` runs in the page's own JavaScript context (`"world": "MAIN"`) only so it can read and replace the selection in ACE and CodeMirror editors. It makes no network requests, stores nothing, and exchanges data with the extension's isolated content script through DOM events on the page. It reads only the selected text and writes back the result of an action the user ran on that selection.
- **declarativeNetRequest:** used for two narrow rules. First, a session rule redirects the local sign-in callback (`127.0.0.1` `/auth/callback`) to the extension's own `chatgpt-callback.html` page while sign-in is in progress. Second, a dynamic rule removes the `Origin` header on requests the extension makes to a local Ollama server on `localhost`/`127.0.0.1`/`[::1]`, so local servers accept the requests.
- **Sign-in host permission:** `https://auth.openai.com/*` is needed for the optional "sign in with an AI plan account" flow. Sign-in opens in its own window. Tokens are sent only to `auth.openai.com` and the service hosts listed in `chatgpt.js` (`api.openai.com`). Reviewers can use an API-key provider without signing in.
- **Optional host permissions:** `https://*/*` and `http://*/*` are optional. They are requested only when a user configures a custom OpenAI-compatible endpoint on a host the extension doesn't already reach.
- **Test steps:** select text in a plain page and in a textarea, run Correct, and check the preview. For the code-editor path, select text in an ACE or CodeMirror editor and run an action. Reviewers can use a local Ollama server or a custom endpoint without creating an account.
