import readline from 'node:readline';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { directory, locked, MAX_BYTES, writeJSON } from './store.mjs';
const context = z.object({
  capturedAt: z.iso.datetime({ offset: true }).max(64).optional(),
  bundleId: z.string().max(255).optional(), windowTitle: z.string().max(2048).optional(),
  document: z.object({ value: z.string().min(1).max(8192), kind: z.enum(['file', 'url']), observedFrom: z.literal('accessibility') }).strict().optional(),
  range: z.object({
    start: z.number().int().nonnegative(), length: z.number().int().nonnegative(),
    unit: z.literal('utf16'), scope: z.literal('element'),
  }).strict().refine(value => Number.isSafeInteger(value.start + value.length), 'The selection range is too large.').optional(),
  prefix: z.string().max(256).optional(), suffix: z.string().max(256).optional(),
  locationStatus: z.enum(['verified', 'partial', 'unresolved']).optional(),
  captureMethod: z.enum(['accessibility', 'copy']).optional(),
}).strict();
const capture = z.object({
  id: z.string().uuid(), quote: z.string().max(100000), comment: z.string().max(20000),
  source: z.string().max(255), context: context.optional(),
}).strict();
const savedCapture = capture.extend({
  quote: z.string().min(1).max(100000),
  comment: z.string().max(20000).refine(value => value.trim().length > 0),
});
const fields = { generation: z.number().int().nonnegative(), notes: z.array(savedCapture).max(200), draft: capture.nullable() };
const captures = z.object({ format: z.literal(2), ...fields, queuedDrafts: z.array(capture).max(200) }).strict()
  .refine(value => value.queuedDrafts.length + Number(value.draft !== null) <= 200, 'Keep the collection under 200 drafts.')
  .refine(value => Buffer.byteLength(JSON.stringify(value)) <= MAX_BYTES, 'Keep annotations under 2 MB.');
const legacyCaptures = z.object({ format: z.literal(1), ...fields }).strict()
  .refine(value => Buffer.byteLength(JSON.stringify(value)) <= MAX_BYTES, 'Keep annotations under 2 MB.');
const filename = path.join(directory, 'captures.json');
async function readCaptures() {
  try {
    const value = JSON.parse(await fs.readFile(filename, 'utf8'));
    if (value.format === 1) return { ...legacyCaptures.parse(value), format: 2, queuedDrafts: [] };
    return captures.parse(value);
  }
  catch (error) {
    if (error.code === 'ENOENT') return { format: 2, generation: 0, notes: [], draft: null, queuedDrafts: [] };
    throw Error('Saved quick notes could not be read. Their draft file has been preserved.');
  }
}
async function operate(name, args) {
  switch (name) {
    case 'read_captures': return readCaptures();
    case 'save_captures': {
      const next = captures.parse(args);
      const drafts = [...next.queuedDrafts, ...(next.draft ? [next.draft] : [])];
      if ([next.notes, drafts].some(entries => new Set(entries.map(note => note.id)).size !== entries.length)) throw Error('Annotations contain a duplicate identifier.');
      return locked(async () => {
        const current = await readCaptures();
        if (next.generation !== current.generation) throw Error('Quick notes changed in another window. Export your notes before reopening.');
        next.generation++;
        await writeJSON(filename, next);
        return next;
      });
    }
    case 'archive_captures': {
      const { generation } = z.object({ generation: z.number().int().nonnegative() }).strict().parse(args);
      return locked(async () => {
        const current = await readCaptures();
        if (generation !== current.generation) throw Error('Quick notes changed. Reopen them before archiving.');
        if (current.draft !== null || current.queuedDrafts.length) throw Error('Save or discard every draft first.');
        if (current.notes.length) await writeJSON(path.join(directory, 'captures.' + randomUUID() + '.archive.json'), current);
        const next = { format: 2, generation: generation + 1, notes: [], draft: null, queuedDrafts: [] };
        await writeJSON(filename, next);
        return next;
      });
    }
    default: throw Error('Unknown operation.');
  }
}

for await (const line of readline.createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  let id = null;
  try {
    if (Buffer.byteLength(line) > 8 * MAX_BYTES) throw Error('The request is too large.');
    const message = z.object({ id: z.number().int().nonnegative(), name: z.string(), arguments: z.record(z.string(), z.unknown()) }).strict().parse(JSON.parse(line));
    id = message.id;
    process.stdout.write(JSON.stringify({ id, value: await operate(message.name, message.arguments) }) + '\n');
  } catch (error) {
    const message = error instanceof z.ZodError ? 'Invalid annotation data. Your saved notes were preserved.' : error.code ? 'The file operation failed. Your saved notes were preserved.' : error.message;
    process.stdout.write(JSON.stringify({ id, error: message }) + '\n');
  }
}
