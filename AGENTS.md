# Margin Notes

For an installation request, follow the steps below. For source changes, read CONTRIBUTING.md and run the checks relevant to the change. README.md explains the app and its workflow.

## Install on the user's Mac

1. Work in a local session on an Apple Silicon Mac running macOS 14.2 or later. A cloud or Linux session cannot install this Mac app for the user.
2. Reuse the existing checkout or clone the repository supplied by the user. Keep unrelated projects and changes intact. A private repository requires authenticated GitHub access.
3. Check `node --version` for Node 24 or later and `xcrun --find swiftc` for Xcode Command Line Tools. Install missing Node through the user's existing package manager when available. For missing Xcode tools, run `xcode-select --install` and let the user complete the macOS dialog. Recheck prerequisites and continue installation.
4. Run `npm ci`, then `npm run install:mac` from the repository. The default destination is `~/Applications/Margin Notes.app`. The installer builds from source, verifies the app, and preserves the prior installation if replacement fails. A running destination app must be quit normally before updating.
5. Verify with `codesign --verify --deep --strict "$HOME/Applications/Margin Notes.app"`. Open that app after verification. Report the installed path and result.
6. Tell the user to enable Margin Notes in System Settings → Privacy & Security → Accessibility. This system approval belongs to the user.

Installation is complete when the app exists at the intended destination, signature verification succeeds, and the app opens. Record any remaining user permission step separately. Never replace the user's saved notes with test data, reset privacy permissions, or submit messages to another app during installation.

Fresh builds use automatic local ad-hoc signing and need no certificate or Apple account. Existing certificate-signed destinations retain their certificate. Keep selected signing identities and user data intact. Local rebuilds may require renewed Accessibility approval.

## Verify source changes

Use the commands in CONTRIBUTING.md. Run fixtures against isolated data. Preserve exact quote/comment pairing, drafts, unchecked notes, retained attachments, Fluid controls, and the native frosted panel. Distribution is source-only; CI checks builds and does not upload app binaries.
