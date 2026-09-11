# Margin Notes

<img src="desktop/AppIcon.png" width="80" align="right" alt="Margin Notes icon">

Margin Notes is a Mac app for giving an AI agent feedback on what you are reading. Select text in a document, browser, or app, press Shift twice, and write a comment. Collect your annotations, then paste them into the agent as one Markdown attachment.

## How it works

https://github.com/user-attachments/assets/e7a0d52a-83af-4f07-9864-c26b6a5ed7a7

1. Select a passage and tap **Shift twice**. The panel opens with the selected text.
2. Write your comment and press **Enter** to save. Use **Shift+Enter** for a new line.
3. Keep reading and annotate more passages. The panel stays in place.
4. Select the annotations you want to give the agent.
5. Press **Cmd+C** in the panel, then **Cmd+V** in the agent's message box to attach `Annotations.md`.

Click a note's pencil to edit it. Drag the panel by its header to move it.

## Install

You need an **Apple Silicon Mac**, **macOS 14.2 or later**, **Node.js 24 or later**, and **Xcode Command Line Tools**.

### With an agent

> Install Margin Notes from https://github.com/thechatk/margin-notes on this Mac. Follow AGENTS.md, open the installed app, and guide me through Accessibility permission.

### Yourself

Install [Node.js](https://nodejs.org/en/download) if needed. Install Apple's command-line tools with `xcode-select --install` and wait for the installer to finish.

Open Terminal and run:

```sh
git clone https://github.com/thechatk/margin-notes.git
cd margin-notes
npm ci
npm run install:mac
open ~/Applications/"Margin Notes.app"
```

### First launch

1. Open **System Settings → Privacy & Security → Accessibility**.
2. Enable **Margin Notes**. If it is missing, click **+** and choose `Margin Notes.app` from the `Applications` folder in your home folder.
3. Return to a document, select a sentence, and tap **Shift twice** to add your first annotation.

Accessibility permission lets Margin Notes capture the selected text from your current app.

### Update

Quit Margin Notes, open Terminal in the repository folder, and run:

```sh
git pull --ff-only
npm ci
npm run install:mac
open ~/Applications/"Margin Notes.app"
```

macOS may ask you to enable Accessibility again after rebuilding.

## Use it with your agent

Paste the attachment into **Codex** or **Claude Code**, then send your message. For another agent, use its file attachment control or give it the path to `Annotations.md`. The file contains the passages you selected and your comments.

## Your data

Notes stay on your Mac. The app needs no account or API key. See [privacy and permissions](PRIVACY.md) for storage and permission details.

## Development

Read [CONTRIBUTING.md](CONTRIBUTING.md) for builds and checks, and [release instructions](docs/RELEASE.md) for source publication.

## Credits

Inspired by [shadcn's Copper](https://shadcn.com/copper) and its shortcut-based capture workflow.

Thank you to [Fluid Functionalism](https://github.com/mickadesign/fluid-functionalism) for the buttons, checkboxes, and scrolling components, and [Lina](https://github.com/SameerJS6/lina) for the scrollbar implementation adapted by Fluid.

Margin Notes is [MIT licensed](LICENSE). [Third-party notices](THIRD_PARTY_LICENSES.txt) and [asset provenance](docs/PROVENANCE.md) include the full acknowledgements.
