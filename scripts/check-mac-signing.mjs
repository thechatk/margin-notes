import assert from 'node:assert/strict';
import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { prepareSigningIdentity, stageApp, installApp } from './build-mac.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const scratch = path.resolve(repo, process.env.MARGIN_NOTES_BUILD || 'build/mac');
await mkdir(scratch, { recursive: true });
const root = await mkdtemp(path.join(scratch, 'signing-regression-'));
const run = (args, succeeds = true) => {
  const result = spawnSync('/usr/bin/codesign', args, { encoding: 'utf8' });
  assert.equal(result.status === 0, succeeds, result.stderr);
  return result.stdout + result.stderr;
};
try {
  const signer = await prepareSigningIdentity({ destination: path.resolve(repo, process.env.MARGIN_NOTES_APP || 'build/Margin Notes.app'), scratch });
  const first = path.join(root, 'first.app'), second = path.join(root, 'second.app');
  const contents = path.join(first, 'Contents');
  await mkdir(path.join(contents, 'MacOS'), { recursive: true });
  await mkdir(path.join(contents, 'Resources'));
  await copyFile('/usr/bin/true', path.join(contents, 'MacOS', 'Fixture'));
  await writeFile(path.join(contents, 'Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>org.marginnotes.signing-regression</string><key>CFBundleExecutable</key><string>Fixture</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>');
  await writeFile(path.join(contents, 'Resources', 'version.txt'), 'First content version');
  run(['--force', '--sign', signer, first]);
  await cp(first, second, { recursive: true });
  const resource = path.join(second, 'Contents', 'Resources', 'version.txt');
  await writeFile(resource, 'Second content version');
  run(['--force', '--sign', signer, second]);
  const requirement = app => run(['--display', '-r-', app]).match(/^#?\s*designated => (.+)$/m)?.[1];
  const firstRequirement = requirement(first), secondRequirement = requirement(second);
  assert.ok(firstRequirement && secondRequirement);
  if (signer === '-') {
    assert.ok(firstRequirement.startsWith('cdhash '));
    assert.notEqual(secondRequirement, firstRequirement);
  } else {
    assert.ok(!firstRequirement.startsWith('cdhash '));
    assert.equal(secondRequirement, firstRequirement);
  }
  const hash = app => run(['--display', '--verbose=4', app]).match(/^CDHash=(.+)$/m)?.[1];
  assert.notEqual(hash(first), hash(second));
  for (const app of [first, second]) run(['--verify', '--deep', '--strict', '-R', '=' + requirement(app), app]);
  assert.equal(await prepareSigningIdentity({ destination: second, scratch, requested: '' }), signer);
  const before = await readdir(second, { recursive: true });
  const failed = spawnSync(process.execPath, ['scripts/build-mac.mjs'], {
    cwd: repo, encoding: 'utf8', env: { ...process.env, MARGIN_NOTES_APP: second, MARGIN_NOTES_BUILD: scratch, MARGIN_NOTES_SIGN_IDENTITY: 'missing-signing-regression-identity' },
  });
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /usable code-signing certificate/);
  assert.deepEqual(await readdir(second, { recursive: true }), before);
  assert.equal(await readFile(resource, 'utf8'), 'Second content version');
  run(['--verify', '--deep', '--strict', second]);
  const unsigned = path.join(root, 'unsigned.app');
  assert.equal(await prepareSigningIdentity({ destination: unsigned, scratch, requested: '' }), '-');
  assert.equal(await prepareSigningIdentity({ destination: second, scratch, requested: '-' }), '-');
  await mkdir(unsigned);
  await assert.rejects(prepareSigningIdentity({ destination: unsigned, scratch, requested: '' }), /Cannot inspect the existing app signature/);
  const local = path.join(root, 'local.app');
  await cp(first, local, { recursive: true });
  run(['--force', '--sign', '-', local]);
  assert.equal(await prepareSigningIdentity({ destination: local, scratch, requested: '' }), '-');

  const installed = path.join(root, 'installed.app'), staging = path.join(root, 'staging');
  const installedResource = path.join(installed, 'Contents', 'Resources', 'version.txt');
  await cp(second, installed, { recursive: true });
  const unchanged = async () => {
    assert.equal(await readFile(installedResource, 'utf8'), 'Second content version');
    run(['--verify', '--deep', '--strict', installed]);
    assert.deepEqual((await readdir(root)).filter(name => name.startsWith('.margin-notes-install-')), []);
  };
  await assert.rejects(stageApp({ destination: installed, scratch: staging }, async staged => {
    await writeFile(staged, 'Unfinished build');
    throw Error('Build failed');
  }), /Build failed/);
  await unchanged();
  assert.deepEqual(await readdir(staging), []);

  await assert.rejects(stageApp({ destination: installed, scratch: staging }, async staged => {
    await cp(first, staged, { recursive: true });
    await writeFile(path.join(staged, 'Contents', 'Resources', 'version.txt'), 'Invalid signature');
    run(['--verify', '--deep', '--strict', staged]);
  }));
  await unchanged();
  assert.deepEqual(await readdir(staging), []);

  await assert.rejects(installApp(path.join(root, 'missing.app'), installed), { code: 'ENOENT' });
  await unchanged();
  let moves = 0;
  await assert.rejects(installApp(first, installed, async (from, to) => {
    if (++moves === 2) throw Error('Final rename failed');
    return rename(from, to);
  }), /Final rename failed/);
  assert.equal(moves, 3);
  await unchanged();

  await stageApp({ destination: installed, scratch: staging }, async staged => {
    await cp(first, staged, { recursive: true });
    run(['--verify', '--deep', '--strict', staged]);
  });
  assert.equal(await readFile(installedResource, 'utf8'), 'First content version');
  run(['--verify', '--deep', '--strict', installed]);
  assert.deepEqual(await readdir(staging), []);
  const fresh = path.join(root, 'fresh.app');
  await installApp(second, fresh);
  run(['--verify', '--deep', '--strict', fresh]);

  const busyApp = path.join(root, 'busy.app'), executable = path.join(busyApp, 'Contents/MacOS/MarginNotes');
  await mkdir(path.dirname(executable), { recursive: true });
  const busySource = path.join(root, 'busy.c');
  await writeFile(busySource, '#include <stdio.h>\n#include <unistd.h>\nint main(void) { puts("ready"); fflush(stdout); sleep(30); }\n');
  const compiled = spawnSync('/usr/bin/xcrun', ['clang', busySource, '-o', executable], { encoding: 'utf8' });
  assert.equal(compiled.status, 0, compiled.stderr);
  const busyContents = await readFile(executable);
  const busy = spawn(executable);
  try {
    await once(busy, 'spawn');
    assert.equal(String((await once(busy.stdout, 'data'))[0]).trim(), 'ready');
    const result = spawnSync(process.execPath, ['scripts/build-mac.mjs', '--install'], {
      cwd: repo, encoding: 'utf8', env: { ...process.env, MARGIN_NOTES_APP: busyApp },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Quit Margin Notes at the destination/);
    assert.deepEqual(await readFile(executable), busyContents);
  } finally {
    const closed = once(busy, 'close');
    busy.kill('SIGKILL');
    await closed;
  }

  await writeFile(resource, 'Tampered content');
  run(['--verify', '--deep', '--strict', second], false);
  console.log('Build checks pass: local signing, existing-signature inspection, signer failure, tamper rejection, installation recovery, verified replacement, and refusal to update a running app. Signing mode: ' + (signer === '-' ? 'local' : 'certificate with stable identity') + '.');
} finally { await rm(root, { recursive: true, force: true }); }
