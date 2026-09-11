# Source release procedure

Distribute source only. Users build the Mac app themselves using [CONTRIBUTING.md](../CONTRIBUTING.md#build-the-mac-app). Keep generated apps and installers out of Git and release attachments. CI verifies builds without publishing binaries. Apple distribution signing and notarization are outside this release process.

## Private repository

Use the clean source repository and preserve the development repository locally. Source archives exclude private session records through `.gitattributes`. Generated bundles, app builds, dependencies, captured notes, and signing material are ignored.

Before uploading, review the files and Git history, run the documented checks, and inspect the requested remote and visibility. Run `gitleaks git --log-opts="--all --full-history" --redact=100` to scan reachable history for credentials. Inspect historical documents and media for user content; secret scanners do not recognize personal writing. Files excluded from source archives remain visible in Git history. Create the repository as private. Uploading and later changes to visibility follow separate owner instructions.

## Public source release

1. Set the version and increment `buildNumber` in `package.json`. Regenerate the lockfile.
2. Keep all third-party notices and [provenance records](PROVENANCE.md). Review source, history, screenshots, privacy documentation, and platform claims.
3. Run the source, native, and browser checks. Build the Mac app from a fresh checkout without a signing identity. Verify local signing and installation with `node scripts/check-mac-signing.mjs`.
4. Test capture, annotation, attachment copying, and persistence with synthetic notes. Record the tested macOS and host versions.
5. Publish the reviewed source commit or tag after the owner requests public visibility. Users compile the app locally.
