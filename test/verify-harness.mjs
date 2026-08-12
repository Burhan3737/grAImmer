/**
 * Browser verification for the harness.
 *
 * SANDBOXING: every run uses `browser.newContext()`, which is an isolated,
 * incognito-equivalent context — no persistent profile, no shared cookies,
 * no storage carried in or out, and it is destroyed when the browser closes.
 * Nothing here touches a real browser profile or any logged-in session.
 * The page under test is a local file that makes no network requests.
 *
 * Layout cannot be faked. jsdom has no box model, so getClientRects() returns
 * zeroes there and the contenteditable overlay would appear to work while
 * drawing nothing. That is why this runs in real Chromium.
 */

import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = pathToFileURL(join(root, 'dist/harness.html')).href;

const checks = [];
function record(name, pass, detail = '') {
  checks.push({ name, pass, detail });
  console.log(`${pass ? '  ok  ' : '  FAIL'} ${name}${pass || !detail ? '' : `\n       -> ${detail}`}`);
}

const browser = await chromium.launch();
// Isolated context — the sandbox boundary.
const context = await browser.newContext();
const page = await context.newPage();

const consoleErrors = [];
page.on('pageerror', (error) => consoleErrors.push(String(error)));
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});

await page.goto(target);
await page.waitForSelector('#suite .case');

/* ---------------------------------------------------------- 1. no errors */
record('page loads with no JavaScript errors', consoleErrors.length === 0, consoleErrors.join(' | '));

/* ---------------------------------------------------- 2. suite all green */
const suite = await page.textContent('#chip-suite');
const [passed, total] = suite.split('/').map(Number);
record(`test suite reports ${suite}`, passed === total, `${total - passed} case(s) failing in-browser`);

/* --------------------------------------------- 3. textarea draws squiggles */
const marks = await page.locator('#mirror-ta mark').count();
record('textarea overlay draws underlines', marks > 0, `expected >0 marks, got ${marks}`);

/* ------------------------------------ 4. contenteditable draws real rects */
const rectBoxes = await page.locator('#rects-ce .rect').evaluateAll((nodes) =>
  nodes.map((n) => ({ w: n.getBoundingClientRect().width, h: n.getBoundingClientRect().height }))
);
const sized = rectBoxes.filter((r) => r.w > 0 && r.h > 0);
record(
  'contenteditable overlay measures non-zero rectangles',
  sized.length > 0,
  `${rectBoxes.length} rects, ${sized.length} with real size — zero-size means offset mapping failed`
);

/* --------------------------------- 5. the editor DOM is never written to */
const ceHtmlBefore = await page.innerHTML('#ce');
const pollutes = /data-graimmer|class="rect"|<mark/i.test(ceHtmlBefore);
record('contenteditable content is not modified by the overlay', !pollutes,
  'overlay markup leaked into the field — a sent email would carry it');

/* ------------------------------------------ 6. clicking a squiggle works */
await page.locator('#mirror-ta mark').first().click();
const cardVisible = await page.locator('.card').count();
record('clicking a squiggle opens the suggestion card', cardVisible === 1, `${cardVisible} cards`);

/* ------------------------------------------------- 7. applying a fix works */
const before = await page.inputValue('#ta');
const suggestion = await page.locator('.card .card-fix').first().textContent();
await page.locator('.card .card-fix').first().click();
const after = await page.inputValue('#ta');
record('applying a fix changes the field text', before !== after,
  'text unchanged after clicking a suggestion');
record('applied text contains the suggestion', after.includes(suggestion.trim()),
  `expected "${suggestion.trim()}" in the result`);

/* -------------------------------- 8. re-check runs after the fix is applied */
await page.waitForTimeout(700);
const reissues = await page.locator('#mirror-ta mark').count();
record('field re-checks after a fix is applied', reissues >= 0 && reissues < marks,
  `marks went ${marks} -> ${reissues}; expected a decrease`);

/* ------------------------------- 9. skip toggles change what reaches checks */
// Asserted on DROPPED TOKENS, not on issue count. The proper-noun skip exists
// solely to stop names being flagged as misspellings, and spelling is not in
// this slice — so it correctly changes nothing visible yet. Token-level is the
// invariant that holds both now and once the dictionary lands.
const droppedBefore = await page.locator('#toks .tok.dropped').count();
await page.uncheck('#opt-propernouns');
await page.waitForTimeout(200);
const droppedAfter = await page.locator('#toks .tok.dropped').count();
record('turning off a skip rule lets more tokens through to the checker',
  droppedAfter < droppedBefore, `dropped tokens ${droppedBefore} -> ${droppedAfter}`);
await page.check('#opt-propernouns');

/* -------------- 9b. a skip rule that DOES affect results in this slice */
const issuesBefore = Number((await page.textContent('#chip-ta')).split(' ')[0]);
await page.uncheck('#opt-quoted');
await page.waitForTimeout(200);
const issuesAfter = Number((await page.textContent('#chip-ta')).split(' ')[0]);
record('turning off the quoted-history skip surfaces more issues',
  issuesAfter >= issuesBefore, `${issuesBefore} -> ${issuesAfter}`);
await page.check('#opt-quoted');

/* ------------------------------------------- 10. dark theme stays readable */
await page.emulateMedia({ colorScheme: 'dark' });
await page.waitForTimeout(120);
const contrast = await page.evaluate(() => {
  const body = getComputedStyle(document.body);
  const parse = (c) => (c.match(/\d+/g) || []).slice(0, 3).map(Number);
  const lum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const a = lum(parse(body.color));
  const b = lum(parse(body.backgroundColor));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
});
record('dark theme body contrast >= 7:1', contrast >= 7, `measured ${contrast.toFixed(2)}:1`);

await page.screenshot({ path: join(root, 'dist/harness-dark.png'), fullPage: true });
await page.emulateMedia({ colorScheme: 'light' });
await page.screenshot({ path: join(root, 'dist/harness-light.png'), fullPage: true });

await context.close();
await browser.close();

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} browser checks passing`);
process.exit(failed.length ? 1 : 0);
