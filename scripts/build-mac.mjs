import { access, readFile, writeFile, mkdir, mkdtemp, rm, copyFile, chmod, realpath, cp, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

export async function prepareSigningIdentity({ destination, scratch, requested = process.env.MARGIN_NOTES_SIGN_IDENTITY }) {
  let identity = requested?.trim();
  if (identity === '-') return '-';
  if (!identity) {
    try { await access(destination); }
    catch (error) { if (error.code === 'ENOENT') return '-'; throw error; }
    const signature = spawnSync('/usr/bin/codesign', ['--display', '--verbose=4', destination], { encoding: 'utf8' });
    if (signature.status !== 0) throw Error('Cannot inspect the existing app signature. Choose an empty destination or set MARGIN_NOTES_SIGN_IDENTITY explicitly.');
    if (/^Signature=adhoc$/m.test(signature.stdout + signature.stderr)) return '-';
  }
  await mkdir(scratch, { recursive: true });
  const temporary = await mkdtemp(path.join(scratch, 'signing-'));
  try {
    if (!identity) {
      try {
        const prefix = path.join(temporary, 'certificate');
        execFileSync('/usr/bin/codesign', ['--display', '--extract-certificates=' + prefix, destination], { stdio: 'pipe' });
        identity = createHash('sha1').update(await readFile(prefix + '0')).digest('hex').toUpperCase();
      } catch { throw Error('Cannot reuse the existing app certificate. Set MARGIN_NOTES_SIGN_IDENTITY to its code-signing certificate.'); }
    }
    const available = execFileSync('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8', stdio: 'pipe' });
    const identities = [...available.matchAll(/^\s*\d+\)\s+([A-F0-9]{40})\s+"([^"]+)"/gm)];
    const matches = identities.filter(([, hash, name]) => hash === identity.toUpperCase() || name === identity);
    if (matches.length !== 1) throw Error('A unique usable code-signing certificate is required. Set MARGIN_NOTES_SIGN_IDENTITY to its SHA-1 fingerprint.');
    const signer = matches[0][1], probe = path.join(temporary, 'probe');
    await copyFile('/usr/bin/true', probe);
    execFileSync('/usr/bin/codesign', ['--force', '--sign', signer, '--identifier', 'org.marginnotes.signing-probe', probe], { stdio: 'pipe' });
    execFileSync('/usr/bin/codesign', ['--verify', '--strict', probe], { stdio: 'pipe' });
    return signer;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}


