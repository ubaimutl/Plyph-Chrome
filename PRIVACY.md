# Privacy Policy for Plyph

_Last updated: August 24, 2026_

Plyph is a Chrome extension that lets users process selected text using an AI provider of their choice.

Plyph does not operate its own backend server and does not include advertising, analytics, or telemetry.

## Data Plyph Handles

### Selected text and website content

When you explicitly run a Plyph action, the selected text is read from the current webpage and sent to the AI provider you have configured.

Plyph does not automatically send webpage content in the background.

Depending on the text you select, the content may include personal communications or other information contained on the webpage.

### AI providers

Plyph supports:

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

API keys that you enter into Plyph are stored locally using Chrome's `storage.local` API.

Plyph uses these keys only to authenticate requests to the AI provider you selected.

API keys are not sent to Plyph's developer or to any unrelated service.

Ollama does not require an API key.

## History

Plyph includes an optional history feature.

History is disabled by default.

If you enable it, Plyph stores information such as:

- Selected input text
- Generated output
- Action name
- AI provider
- Model
- Time of the action

History is stored locally in Chrome extension storage on your device.

History is not uploaded to Plyph's developer.

You can delete individual history entries or clear all saved history from the extension.

Disabling history prevents new results from being saved.

## Mouse Position and User Interaction

Plyph may temporarily read the mouse pointer position when the notification placement setting is configured to follow the pointer.

This information is used only locally to position status messages such as "Working", error messages, and completion notifications.

Mouse position information is not stored, transmitted, used for analytics, or used to track browsing behavior.

## Browsing History

Plyph does not collect or store your browsing history.

The extension does not maintain a record of websites you visit, page URLs, or page titles for tracking purposes.

## Data Sharing

Plyph does not sell user data.

Data is transferred to third-party AI providers only when necessary to perform an AI action explicitly requested by the user.

Plyph does not transfer user data for:

- Advertising
- Analytics
- Profiling
- Creditworthiness
- Lending decisions
- Unrelated purposes

## Permissions

Plyph requests browser permissions necessary for its functionality, including permissions to:

- Access selected text on webpages
- Add Plyph actions to the context menu
- Display and replace AI-generated text
- Store extension settings and optional history
- Communicate with configured AI providers
- Communicate with local Ollama servers
- Detect the browser color scheme for the toolbar icon

These permissions are used only to provide Plyph's text-processing functionality.

## Remote Code

Plyph does not download or execute remotely hosted JavaScript, WebAssembly, or other executable code.

All executable extension code is included in the extension package distributed through the Chrome Web Store.

Responses received from AI providers are treated as text or data and are not executed as extension code.

## Data Retention and Deletion

Settings, API keys, and optional history remain in Chrome's local extension storage until you change or delete them or uninstall the extension.

History entries can be deleted directly from Plyph.

Uninstalling the extension removes its local Chrome extension storage according to Chrome's behavior.

## Changes to This Policy

This privacy policy may be updated if Plyph's functionality or data practices change.

Significant changes will be reflected in this document and its "Last updated" date.

## Contact

For questions, bug reports, or privacy concerns, use the Plyph GitHub repository:

https://github.com/ubaimutl/Plyph-Chrome/issues
