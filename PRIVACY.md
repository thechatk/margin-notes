# Privacy and permissions

Margin Notes works locally without an account, analytics, or an API key. Feedback leaves the app through the clipboard when the user copies an attachment and pastes it into a destination app.

## Accessibility

Double Shift reads the selected passage from the active app. Captures retain the source app and any exposed document identity, URL, window title, surrounding text, or element range. Password fields are rejected. When direct selection access is unavailable, Margin Notes invokes Copy internally and restores the previous clipboard. It cancels on intervening input or an app switch.

The frosted background uses macOS visual effects. Margin Notes requires no Screen Recording permission.

## Stored data

The Mac app stores notes, unfinished drafts, archives, and attachment snapshots in `~/Library/Application Support/Margin Notes`. These are ordinary local files without app-level encryption. `MARGIN_NOTES_DATA` overrides the data location for development and testing.

Copied `Annotations.md` files contain the checked passages, comments, and captured source details. Successful copying removes those notes from the active panel. The files remain available for pasting and for conversations that reference them. Removing an attachment snapshot may break a conversation's local file reference. Uninstalling the app leaves its data directory intact.

Sharing an attachment, export, or screenshot shares whatever information it contains.

## Control

Change Accessibility permission in macOS System Settings. Keep needed attachment files when clearing local data. Use synthetic notes when reporting a problem publicly.
