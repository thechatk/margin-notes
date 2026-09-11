import { build } from 'esbuild';
import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

await mkdir('dist', { recursive: true });
await Promise.all(['dist/reader.html', 'dist/server.mjs'].map(file => rm(file, { force: true })));
const shared = { bundle: true, minify: true, legalComments: 'eof', metafile: true };
const worker = await build({ ...shared, entryPoints: ['src/desktop-worker.mjs'], platform: 'node', format: 'esm', target: 'node24', outfile: 'dist/desktop-worker.mjs' });
const capture = await build({
  ...shared, entryPoints: ['src/capture.mjs'], platform: 'browser', format: 'esm', target: 'safari17.2', write: false,
  loader: { '.mjs': 'jsx' }, jsx: 'automatic', alias: { '@': path.resolve('src/vendor/fluid') },
});
const captureCSS = execFileSync(process.execPath, ['node_modules/@tailwindcss/cli/dist/index.mjs', '--input', 'src/capture.css', '--minify'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
await writeFile('dist/capture.html', (await readFile('src/capture.html', 'utf8')).replace('/* STYLES */', () => captureCSS.replace(/<\/style/gi, '<\\/style')).replace('/* SCRIPT */', () => capture.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')));
const packages = new Set(Object.keys({ ...worker.metafile.inputs, ...capture.metafile.inputs }).flatMap(file => file.match(/^(node_modules\/(?:@[^/]+\/)?[^/]+)/)?.[1] || []));
const notices = ['Third-party code included in the app and runtime.'];
for (const directory of [...packages].sort()) {
  const manifest = JSON.parse(await readFile(directory + '/package.json', 'utf8'));
  const licenseFiles = (await readdir(directory)).filter(name => /^(licen[sc]e|copying|notice)([.-]|$)/i.test(name));
  if (!licenseFiles.length) throw Error(`Missing license text for ${manifest.name}.`);
  notices.push(`\n${manifest.name} ${manifest.version}\nLicense: ${manifest.license}\n`);
  for (const file of licenseFiles) notices.push(await readFile(directory + '/' + file, 'utf8'));
}
notices.push('\nFluid Functionalism\nSource: https://github.com/mickadesign/fluid-functionalism\n', await readFile('src/vendor/fluid/LICENSE.txt', 'utf8'));
notices.push('\nLina (Fluid scrollbar adaptation)\nSource: https://github.com/SameerJS6/lina\n', await readFile('src/vendor/fluid/LICENSE_LINA.txt', 'utf8'));
notices.push('\nSource and asset provenance\n', await readFile('docs/PROVENANCE.md', 'utf8'));
await writeFile('THIRD_PARTY_LICENSES.txt', notices.join('\n'));
console.log('Built the annotation panel and standalone runtime.');
