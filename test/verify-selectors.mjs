/**
 * Verifies every site profile's selectors against the markup those sites
 * actually ship.
 *
 * A selector typo is the most dangerous failure mode in this codebase: the
 * extension loads, attaches to nothing, reports no error, and looks exactly
 * like being broken. Nothing else in the suite would catch it — the engine
 * tests pass because the engine is fine, and the end-to-end tests pass
 * because they use a generic fixture.
 *
 * Runs in real Chromium because `matches()` needs a live DOM. Isolated
 * context, no profile, no network.
 */

import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Read the profiles from source rather than duplicating them here, so this
// test cannot drift from what ships.
const source = readFileSync(join(root, 'src/content/site-profiles.js'), 'utf8');
const module = await import(pathToFileURL(join(root, 'src/content/site-profiles.js')).href);
const { PROFILES, DEFAULT_PROFILE, profileForHost } = module;

const checks = [];
function record(name, pass, detail = '') {
  checks.push({ name, pass });
  console.log(`${pass ? '  ok  ' : '  FAIL'} ${name}${pass || !detail ? '' : `\n       -> ${detail}`}`);
}

/* ---------------------------------------- host matching, no DOM needed */

const HOSTS = [
  ['mail.google.com', 'gmail'],
  ['outlook.live.com', 'outlook'],
  ['outlook.office.com', 'outlook'],
  ['outlook.office365.com', 'outlook'],
  ['github.com', 'github'],
  ['app.slack.com', 'slack'],
  ['www.linkedin.com', 'linkedin'],
  ['example.com', 'default'],
  ['notgithub.com', 'default'],
  ['github.com.evil.example', 'default'],
];

for (const [host, expected] of HOSTS) {
  const actual = profileForHost(host).id;
  record(`host ${host} resolves to the ${expected} profile`,
    actual === expected, `got ${actual}`);
}

/* ------------------------------------------ selector matching, in a DOM */

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
await page.goto(pathToFileURL(join(root, 'test/fixtures/site-markup.html')).href);

const byId = (profile) => ({
  editable: profile.editableSelector,
  exclude: profile.excludeSelector || null,
});

for (const profile of [...PROFILES, DEFAULT_PROFILE]) {
  const selectors = byId(profile);

  const outcome = await page.evaluate(({ id, editable, exclude }) => {
    const scope = id === 'default' ? 'default' : id;
    const nodes = [...document.querySelectorAll(`[data-site="${scope}"]`)];
    return nodes.map((node) => {
      let matched;
      try {
        matched = node.matches(editable);
      } catch (error) {
        return { id: node.id, error: String(error) };
      }
      let excluded = false;
      if (exclude) {
        try { excluded = node.matches(exclude); }
        catch (error) { return { id: node.id, error: String(error) }; }
      }
      return {
        id: node.id,
        should: node.dataset.should === 'yes',
        attaches: matched && !excluded,
      };
    });
  }, { id: profile.id, ...selectors });

  const broken = outcome.filter((r) => r.error);
  if (broken.length) {
    record(`${profile.id}: selectors parse`, false,
      broken.map((b) => `${b.id}: ${b.error}`).join('; '));
    continue;
  }
  record(`${profile.id}: selectors parse`, true);

  for (const result of outcome) {
    record(
      `${profile.id}: ${result.should ? 'attaches to' : 'stays off'} #${result.id}`,
      result.attaches === result.should,
      result.should
        ? 'selector does not match the markup this site ships — the extension would do nothing here'
        : 'selector matches an element that is not a composer'
    );
  }
}

/* ---------------------------- the impossible list is honest about itself */

const docs = module.impossibleForHost('docs.google.com');
record('Google Docs is explicitly recorded as impossible', Boolean(docs),
  'it should be listed so the limitation is a decision, not a silent gap');
record('ordinary hosts are not marked impossible',
  module.impossibleForHost('example.com') === null);

/* ------------------------------- the data-gramm decision is deliberate */

record('the data-gramm decision is documented in source',
  /IGNORE_DATA_GRAMM_BY_DEFAULT/.test(source) && /Quill/.test(source),
  'this behaviour must never become an accident');

await context.close();
await browser.close();

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} selector checks passing`);
process.exit(failed.length ? 1 : 0);
