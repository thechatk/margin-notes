import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

export const MAX_BYTES = 2 * 1024 * 1024;
export const directory = process.env.MARGIN_NOTES_DATA || process.env.PLUGIN_DATA || path.join(os.homedir(), '.local', 'state', 'margin-notes');

export async function writeJSON(filename, value) {
  const temporary = filename + '.' + randomUUID() + '.tmp';
  const handle = await fs.open(temporary, 'wx', 0o600);
  try {
    try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); }
    finally { await handle.close(); }
    await fs.rename(temporary, filename);
  } finally { await fs.unlink(temporary).catch(() => {}); }
}

export async function locked(operation) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const lockPath = path.join(directory, 'captures.lock');
  let lock;
  for (let attempt = 0; attempt < 20; attempt++) {
    try { lock = await fs.open(lockPath, 'wx', 0o600); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const stat = await fs.stat(lockPath).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > 30000) await fs.unlink(lockPath).catch(() => {});
      await setTimeout(25);
    }
  }
  if (!lock) throw Error('Another window is saving these annotations. Try again.');
  try { return await operation(); }
  finally { await lock.close(); await fs.unlink(lockPath).catch(() => {}); }
}
