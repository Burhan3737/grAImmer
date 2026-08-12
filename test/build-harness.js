/**
 * Builds the browser test harness by inlining the real core modules into a
 * single self-contained HTML file.
 *
 * The point of generating rather than hand-writing: the harness must run the
 * SAME code the extension runs. A hand-copied harness drifts from source
 * within a day and then proves nothing.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Dependency order — tokenizer has no imports, engine has the most.
const MODULES = [
  'src/core/tokenizer.js',
  'src/core/skip-rules.js',
  'src/core/rules.js',
  'src/core/engine.js',
  'test/cases.js',
];

/** Strip ES module syntax so the files can be concatenated into one script. */
function flatten(source) {
  return source
    .replace(/import\s+(?:[\w*\s{},]+)\s+from\s+['"][^'"]+['"];?/g, '')
    .replace(/^export\s+/gm, '');
}

const engine = MODULES.map((relativePath) => {
  const source = readFileSync(join(root, relativePath), 'utf8');
  return `/* ===== ${relativePath} ===== */\n${flatten(source)}`;
}).join('\n\n');

const template = readFileSync(join(root, 'test/harness-template.html'), 'utf8');
const html = template.replace('/*__ENGINE__*/', () => engine);

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/harness.html'), html, 'utf8');

console.log(`built dist/harness.html  (${(html.length / 1024).toFixed(1)} KB)`);
