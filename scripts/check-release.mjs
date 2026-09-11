import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const json = async file => JSON.parse(await readFile(file, 'utf8'));
const manifest = await json('package.json');
const lock = await json('package-lock.json');
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.equal(lock.version, manifest.version);
assert.equal(lock.packages[''].version, manifest.version);
assert.ok(Number.isSafeInteger(manifest.buildNumber) && manifest.buildNumber > 0);
{
  const directory = 'src/vendor/fluid';
  for (const entry of (await json(`${directory}/ORIGIN.json`)).files) {
    assert.equal(createHash('sha256').update(await readFile(`${directory}/${entry.file}`)).digest('hex'), entry.sha256, entry.file);
  }
}

const deleted = new Set(execFileSync('git', ['ls-files', '--deleted', '-z'], { encoding: 'utf8' }).split('\0'));
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(file => file && !deleted.has(file));
const issues = [];
for (const file of files) {
  if (/(^|\/)(node_modules|dist|build|releases|Attachments|\.preview|\.impeccable)(\/|$)|\.app(\/|$)|(^|\/)\.env(?:\.|$)|\.(p12|pfx|key|pem|mobileprovision|log|zip|dmg)$|(^|\/)captures[^/]*\.json$|(^|\/)(?:HANDOFF|SPEC|VERIFICATION)\.md$/i.test(file)) issues.push(`${file}: generated or private file is tracked`);
  const bytes = await readFile(file);
  if (bytes.includes(0)) continue;
  const text = bytes.toString('utf8');
  if (/[/]Users[/][^/\s]+[/]|[/]var[/]folders[/]|[A-Z]:\\Users\\[^\\\s]+\\/.test(text)) issues.push(`${file}: machine-specific path`);
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{36,}|\bgithub_pat_[A-Za-z0-9_]{40,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/.test(text)) issues.push(`${file}: possible embedded credential`);
}
assert.deepEqual(issues, [], issues.join('\n'));
console.log('Release checks passed: matching versions, vendored source hashes, published-file hygiene, and common credential patterns.');
