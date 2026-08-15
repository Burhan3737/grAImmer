/**
 * Builds the loadable extension into dist/extension.
 *
 * Bundling is not optional here. MV3 content scripts cannot be ES modules, so
 * the content script must be flattened into an IIFE. The background worker
 * can be a module, and is kept as one so nspell's imports resolve normally.
 *
 * The dictionary ships as two plain files fetched at runtime rather than
 * being inlined. MV3 forbids loading WASM or large blobs from data: URLs, and
 * a separate file is what shipping extensions do.
 */

import { build } from 'esbuild';
import { copyFileSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Built into a committed folder at the repo root rather than dist/, so the
// extension can be loaded straight after a clone with no toolchain at all.
// Committing build output is normally an anti-pattern; for a load-unpacked
// extension it is the difference between "clone and load" and "install node,
// install dependencies, run a build, then load".
const out = join(root, 'extension');

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'dictionaries'), { recursive: true });

const shared = {
  bundle: true,
  target: ['chrome116'],
  logLevel: 'warning',
  legalComments: 'none',
};

await build({
  ...shared,
  entryPoints: [join(root, 'src/content/index.js')],
  outfile: join(out, 'content.js'),
  format: 'iife',
});

await build({
  ...shared,
  entryPoints: [join(root, 'src/background/index.js')],
  outfile: join(out, 'background.js'),
  format: 'esm',
});

await build({
  ...shared,
  entryPoints: [join(root, 'src/ui/options.js')],
  outfile: join(out, 'options.js'),
  format: 'iife',
});

await build({
  ...shared,
  entryPoints: [join(root, 'src/ui/popup.js')],
  outfile: join(out, 'popup.js'),
  format: 'iife',
});

copyFileSync(join(root, 'src/manifest.json'), join(out, 'manifest.json'));
copyFileSync(join(root, 'src/content/content.css'), join(out, 'content.css'));
copyFileSync(join(root, 'src/ui/options.html'), join(out, 'options.html'));
copyFileSync(join(root, 'src/ui/popup.html'), join(out, 'popup.html'));

copyFileSync(join(root, 'node_modules/dictionary-en/index.aff'), join(out, 'dictionaries/en.aff'));
copyFileSync(join(root, 'node_modules/dictionary-en/index.dic'), join(out, 'dictionaries/en.dic'));

// The dictionary's licence must travel with it.
copyFileSync(join(root, 'node_modules/dictionary-en/license'), join(out, 'dictionaries/LICENSE'));

const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));

console.log(`built extension/  (manifest v${manifest.manifest_version}, ${manifest.name} ${manifest.version})`);
console.log('load it: chrome://extensions -> Developer mode -> Load unpacked -> select the extension folder');
