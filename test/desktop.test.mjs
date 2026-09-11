import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, readdir, rm, copyFile, stat, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';
import { writeJSON } from '../src/store.mjs';

function worker(t, file, directory) {
  const child = spawn(process.execPath, [file], { env: { ...process.env, MARGIN_NOTES_DATA: directory }, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  let id = 0; const pending = new Map();
  readline.createInterface({ input: child.stdout }).on('line', line => {
    const result = JSON.parse(line), callback = pending.get(result.id); pending.delete(result.id);
    if (result.error) callback.reject(Error(result.error)); else callback.resolve(result.value);
  });
  const call = (name, args = {}) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject }); child.stdin.write(JSON.stringify({ id, name, arguments: args }) + '\n');
  });
  return call;
}

test('standalone worker migrates captures, preserves metadata and queued edits, and protects saved data', { timeout: 20000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'margin-desktop-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await copyFile(new URL('../dist/desktop-worker.mjs', import.meta.url), path.join(directory, 'worker.mjs'));
  const call = worker(t, path.join(directory, 'worker.mjs'), directory);
  let state = await call('read_captures');
  assert.deepEqual(state, { format: 2, generation: 0, notes: [], draft: null, queuedDrafts: [] });
  const oldNote = { id: randomUUID(), quote: 'Earlier passage', comment: ' Preserve this comment. ', source: 'Example app' };
  const oldDraft = { id: randomUUID(), quote: 'Unfinished passage', comment: 'Keep writing', source: 'Example app' };
  const legacy = { format: 1, generation: 7, notes: [oldNote], draft: oldDraft };
  await writeFile(path.join(directory, 'captures.json'), JSON.stringify(legacy));
  state = await call('read_captures');
  assert.deepEqual(state, { ...legacy, format: 2, queuedDrafts: [] });
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'captures.json'), 'utf8')), legacy);

  const context = {
    capturedAt: '2026-09-10T18:00:00.123Z', bundleId: 'org.example.editor', windowTitle: 'Source.md',
    document: { value: 'file:///example/source.md', kind: 'file', observedFrom: 'accessibility' },
    range: { start: 12, length: 36, unit: 'utf16', scope: 'element' },
    prefix: 'Before. ', suffix: ' After.', locationStatus: 'verified', captureMethod: 'accessibility',
  };
  const draft = { id: randomUUID(), quote: '<script>literal 🧭</script>\nПовтор', comment: 'Explain cafe\u0301', source: 'Example app', context };
  state = await call('save_captures', { ...state, draft, queuedDrafts: [oldDraft] });
  assert.deepEqual((await call('read_captures')).draft, draft);
  assert.deepEqual((await call('read_captures')).queuedDrafts, [oldDraft]);
  await assert.rejects(call('archive_captures', { generation: state.generation }), /draft first/);
  await assert.rejects(call('save_captures', { ...state, generation: 0, notes: [draft], draft: null }), /changed/);
  await assert.rejects(call('save_captures', { ...state, notes: [draft, draft], draft: null }), /duplicate/);
  await assert.rejects(call('save_captures', { ...state, queuedDrafts: [draft] }), /duplicate/);
  await assert.rejects(call('save_captures', { ...state, notes: [{ ...draft, comment: '  ' }], draft: null }), /Invalid annotation/);
  for (const invalidContext of [
    { ...context, unknown: true },
    { ...context, capturedAt: 'yesterday' },
    { ...context, prefix: 'x'.repeat(257) },
    { ...context, document: { ...context.document, observedFrom: 'guessed' } },
    { ...context, document: { ...context.document, extra: true } },
    ...[-1, 0.5, Number.MAX_SAFE_INTEGER].map(start => ({ ...context, range: { ...context.range, start } })),
    { ...context, range: { ...context.range, length: -1 } },
    { ...context, range: { ...context.range, unit: 'bytes' } },
    { ...context, range: { ...context.range, extra: true } },
  ]) await assert.rejects(call('save_captures', { ...state, draft: { ...draft, context: invalidContext } }), /Invalid annotation/);
  await assert.rejects(call('save_captures', { ...state, unknown: true }), /Invalid annotation/);
  assert.deepEqual(await call('read_captures'), state);

  state = await call('save_captures', { ...state, notes: [draft], draft: { ...draft, comment: 'A revised comment' }, queuedDrafts: [oldDraft] });
  assert.equal(state.draft.id, state.notes[0].id);
  const nextDraft = { id: randomUUID(), quote: 'Another selection', comment: '', source: 'Browser', context: { captureMethod: 'copy', locationStatus: 'unresolved' } };
  const queued = [oldDraft, state.draft];
  state = await call('save_captures', { ...state, draft: nextDraft, queuedDrafts: queued });
  assert.deepEqual(await call('read_captures'), state);
  assert.deepEqual(state.queuedDrafts, queued);
  state = await call('save_captures', { ...state, draft: null });
  await assert.rejects(call('archive_captures', { generation: state.generation }), /draft first/);
  state = await call('save_captures', { ...state, draft: { id: randomUUID(), quote: '', comment: '', source: '' }, queuedDrafts: [] });
  await assert.rejects(call('archive_captures', { generation: state.generation }), /draft first/);
  state = await call('save_captures', { ...state, draft: null });
  const archived = await call('archive_captures', { generation: state.generation });
  assert.deepEqual(archived, { format: 2, generation: state.generation + 1, notes: [], draft: null, queuedDrafts: [] });
  const archive = (await readdir(directory)).find(file => file.endsWith('.archive.json'));
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, archive), 'utf8')).notes, [draft]);

  const fullLegacy = { ...legacy, generation: archived.generation, notes: Array.from({ length: 200 }, () => ({ ...oldNote, id: randomUUID() })) };
  await writeFile(path.join(directory, 'captures.json'), JSON.stringify(fullLegacy));
  state = await call('save_captures', await call('read_captures'));
  assert.deepEqual(state.notes, fullLegacy.notes);
  assert.deepEqual(state.draft, oldDraft);
  const drafts = Array.from({ length: 200 }, () => ({ ...nextDraft, id: randomUUID() }));
  await assert.rejects(call('save_captures', { ...state, queuedDrafts: drafts }), /Invalid annotation/);
  await assert.rejects(call('save_captures', { ...state, notes: [...state.notes, draft] }), /Invalid annotation/);
  const largeDrafts = Array.from({ length: 30 }, () => ({ ...nextDraft, id: randomUUID(), quote: 'x'.repeat(100000) }));
  await assert.rejects(call('save_captures', { ...state, draft: null, queuedDrafts: largeDrafts }), /Invalid annotation/);
  assert.deepEqual(await call('read_captures'), state);
  state = await call('save_captures', { ...state, queuedDrafts: drafts.slice(1) });
  assert.equal(state.queuedDrafts.length + 1, 200);
  await assert.rejects(call('delete_everything'), /Unknown operation/);
  await assert.rejects(call('open_document', { filePath: '/example/source.md' }), /Unknown operation/);
  assert.equal((await stat(path.join(directory, 'captures.json'))).mode & 0o777, 0o600);
  assert.equal((await readdir(directory)).some(file => file.endsWith('.tmp') || file.endsWith('.lock')), false);
  const corrupt = '{"format":2,"notes":"invalid"}';
  await writeFile(path.join(directory, 'captures.json'), corrupt);
  await assert.rejects(call('read_captures'), /draft file has been preserved/);
  await assert.rejects(call('save_captures', state), /draft file has been preserved/);
  assert.equal(await readFile(path.join(directory, 'captures.json'), 'utf8'), corrupt);
});

test('competing workers preserve the winning save and failed writes clean up temporary files', { timeout: 10000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'margin-concurrent-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.resolve('dist/desktop-worker.mjs');
  const first = worker(t, file, directory), second = worker(t, file, directory);
  const state = await first('read_captures');
  const note = { id: randomUUID(), quote: 'Same passage', comment: 'First edit', source: 'Example app' };
  const results = await Promise.allSettled([
    first('save_captures', { ...state, notes: [note] }),
    second('save_captures', { ...state, notes: [{ ...note, comment: 'Second edit' }] }),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.match(results.find(result => result.status === 'rejected').reason.message, /changed in another window/);
  assert.deepEqual(await first('read_captures'), results.find(result => result.status === 'fulfilled').value);
  assert.equal((await first('read_captures')).generation, 1);
  const blocked = path.join(directory, 'blocked.json');
  await mkdir(blocked);
  await assert.rejects(writeJSON(blocked, { value: 'A failed save' }), { code: 'EISDIR' });
  assert.equal((await stat(blocked)).isDirectory(), true);
  assert.equal((await readdir(directory)).some(file => file.endsWith('.tmp') || file.endsWith('.lock')), false);
});
