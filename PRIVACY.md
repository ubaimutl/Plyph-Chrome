# Privacy Policy for PromptPaste

_Last updated: August 24, 2026_

PromptPaste is a Chrome extension that lets users process selected text using an AI provider of their choice.

PromptPaste does not operate its own backend server and does not include advertising, analytics, or telemetry.

## Data PromptPaste Handles

### Selected text and website content

When you explicitly run a PromptPaste action, the selected text is read from the current webpage and sent to the AI provider you have configured.

PromptPaste does not automatically send webpage content in the background.

Depending on the text you select, the content may include personal communications or other information contained on the webpage.

### AI providers

PromptPaste supports:

- Ollama
- Groq
- Gemini
- OpenRouter
- Cerebras
- OpenAI
- Vercel AI Gateway

When you run an AI action, the selected text, prompt, model information, and related request data are sent directly from the extension to the selected provider.

The handling of data by those providers is governed by their own privacy policies and terms.

If you use a locally running Ollama server, requests can remain entirely on your own device or local network, depending on the Ollama server address you configure.

## API Keys

API keys that you enter into PromptPaste are stored locally using Chrome's `storage.local` API.

PromptPaste uses these keys only to authenticate requests to the AI provider you selected.

API keys are not sent to PromptPaste's developer or to any unrelated service.

Ollama does not require an API key.

## History

PromptPaste includes an optional history feature.

History is disabled by default.

If you enable it, PromptPaste stores information such as:

- Selected input text
- Generated output
- Action name
- AI provider
- Model
- Time of the action

History is stored locally in Chrome extension storage on your device.

History is not uploaded to PromptPaste's developer.

You can delete individual history entries or clear all saved history from the extension.

Disabling history prevents new results from being saved.

## Mouse Position and User Interaction

PromptPaste may temporarily read the mouse pointer position when the notification placement setting is configured to follow the pointer.

This information is used only locally to position status messages such as "Working", error messages, and completion notifications.

Mouse position information is not stored, transmitted, used for analytics, or used to track browsing behavior.

## Browsing History

PromptPaste does not collect or store your browsing history.

The extension does not maintain a record of websites you visit, page URLs, or page titles for tracking purposes.

## Data Sharing

PromptPaste does not sell user data.

Data is transferred to third-party AI providers only when necessary to perform an AI action explicitly requested by the user.

PromptPaste does not transfer user data for:

- Advertising
- Analytics
- Profiling
- Creditworthiness
- Lending decisions
- Unrelated purposes

## Permissions

PromptPaste requests browser permissions necessary for its functionality, including permissions to:

- Access selected text on webpages
- Add PromptPaste actions to the context menu
- Display and replace AI-generated text
- Store extension settings and optional history
- Communicate with configured AI providers
- Communicate with local Ollama servers
- Detect the browser color scheme for the toolbar icon

These permissions are used only to provide PromptPaste's text-processing functionality.

## Remote Code

PromptPaste does not download or execute remotely hosted JavaScript, WebAssembly, or other executable code.

All executable extension code is included in the extension package distributed through the Chrome Web Store.

Responses received from AI providers are treated as text or data and are not executed as extension code.

## Data Retention and Deletion

Settings, API keys, and optional history remain in Chrome's local extension storage until you change or delete them or uninstall the extension.

History entries can be deleted directly from PromptPaste.

Uninstalling the extension removes its local Chrome extension storage according to Chrome's behavior.

## Changes to This Policy

This privacy policy may be updated if PromptPaste's functionality or data practices change.

Significant changes will be reflected in this document and its "Last updated" date.

## Contact

For questions, bug reports, or privacy concerns, use the PromptPaste GitHub repository:

https://github.com/ubaimutl/PromptPaste-Chrome/issues
