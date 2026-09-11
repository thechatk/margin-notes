<p align="center">
  <img src="desktop/AppIcon.png" width="150" height="150" alt="Margin Notes icon">
</p>

<h1 align="center">Margin Notes</h1>

## What is it?

Margin Notes is a Mac app for giving agents feedback on what you're reading. Use it to comment on a draft, a website an agent shared, or another document. Your selected passages and comments go back to the agent together in one attachment.

## How it works

https://github.com/user-attachments/assets/023ba454-9ff6-457d-9523-dd318be95854

1. Open a draft from your agent, or a page you want to comment on.
2. Select a passage and tap **Shift twice**. The panel opens, ready for you to type your comment.
3. Press **Enter** to save. Repeat for other passages.
4. Select the annotations you want to share and press **Cmd+C** in the panel.
5. Press **Cmd+V** in the agent's message box to attach `Annotations.md`. The file pairs each selected passage with your comment, so the agent can read your feedback in context.
6. Add a message if you like, then send. Ask a question, share your thoughts, or request changes.

<a name="install"></a>

## Installation

You need an **Apple Silicon Mac** running **macOS 14.2 or later**.

### With an agent

> Install Margin Notes from https://github.com/thechatk/margin-notes on this Mac. Follow AGENTS.md, open the installed app, and guide me through Accessibility permission.

### Manually

Install [Node.js 24 or later](https://nodejs.org/en/download) and Xcode Command Line Tools with `xcode-select --install`. Then run:

```sh
git clone https://github.com/thechatk/margin-notes.git
cd margin-notes
npm ci
npm run install:mac
open ~/Applications/"Margin Notes.app"
```

Enable Margin Notes in **System Settings → Privacy & Security → Accessibility**. If it is missing, use **+** to add it from `~/Applications`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and checks.

## License and credits

[MIT licensed](LICENSE). [Third-party notices](THIRD_PARTY_LICENSES.txt) · [Privacy](PRIVACY.md).

Inspired by [shadcn's Copper](https://shadcn.com/copper) and its shortcut-based capture workflow. Built with [Fluid Functionalism](https://github.com/mickadesign/fluid-functionalism) components, including its [Lina](https://github.com/SameerJS6/lina) scrollbar adaptation.
