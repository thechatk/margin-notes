# Development

Use Node.js 24 or later and npm. Native checks and app builds require an Apple Silicon Mac with Xcode or its command-line tools.

```sh
npm ci
npm run check
npx playwright install chromium
npm run check:desktop
npm run check:native
```

The checks use isolated sample notes. They do not read the user's annotations, capture the desktop, request Accessibility permission, or send messages. Browser screenshots go to `.preview/screenshots/`. `PLAYWRIGHT_MODULE` and `CHROMIUM_EXECUTABLE` can select an existing browser installation.

`npm run check` rebuilds the generated bundles, exercises capture storage, compares the package version and vendored component hashes, and checks tracked publication files for common private data and credentials. It complements a review of Git history before publication.

## Structure

| Location | Responsibility |
| --- | --- |
| `desktop/` | macOS windows, selection capture, file clipboard, glass background, icon |
| `src/capture.mjs` and `src/capture.css` | Floating annotation panel |
| `src/desktop-worker.mjs` and `src/store.mjs` | Local capture storage |
| `src/vendor/` | Fluid components |
| `scripts/` and `test/` | Builds, previews, and checks |
| `dist/` and `build/` | Generated output, excluded from Git |

Keep quote text exact, including Unicode and whitespace. Preserve source scopes and unresolved locations. Maintain saved notes and drafts through changes. Use the existing Fluid components and native window behavior. Adapt component spacing and colors in capture.css. Changes inside vendored files need a provenance update and the relevant regression check.

## Build the Mac app

The [README installation guide](README.md#install) covers installing the app for use. For a development build that stays inside the checkout:

```sh
npm ci
npm run build:mac
open "build/Margin Notes.app"
```

The result is `build/Margin Notes.app`. Fresh builds apply a local ad-hoc signature automatically. No certificate, Apple developer account, Keychain approval, or notarization is required. Grant Accessibility permission when using selection capture. macOS may require permission again after a rebuild because a local signature identifies a specific build. See [Apple's code identity documentation](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements).

A persistent certificate remains optional for developers who want a stable identity across rebuilds. Set `MARGIN_NOTES_SIGN_IDENTITY` to its SHA-1 fingerprint for the first certificate build. Later builds reuse that destination's certificate and fail if it is unavailable. An unreadable existing signature also stops replacement. Local builds never query the keychain unless a certificate was selected explicitly or belongs to the existing destination.

| Variable | Use |
| --- | --- |
| `MARGIN_NOTES_SIGN_IDENTITY` | Optional certificate fingerprint; `-` explicitly selects local ad-hoc signing |
| `MARGIN_NOTES_APP` | Destination app path |
| `MARGIN_NOTES_BUILD` | Scratch directory, default `build/mac` |
| `NODE_BINARY` | Redistributable Node runtime, default the Node executable running the build |
| `NODE_LICENSE` | Matching runtime license, default `LICENSE` above that executable's `bin` directory |
| `MARGIN_NOTES_DATA` | Isolated annotation data directory for manual testing |

`npm run install:mac` uses the same build and verification process with `~/Applications/Margin Notes.app` as its default destination. `MARGIN_NOTES_APP` overrides either destination. The build stops before modifying a running destination app; quit it normally before retrying. Keep the app identifier and any chosen certificate for upgrades. The About panel and native bundle version use `package.json`; keep the lockfile version in sync. Increment `buildNumber` with a source release.

Run `node scripts/check-mac-signing.mjs` with the same signer or destination settings to verify signing and installation behavior. This check uses scratch bundles.

## Panel behavior

Enter saves the current comment. Shift+Enter inserts a newline. Saving keeps the panel visible and returns focus to the reading app, unless another draft is ready to edit. Close and successful attachment copying hide the panel. Cmd+C preserves selected text copying when the user has selected text inside the panel.

The background is one rounded NSVisualEffectView with behind-window blending and a fixed active state. WebKit transparency uses the guarded private drawsBackground compatibility switch because the public underPageBackgroundColor property controls overscroll. Keep that limitation visible when changing the native view.

## Changes

Keep changes focused and describe their effect on capture, saved data, or delivery. Include the relevant check results. Use synthetic passages in tests and screenshots. Report security issues privately to the repository owner; omit real documents, annotation files, credentials, and captured desktop images from public reports.
