/**
 * End-to-end test of the loaded extension.
 *
 * SANDBOXING: runs in a throwaway Chrome profile created under the OS temp
 * directory and deleted when the run finishes. No real profile is touched, no
 * cookies or logins are present or produced, and the only page loaded is a
 * synthetic fixture served from 127.0.0.1. The extension makes no network
 * requests of its own by design.
 *
 * Why full Chromium and not the default headless shell: the shell cannot load
 * extensions at all. `channel: 'chromium'` selects the real browser, whose
 * new headless mode does support them.
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const extensionPath = join(root, 'extension');

const checks = [];
function record(name, pass, detail = '') {
  checks.push({ name, pass });
  console.log(`${pass ? '  ok  ' : '  FAIL'} ${name}${pass || !detail ? '' : `\n       -> ${detail}`}`);
}

/* Local fixture server — nothing leaves the machine. */
const fixture = readFileSync(join(root, 'test/fixtures/compose.html'));
const server = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fixture);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const profileDir = mkdtempSync(join(tmpdir(), 'graimmer-e2e-'));

const context = await chromium.launchPersistentContext(profileDir, {
  channel: 'chromium',
  headless: true,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
  ],
});

try {
  /* ------------------------------------------- 1. the worker registers */
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  record('background service worker registers', Boolean(worker));

  const extensionId = worker.url().split('/')[2];

  /* ------------------------------------ 3. content script does its job */
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.goto(`${origin}/`);

  // Focus IMMEDIATELY, with no grace period. Settings arrive asynchronously
  // from a worker that may be asleep, and a field focused before they land
  // must still be picked up. Losing this race means clicking straight into
  // Gmail's compose box after a page load leaves grAImmer inert, with nothing
  // to indicate anything is wrong.
  await page.click('#plain');
  await page.waitForSelector('.graimmer-layer .graimmer-mark', { timeout: 15000 });
  record('content script attaches and paints on a textarea', true);
  record('no page errors from the content script', pageErrors.length === 0, pageErrors.join(' | '));

  /* ------------------------------------------- 4. spelling comes back */
  // Waits for the condition rather than a fixed delay. This is the FIRST
  // spelling request, so it pays the cold worker's dictionary load on top of
  // the debounce — a fixed timeout makes the whole suite flaky on a busy
  // machine, which is worse than no test because it teaches people to
  // re-run rather than investigate.
  await page.fill('#plain', 'I have recieved the documnt already.');
  let spellingMarks = 0;
  try {
    await page.waitForSelector('.graimmer-mark[data-severity="spelling"]', { timeout: 20000 });
    spellingMarks = await page.locator('.graimmer-mark[data-severity="spelling"]').count();
  } catch { /* leave at 0 so the assertion reports the real failure */ }
  record('spelling underlines arrive from the background worker',
    spellingMarks >= 1, `no spelling marks within 20s — the worker never answered`);

  /* -------------------------- 5. proper nouns and URLs stay unflagged */
  await page.fill('#plain', 'Ping Sarah about Kubernetes at grafana.acme.io/x8f2 re INFRA-4471.');
  await page.waitForTimeout(1800);
  const noiseMarks = await page.locator('.graimmer-mark').count();
  record('names, URLs and identifiers produce no underlines',
    noiseMarks === 0, `expected 0 marks, got ${noiseMarks}`);

  /* --------------------------- 6. contenteditable is never written to */
  await page.click('#rich');
  await page.waitForTimeout(1500);
  const richHtml = await page.innerHTML('#rich');
  record('contenteditable markup is untouched by the overlay',
    !/graimmer/i.test(richHtml), `found extension markup inside the field: ${richHtml.slice(0, 120)}`);

  /* ------------------- 7. a range split by <b> merges into one underline */
  await page.click('#split');
  await page.waitForTimeout(1500);
  const splitMarks = await page.locator('.graimmer-mark').count();
  record('an issue split by inline markup draws one underline, not three',
    splitMarks === 1, `expected 1 mark, got ${splitMarks}`);

  /* --------------------------------- 8. data-gramm="false" is ignored */
  await page.click('#gramm');
  await page.waitForTimeout(1500);
  const grammMarks = await page.locator('.graimmer-mark').count();
  record('a field marked data-gramm="false" is still checked',
    grammMarks > 0, 'grAImmer disabled itself - Slack would show nothing');

  /* ------------------------------------------- 9. clicking applies a fix */
  await page.click('#plain');
  await page.fill('#plain', 'i dont think so.');
  await page.waitForTimeout(1500);
  await page.locator('.graimmer-mark').first().click();
  await page.waitForSelector('.graimmer-card', { timeout: 5000 });
  record('clicking an underline opens the suggestion card', true);

  await page.locator('.graimmer-card-fix').first().click();
  await page.waitForTimeout(900);
  const fixedValue = await page.inputValue('#plain');
  record('applying a suggestion edits the field',
    fixedValue !== 'i dont think so.', `value still "${fixedValue}"`);

  /* ------- 9b. applying a fix inside a contenteditable — the Gmail path */
  // The riskiest code in the project: DOM surgery inside someone else's
  // editor, plus caret restoration. The textarea path above shares none of it.
  await page.click('#rich');
  await page.evaluate(() => {
    const field = document.getElementById('rich');
    field.innerHTML = '<div>i dont think so</div>';
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(1600);

  const richBefore = await page.locator('#rich').innerText();
  await page.locator('.graimmer-mark').first().click();
  await page.waitForSelector('.graimmer-card', { timeout: 5000 });
  await page.locator('.graimmer-card-fix').first().click();
  await page.waitForTimeout(900);

  const richAfter = await page.locator('#rich').innerText();
  record('applying a fix edits a contenteditable',
    richAfter !== richBefore, `text unchanged: "${richAfter}"`);
  record('the fix lands as real text, not markup',
    !/graimmer|<span/i.test(await page.innerHTML('#rich')),
    'extension markup ended up inside the field');

  // The caret must survive the surgery, or typing after a fix jumps to the
  // start of the field.
  const caretOk = await page.evaluate(() => {
    const selection = window.getSelection();
    if (!selection.rangeCount) return false;
    return document.getElementById('rich').contains(selection.getRangeAt(0).startContainer);
  });
  record('the caret stays inside the field after a fix', caretOk,
    'selection was lost or moved outside the editor');

  /* ------------- 10. a field that is its own scroll container (Slack) */
  await page.click('#scroller');
  await page.waitForTimeout(1600);

  const scrollerBefore = await page.locator('.graimmer-mark').count();
  record('underlines appear in a scrolling field', scrollerBefore > 0,
    `expected >0 marks, got ${scrollerBefore}`);

  // Scroll the issue out of view. Its rectangles still exist and are still
  // reported by getClientRects, so anything not clipped would paint outside
  // the field - underlines floating over whatever sits above it.
  const strayMarks = await page.evaluate(async () => {
    const field = document.getElementById('scroller');
    field.scrollTop = 0;
    await new Promise((r) => setTimeout(r, 400));
    const box = field.getBoundingClientRect();
    return [...document.querySelectorAll('.graimmer-mark')]
      .map((m) => m.getBoundingClientRect())
      .filter((r) => r.height > 0)
      .filter((r) => r.bottom > box.bottom + 1 || r.top < box.top - 1)
      .length;
  });
  record('no underline is painted outside a scrolled field',
    strayMarks === 0, `${strayMarks} marks escaped the field bounds`);

  /* -------------------- a code editor is left alone by default */
  // Counted by overlap with the editor's own box rather than globally: the
  // previously focused field keeps its underlines by design, so a global
  // count would measure the wrong thing entirely.
  await page.click('#code');
  await page.waitForTimeout(1500);
  const codeMarks = await page.evaluate(() => {
    const box = document.getElementById('code').getBoundingClientRect();
    return [...document.querySelectorAll('.graimmer-mark')]
      .map((m) => m.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0)
      .filter((r) => r.left < box.right && r.right > box.left &&
                     r.top < box.bottom && r.bottom > box.top)
      .length;
  });
  record('a code editor is not checked', codeMarks === 0,
    `painted ${codeMarks} marks over a Monaco-style editor`);

  /* -------------------------- 11. the badge and panel (spec D2) work */
  await page.click('#plain');
  await page.fill('#plain', 'i dont think there is 3 items. your welcome to check the the logs.');
  await page.waitForTimeout(1800);

  const badgeText = await page.locator('.graimmer-badge').textContent();
  record('issue-count badge shows a count', /\d+ issue/.test(badgeText || ''), `badge read "${badgeText}"`);

  await page.locator('.graimmer-badge').click();
  await page.waitForSelector('.graimmer-panel:not([hidden])', { timeout: 5000 });
  const panelRows = await page.locator('.graimmer-panel-row').count();
  const markCount = await page.locator('.graimmer-mark').count();
  record('panel lists every issue', panelRows > 0 && panelRows <= markCount + 2,
    `${panelRows} rows for ${markCount} marks`);

  await page.locator('.graimmer-panel-row').first().click();
  await page.waitForSelector('.graimmer-card', { timeout: 5000 });
  record('selecting from the panel opens the card for that issue', true);
  await page.keyboard.press('Escape');

  /* --------- the badge must follow its field, not stick to the screen */
  const badgeStrays = await page.evaluate(async () => {
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 300));
    const field = document.getElementById('plain');
    // Put the field well above the viewport.
    field.scrollIntoView();
    window.scrollBy(0, 900);
    await new Promise((r) => setTimeout(r, 500));

    const badge = document.querySelector('.graimmer-badge');
    if (!badge || badge.hidden) return { verdict: 'hidden' };
    const b = badge.getBoundingClientRect();
    const f = field.getBoundingClientRect();
    // The badge is anchored to the field's bottom-right. If the field has
    // left the viewport, a badge still sitting in view is stranded over
    // unrelated content.
    const fieldVisible = f.bottom > 0 && f.top < window.innerHeight;
    const badgeVisible = b.bottom > 0 && b.top < window.innerHeight;
    return { verdict: !fieldVisible && badgeVisible ? 'stranded' : 'tracking' };
  });
  record('the issue badge does not strand itself when its field scrolls away',
    badgeStrays.verdict !== 'stranded',
    'badge stayed on screen after the field left it');
  await page.evaluate(() => window.scrollTo(0, 0));

  // Captured while the card is open, as a visual record of a passing run.
  await page.screenshot({ path: join(root, 'dist/extension-shot.png') });
  await page.keyboard.press('Escape');

  /* ---------- a field removed from the DOM must take its UI with it */
  // Gmail creates and destroys compose windows constantly. An overlay left
  // behind after its field is gone floats over unrelated page content and
  // accumulates one layer per compose window opened.
  const orphaned = await page.evaluate(async () => {
    const doomed = document.createElement('textarea');
    doomed.value = 'i dont think there is 3 items';
    document.body.appendChild(doomed);
    doomed.focus();
    await new Promise((r) => setTimeout(r, 1400));
    const painted = document.querySelectorAll('.graimmer-mark').length;

    doomed.remove();
    await new Promise((r) => setTimeout(r, 900));
    return {
      painted,
      layers: document.querySelectorAll('.graimmer-layer').length,
      marks: document.querySelectorAll('.graimmer-mark').length,
      badges: [...document.querySelectorAll('.graimmer-badge')].filter((b) => !b.hidden).length,
    };
  });
  record('a dynamically added field is checked', orphaned.painted > 0,
    `expected marks, got ${orphaned.painted}`);
  record('removing a field tears down its overlay and badge completely',
    orphaned.layers === 0 && orphaned.marks === 0 && orphaned.badges === 0,
    `after removal: ${orphaned.layers} layers, ${orphaned.marks} marks, ${orphaned.badges} badges left behind`);

  /* --------------------------------------- 11. the options page loads */
  const options = await context.newPage();
  const optionErrors = [];
  options.on('pageerror', (error) => optionErrors.push(String(error)));
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.waitForSelector('#checks .row', { timeout: 8000 });
  const rows = await options.locator('#checks .row').count();
  record('options page renders every check toggle', rows === 6, `${rows} rows`);
  record('options page has no errors', optionErrors.length === 0, optionErrors.join(' | '));

  await options.locator('#new-word').fill('Kubernetes');
  await options.locator('#add-word').click();
  await options.waitForTimeout(600);
  const chips = await options.locator('.word').count();
  record('a word can be added to the personal dictionary', chips >= 1, `${chips} chips`);
  await options.close();

  /* --------- the personal dictionary must actually suppress a flag */
  // Adding a word is only meaningful if it stops the underline. Storing it
  // and still flagging the word would be a feature that does nothing.
  await page.bringToFront();
  await page.click('#plain');
  await page.fill('#plain', 'The zzquux service is fine.');
  let beforeAdd = 0;
  try {
    await page.waitForSelector('.graimmer-mark[data-severity="spelling"]', { timeout: 15000 });
    beforeAdd = await page.locator('.graimmer-mark[data-severity="spelling"]').count();
  } catch { /* reported by the assertion below */ }
  record('an unknown word is flagged before it is added',
    beforeAdd >= 1, 'no spelling mark within 15s');

  const opts2 = await context.newPage();
  await opts2.goto(`chrome-extension://${extensionId}/options.html`);
  await opts2.waitForSelector('#new-word');
  await opts2.locator('#new-word').fill('zzquux');
  await opts2.locator('#add-word').click();
  await opts2.waitForTimeout(700);
  await opts2.close();

  await page.bringToFront();
  await page.fill('#plain', 'The zzquux service is still fine.');
  await page.waitForTimeout(2200);
  const afterAdd = await page.locator('.graimmer-mark[data-severity="spelling"]').count();
  record('adding a word to the dictionary stops it being flagged',
    afterAdd === 0, `still flagged ${afterAdd} spelling issues`);

  /* ------------------------- 12. the popup and per-site disable work */
  // Playwright cannot click a toolbar icon — that is an upstream browser
  // limitation, not a gap here — so the popup is opened by URL, which
  // exercises the same document and the same script.
  const popup = await context.newPage();
  const popupErrors = [];
  popup.on('pageerror', (error) => popupErrors.push(String(error)));
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.waitForSelector('#site', { timeout: 8000 });
  record('popup renders without errors', popupErrors.length === 0, popupErrors.join(' | '));

  // Turning a site off must actually stop the checker there, not merely
  // record a preference nothing reads.
  await popup.evaluate((target) => new Promise((done) => {
    chrome.runtime.sendMessage(
      { type: 'SAVE_SETTINGS', settings: { disabledOrigins: [target] } },
      () => done()
    );
  }), origin);
  await popup.waitForTimeout(500);

  await page.bringToFront();
  await page.reload();
  await page.click('#plain');
  await page.waitForTimeout(2000);
  const marksWhenDisabled = await page.locator('.graimmer-mark').count();
  record('disabling a site actually stops the checker there',
    marksWhenDisabled === 0, `still painted ${marksWhenDisabled} marks`);

  // And re-enabling brings it back, so the switch is not one-way.
  await popup.evaluate(() => new Promise((done) => {
    chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: { disabledOrigins: [] } }, () => done());
  }));
  await popup.waitForTimeout(500);
  await page.bringToFront();
  await page.reload();
  await page.click('#plain');
  await page.waitForTimeout(2000);
  const marksWhenReenabled = await page.locator('.graimmer-mark').count();
  record('re-enabling a site restores checking',
    marksWhenReenabled > 0, `expected marks, got ${marksWhenReenabled}`);
} finally {
  await context.close();
  server.close();
  rmSync(profileDir, { recursive: true, force: true });
}

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} end-to-end checks passing`);
process.exit(failed.length ? 1 : 0);