export async function installApp(staged, destination, move = rename) {
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = await mkdtemp(path.join(path.dirname(destination), '.margin-notes-install-'));
  const replacement = path.join(temporary, 'replacement.app'), previous = path.join(temporary, 'previous.app');
  let hadPrevious = false, retainBackup = false;
  try {
    await cp(staged, replacement, { recursive: true, errorOnExist: true, force: false });
    try { await move(destination, previous); hadPrevious = true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { await move(replacement, destination); }
    catch (error) {
      if (hadPrevious) {
        try { await move(previous, destination); }
        catch (rollback) {
          retainBackup = true;
          throw new AggregateError([error, rollback], 'Installation failed. The previous app is retained at ' + previous);
        }
      }
      throw error;
    }
  } finally { if (!retainBackup) await rm(temporary, { recursive: true, force: true }); }
}

export async function stageApp({ destination, scratch }, build) {
  await mkdir(scratch, { recursive: true });
  const temporary = await mkdtemp(path.join(scratch, 'app-'));
  try {
    const staged = path.join(temporary, 'Margin Notes.app');
    await build(staged);
    await installApp(staged, destination);
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

async function buildMac() {
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw Error('Build this app on an Apple Silicon Mac.');
if (Number(process.versions.node.split('.')[0]) < 24) throw Error('Install Node.js 24 or later before building.');
if (process.argv.slice(2).some(argument => argument !== '--install')) throw Error('Usage: node scripts/build-mac.mjs [--install]');
try { execFileSync('/usr/bin/xcrun', ['--find', 'swiftc'], { stdio: 'pipe' }); }
catch { throw Error('Install Xcode Command Line Tools with xcode-select --install, then run this command again.'); }
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(manifest.version) || !Number.isSafeInteger(manifest.buildNumber) || manifest.buildNumber < 1) throw Error('Use a release version and positive buildNumber in package.json.');
const destination = path.resolve(process.env.MARGIN_NOTES_APP || (process.argv.includes('--install') ? path.join(homedir(), 'Applications/Margin Notes.app') : 'build/Margin Notes.app'));
const executable = path.join(destination, 'Contents/MacOS/MarginNotes');
const running = execFileSync('/bin/ps', ['-wwaxo', 'args='], { encoding: 'utf8' });
if (running.split('\n').some(command => command.trim() === executable || command.trim().startsWith(executable + ' '))) throw Error('Quit Margin Notes at the destination before updating it. Saved annotations will remain.');
const scratch = path.resolve(process.env.MARGIN_NOTES_BUILD || 'build/mac');
const signer = await prepareSigningIdentity({ destination, scratch });
await stageApp({ destination, scratch }, async staged => {
const contents = path.join(staged, 'Contents'), resources = path.join(contents, 'Resources');
await import('./build.mjs');
await mkdir(resources, { recursive: true }); await mkdir(path.join(contents, 'MacOS'), { recursive: true }); await mkdir(scratch, { recursive: true });
const node = await realpath(process.env.NODE_BINARY || process.execPath);
const license = process.env.NODE_LICENSE || path.resolve(path.dirname(node), '../LICENSE');
await copyFile(license, path.join(resources, 'NODE_LICENSE.txt'));
await copyFile(node, path.join(resources, 'node')); await chmod(path.join(resources, 'node'), 0o755);
const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">`;
const html = (await readFile('dist/capture.html', 'utf8')).replace('<head>', '<head>' + csp);
await writeFile(path.join(resources, 'capture.html'), html);
await copyFile('dist/desktop-worker.mjs', path.join(resources, 'desktop-worker.mjs'));
for (const name of ['LICENSE', 'THIRD_PARTY_LICENSES.txt']) await copyFile(name, path.join(resources, name));
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Margin Notes</string><key>CFBundleDisplayName</key><string>Margin Notes</string>
<key>CFBundleIdentifier</key><string>org.marginnotes.desktop</string><key>CFBundleExecutable</key><string>MarginNotes</string>
<key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>${manifest.buildNumber}</string><key>CFBundleShortVersionString</key><string>${manifest.version}</string>
<key>LSMinimumSystemVersion</key><string>14.2</string><key>NSHighResolutionCapable</key><true/>
<key>CFBundleIconFile</key><string>AppIcon</string><key>NSHumanReadableCopyright</key><string>MIT licensed. Margin Notes contributors.</string>
</dict></plist>`;
await writeFile(path.join(contents, 'Info.plist'), plist);
const iconset = path.join(scratch, 'AppIcon.iconset'); await mkdir(iconset, { recursive: true });
execFileSync('/usr/bin/swift', ['-module-cache-path', path.join(scratch, 'module-cache'), 'desktop/AppIcon.swift', iconset], { stdio: 'inherit' });
execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', path.join(resources, 'AppIcon.icns')]);
await copyFile(path.join(iconset, 'icon_128x128.png'), path.join(resources, 'icon.png'));
await copyFile('desktop/MarginNotes.swift', path.join(scratch, 'main.swift'));
execFileSync('/usr/bin/swiftc', ['-O', '-target', 'arm64-apple-macos14.2', '-module-cache-path', path.join(scratch, 'module-cache'), '-framework', 'AppKit', '-framework', 'WebKit', '-module-name', 'MarginNotes', path.join(scratch, 'main.swift'), 'desktop/AnnotationPanel.swift', 'desktop/SelectionCapture.swift', 'desktop/AnnotationAttachment.swift', 'desktop/ShiftGesture.swift', '-o', path.join(contents, 'MacOS/MarginNotes')], { stdio: 'inherit' });
execFileSync('/usr/bin/codesign', ['--force', '--sign', signer, path.join(resources, 'node')]);
execFileSync('/usr/bin/codesign', ['--force', '--sign', signer, staged]);
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', staged]);
});
console.log(process.argv.includes('--install') ? 'Installed and verified ' + destination.replace(homedir(), '~') : 'Built and verified Margin Notes.app for Apple Silicon.');
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) await buildMac();
