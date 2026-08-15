/**
 * Loads the extension from a FRESH CLONE, not from the working tree.
 *
 * Everything else in the suite tests files I built locally. This tests what
 * someone else actually receives: a clone, loaded straight into Chrome with
 * no npm install and no build step. It is the only check that would catch a
 * file missing from the repository, or mangled by checkout.
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const clone = process.argv[2];
if (!clone || !existsSync(join(clone, 'extension', 'manifest.json'))) {
  console.error('usage: node verify-clone.mjs <path-to-fresh-clone>');
  process.exit(2);
}

const extensionPath = join(clone, 'extension');
const fixture = readFileSync(join(clone, 'test/fixtures/compose.html'));

const server = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fixture);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const profileDir = mkdtempSync(join(tmpdir(), 'graimmer-clone-'));
const context = await chromium.launchPersistentContext(profileDir, {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
});

const checks = [];
const record = (name, pass, detail = '') => {
  checks.push(pass);
  console.log(`${pass ? '  ok  ' : '  FAIL'} ${name}${pass || !detail ? '' : `\n       -> ${detail}`}`);
};

try {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  record('the cloned extension loads and registers its worker', Boolean(worker));

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(origin);
  await page.click('#plain');

  await page.waitForSelector('.graimmer-mark', { timeout: 20000 });
  record('grammar underlines appear', true);
  record('no page errors', errors.length === 0, errors.join(' | '));

  // The dictionary is the file most at risk from checkout mangling, so this
  // is the check that matters most here.
  await page.fill('#plain', 'I have recieved the documnt already.');
  let spelling = 0;
  try {
    await page.waitForSelector('.graimmer-mark[data-severity="spelling"]', { timeout: 20000 });
    spelling = await page.locator('.graimmer-mark[data-severity="spelling"]').count();
  } catch { /* reported below */ }
  record('the cloned dictionary works — spelling underlines appear', spelling >= 1,
    'no spelling marks: the dictionary did not survive checkout');

  await page.fill('#plain', 'Ping Sarah about Kubernetes at grafana.acme.io/x8f2 re INFRA-4471.');
  await page.waitForTimeout(2000);
  const noise = await page.locator('.graimmer-mark').count();
  record('names, URLs and identifiers stay unflagged', noise === 0, `${noise} marks`);
} finally {
  await context.close();
  server.close();
  rmSync(profileDir, { recursive: true, force: true });
}

const failed = checks.filter((c) => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} fresh-clone checks passing`);
process.exit(failed ? 1 : 0);
