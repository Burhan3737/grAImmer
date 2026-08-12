# grAImmer — Specification

A browser extension that checks spelling and grammar in the text boxes you type into, using rules and word lists rather than AI.

**Status:** Phase 1 built. All automated checks passing; real-site behaviour still needs manual QA (see §9).
**Last updated:** 2026-08-13

---

## 1. Purpose

Catch spelling and grammar mistakes while writing emails and other text on the web, before sending. English only. No AI, no network calls — all checking happens locally from rules and a bundled dictionary.

The name is a joke. There is deliberately no AI in Phase 1.

---

## 2. Decisions

Every decision below was made explicitly during design. The "why" column is the reasoning at the time, kept so the decision can be revisited on its merits rather than re-argued from scratch.

| # | Decision | Choice | Why |
|---|---|---|---|
| D1 | What gets checked | Editable fields only, live as you type | Where emails live, and the only place a fix can actually be applied — you can't correct someone else's published article. Whole-page scanning reuses the same engine later. |
| D2 | How mistakes surface | Inline squiggles **and** a floating issue-count badge that opens a panel | Fix where your eyes already are, with a pre-send overview available. |
| D3 | Check categories | Spelling, confused word pairs, missing apostrophes, capitalization, doubles/spacing/punctuation, limited subject–verb agreement | These are reliably detectable with rules. |
| D4 | Style and wordiness | **Deferred to Phase 2** | Style suggestions are opinions, not errors. Noise in a fast email, and the quickest route to disabling the extension. |
| D5 | Field types | Plain fields **and** contenteditable, generic support everywhere, with a named tested shortlist | Gmail and Outlook are both contenteditable, so supporting only plain fields would miss the primary use case. |
| D6 | Site shortlist | **Tier 1 (blocking):** Gmail, Outlook web, GitHub. **Tier 2 (verified, fixed if cheap):** LinkedIn, Slack. Everything else: best effort | Two different rich editors prove the approach generalises; one plain-textarea site isolates rule-engine bugs from overlay bugs. Tiering keeps all five in scope without letting any one stall the release. |
| D7 | Google Docs | **Explicitly out of scope — not technically possible** | Google Docs paints text to `<canvas>`. There are no text nodes to read or measure. No extension can reach the content. |
| D8 | Dictionary size | ~120k words (SCOWL / Hunspell en-US) | 50k flags ordinary professional vocabulary and is unusable. The extra 250k in a 370k list is archaic and specialist forms that don't appear in email. |
| D9 | Spelling engine | **nspell or Typo.js** (Hunspell-compatible library) | Ships faster and is less to get wrong than a hand-built encoder. Affix rules and dictionary parsing come free. |
| D10 | Dictionary location | Background service worker, **not** per tab | A plain word list costs 10–15 MB in memory. Grammarly, LanguageTool and Typo.js all keep the engine out of the page — three independent implementations converging. |
| D11 | Suggestion generation | Generate edit-distance 1–2 candidates, keep the ones the dictionary confirms, rank by frequency | Zero extra storage. Only runs when a squiggle is clicked, so tens of milliseconds is imperceptible. SymSpell's speed solves a problem we don't have. |
| D12 | Skip rules | All six: URLs/emails/paths, ALL-CAPS and identifiers, quoted reply history, signature blocks, capitalized words mid-sentence, code blocks | Without these a real email reply produces ~11 flags of which one is a genuine mistake. |
| D13 | Browser target | Chrome + Edge | Both Chromium, both run the same MV3 package unmodified. Firefox is a genuine third target (`browser.*` vs `chrome.*`, different background lifetime) and isn't worth it yet. |
| D14 | Distribution | Load unpacked (developer mode) | No store fee, no review delay, no justifying `<all_urls>` to reviewers while the design is still moving. Build artifact is identical either way, so publishing later costs nothing. |
| D15 | Work split | Rules run in the content script; dictionary lives in the background worker | Categories 2–6 are small pattern tables that run instantly with no messaging. Only unknown words cross the process boundary, and answers are cached. |
| D16 | Service worker keep-alive | **No keep-alive port. Re-initialise the dictionary on every wake.** Cache results in the content script instead | **Revises the original design.** Harper (Automattic) ships exactly this — a local MV3 grammar checker whose 769 KB dictionary is re-instantiated on every wake, with no keepalive and plain `sendMessage`. Measured: re-parsing costs ~104 ms, while rehydrating a persisted structure costs ~170 ms, so persistence is a net loss. A result cache in the content script removes the round-trip entirely for most keystrokes, which is a better lever than anything on the worker side. |
| D17 | Offscreen document | Rejected | Nobody uses it as a persistent heap. uBOL uses it as transient compute and closes it immediately; Bitwarden tried it for CPU-bound work and reverted over decryption errors. Chrome's migration guide reserves the right to act against indefinite lifetime extension. |
| D18 | Sentence segmentation | Hand-written guarded matcher with an abbreviation list — **not `Intl.Segmenter`** | UAX #29 rule SB8 forbids breaking before a lowercase letter after a period. But "this sentence starts lowercase" is precisely the error our capitalization rule exists to catch, so the platform API is structurally unable to help. Measured on our own rule set: `Intl.Segmenter` caught 2 of 8 real errors; the guarded matcher caught 7–8 of 8 while silencing every trap. Verified identical in Chrome 151, Edge 151 and Node 22. |
| D19 | Testing stack | Vitest for pure logic, Playwright for browser truth, local fixture pages for site behaviour | jsdom has no layout engine, so `getClientRects()` returns nothing and overlay positioning cannot be unit-tested at all. Real Gmail in CI is not done by anyone — Harper, Refined GitHub and Dark Reader all abandoned or never attempted it. |

---

## 3. What it checks

### 3.1 Check rules — produce underlines

| Category | Examples caught | Method |
|---|---|---|
| Spelling | `recieved`, `documnt`, `sesnt` | Dictionary lookup; suggestions by edit distance |
| Confused word pairs | `you're patience`, `want too discuss`, `there proposal` | Context patterns — these words are all correctly spelled, so a dictionary cannot help |
| Missing apostrophes | `dont`, `cant`, `wont`, `im`, `ive` | Lookup table |
| Capitalization | sentence starts, standalone `i`, weekdays, months | Pattern rules, with care around abbreviations (`e.g.`, `Dr.`) |
| Doubles, spacing, punctuation | `the the`, space before comma, missing space after period | Regex |
| Subject–verb agreement | `There is three items`, `He have replied` | **Deliberately narrow.** Hardcoded shapes only |

Confused word pairs are the highest-value category for email: those mistakes are invisible to a spellchecker and common in fast writing.

### 3.2 Skip rules — remove text from consideration

Skip rules are **not** checks. They run first, and anything they remove is invisible to every check that follows.

1. URLs, email addresses, file paths
2. ALL-CAPS tokens, identifiers, anything containing digits or underscores
3. Quoted reply history (`>` blocks, Gmail's collapsed quote)
4. Signature blocks
5. Capitalized words mid-sentence — treated as proper nouns
6. Code blocks and inline code

Skip rules beat everything because they are first. Rule 5 means a typo inside a capitalized word (`Micorsoft`) will not be caught — an accepted trade for silence about every client and colleague name.

### 3.3 Personal dictionary

Distinct from both. Adding a word makes it **correct**, rather than skipped — so `Graffana` is still flagged and can be corrected *to* `Grafana`.

Also required: ignore-once, a manage-list view, and per-site rule overrides (capitalization off in Slack, on in Gmail).

---

## 4. Known limits

Stated plainly so expectations are set before building.

Rules handle reliably: `recieved` → received · `your welcome` → you're welcome · `the the` → the · `dont` → don't · `i think` → I think · `There is 3 files` → There are

Rules will miss: *"The report which I sent it yesterday"* · *"He walk to the office every day"* · *"I am agree with you"* · *"Discuss about the plan"*

These require knowing each word's part of speech and sentence structure. Individual rules can be written for specific cases, but they cannot be enumerated.

---

## 5. Architecture

### 5.1 Component map

**Content script — runs in the page**

*Edge — adapters. All site-specific behaviour lives here.*
- `field-detector` — finds editable fields, attaches and detaches
- `field-adapter` — plain and contenteditable variants: `getText()`, `offsetToRect()`, `replaceRange()`
- `site-profiles` — per-site quirks and rule overrides

*Core — pure. No DOM, no browser APIs, no site knowledge.*
- `tokenizer` — text to tokens with offsets
- `skip-filter` — the six skip rules
- `rule-engine` — check categories 2–6
- `issue-set` — merge, dedupe, sort by offset

Contract: `check(text, settings) → Issue[]`. Unit-testable with no browser.

*Edge — rendering. The only code that touches the screen.*
- `overlay` — measures and paints underlines
- `suggestion-card` — popup on click
- `badge-panel` — issue count and list
- `spell-client` — port to worker, plus word cache

**Background worker — one instance, all tabs**
- `dictionary-service` — `check(word)`, `suggest(word)`
- `personal-dictionary` — added words, in extension storage
- `settings` — rule toggles, per-site config

### 5.2 The two swap seams

`dictionary-service` exposes exactly `check(word)` and `suggest(word)`. That two-function contract makes the nspell → succinct-trie upgrade (§7) a contained change.

`field-adapter` exposes `getText()`, `offsetToRect()`, `replaceRange()`. Every supported site is either plain or contenteditable, plus a quirks profile.

### 5.3 Rendering

grAImmer never writes into your email. Underlines are painted on a transparent, click-through layer positioned above the field by measuring live text on screen. Sent messages are byte-for-byte what you typed.

Consequence: scrolling, typing and resizing all invalidate the measured coordinates, requiring re-measurement.

### 5.4 The MV3 service worker constraint

Chrome terminates idle background workers after ~30 seconds. A cold worker must reload and re-parse the dictionary, stalling the first check after any pause.

**This section originally proposed a long-lived keep-alive port. That was wrong, and research into shipping precedent corrected it.**

[Harper](https://github.com/Automattic/harper) is the closest existing analogue — a local, no-network grammar checker in MV3. Its production architecture uses no keepalive and no long-lived port, just plain `sendMessage`, and re-instantiates its 769 KB dictionary on every wake. Two measurements explain why that is fine:

- Re-parsing the dictionary costs ~104 ms.
- Rehydrating a persisted structure costs ~170 ms — *slower* than re-parsing, so caching preprocessed data is a net loss.

**The actual mitigation is a result cache in the content script.** Harper caches lint results per element and batches identical requests. With a cache in the page, the worker's lifecycle stops mattering for the overwhelming majority of keystrokes, because most words never need to cross the boundary at all. This is a better lever than anything applied to the worker itself.

Because rules run in the page (D15), a cold worker delays only spelling underlines. Grammar, apostrophe, capitalization and spacing underlines have already rendered.

**Two hard constraints discovered alongside this**, both of which remove options that might otherwise be assumed available:

- An MV3 service worker **cannot spawn a Web Worker**, so dictionary initialisation cannot be moved off the worker's event loop.
- WASM cannot be loaded from a blob or base64 URL under MV3's security requirements; it must be a bundled file.

### 5.5 Sentence segmentation

Segmentation is not a detail — the capitalization rule depends entirely on knowing where sentences begin.

The platform's `Intl.Segmenter` cannot be used, for a reason worth recording so it is not "rediscovered" later as an optimisation. UAX #29 rule SB8 forbids a break before a lowercase letter following a period; that is how ICU handles abbreviations. But *"sentence begins with a lowercase letter"* is exactly the error being detected, so the API is structurally blind to the case that matters. There is no escape hatch: locale suppression keys are silently dropped.

Measured against our own rule set — 8 real errors, 14 traps:

| Approach | Caught | Notes |
|---|---|---|
| `Intl.Segmenter` | 2/8 | never breaks before lowercase |
| `sbd` (2.4 KB, MIT) | 8/8 | 3 false positives |
| `compromise/one` (34.6 KB, MIT) | 8/8 | 1 false positive |
| **Guarded matcher (ours)** | **7/8** | **0 false positives** |

A narrow matcher wins on precision because it can encode "only fire where it matters". `sbd` remains a legitimate fallback if maintaining the abbreviation list becomes a burden.

**Licence note:** LanguageTool's segmentation rules (SRX) are LGPL-2.1 and CoreNLP is GPL-3.0 — borrow the design, never the file. pySBD's 227-entry abbreviation list is MIT and safe to use.

### 5.6 Testing strategy

Split at the layout seam, because that is where the tooling genuinely changes.

| Layer | Tool | Covers |
|---|---|---|
| Pure logic | Vitest (node env) | tokenizer, skip rules, check rules, offset maths — the bulk |
| Rect → overlay transform | Vitest with hand-written `DOMRect` fixtures | positioning maths, no browser needed |
| Layout and interaction | Playwright, real Chromium | that rects are obtained at all, clicks land, fixes apply |
| Site behaviour | Playwright against locally-served snapshot fixtures | per-site DOM quirks |
| Real Gmail / Outlook | **Manual QA only** | no automation exists for this |

Non-obvious findings that shape the above:

- **jsdom has no layout engine.** `getClientRects()` returns nothing on elements and *throws* on `Range`. Worse, `contentEditable` and `isContentEditable` are undefined there, so any branch on them misbehaves. Editability must be detected through an injectable predicate that tests can stub.
- **Extracting the rect → overlay-coordinate transform as a pure function is the highest-leverage refactor available.** Without it, testing overlay positioning means mocking `getClientRects` and then asserting on your own mock, which proves nothing.
- **Playwright's default headless mode cannot load extensions.** The default `chromium-headless-shell` has no extension support; extension tests need full Chromium, and Harper runs headed under a virtual display in CI for exactly this reason.
- **Playwright cannot click the toolbar icon** or test a real anchored popup — both are upstream browser limitations. Navigate directly to `chrome-extension://<id>/popup.html` instead.
- **Nobody tests against live Gmail in CI.** Harper commits local snapshot fixtures and serves them over localhost; for Google Docs it went further and *reimplemented the mechanism* in ~40 lines of synthetic DOM rather than snapshotting. Refined GitHub built live-selector regression tests properly and then disabled them, because the site served different HTML to CI runners. Grammarly ships a public known-issues page instead.
- **Any committed snapshot of a logged-in page must be censored.** InboxSDK treats this as mandatory. Prefer non-authenticated pages as fixtures.

---

## 6. Privacy

No text leaves the browser. Dictionary in the background worker, rules in the content script, personal word list in extension storage. No server, no API call, nothing to breach.

This is a direct consequence of the no-AI decision and is a genuine advantage over cloud-based checkers, which transmit your text for analysis.

---

## 7. Deferred

Recorded with reasoning so the work isn't re-derived later.

**Succinct trie dictionary.** Replaces nspell (D9). Measured: 80k words compress from 611 KB to 216 KB (132 KB gzipped); lookup is O(word length), independent of dictionary size. Critically, it is **queried in place with no decode step** — which suits MV3's constant worker restarts far better than a structure that must be parsed on every wake. Estimated ~300 KB for a 120k list. Swaps behind the `dictionary-service` contract (§5.2).

**Whole-page scanning.** On-demand scan of read-only page text (D1). Reuses the same rule engine; needs a separate rendering path.

**Style and wordiness checks.** D4.

**Firefox support.** D13.

**Chrome Web Store publishing.** D14.

---

## 9. Current state

Built and passing: **61 unit + 12 harness + 16 end-to-end = 89 automated checks.**

| Decision | Built? | Notes |
|---|---|---|
| D1 live in editable fields | yes | attaches on focus |
| D2 squiggles + badge + panel | yes | badge shows a count, panel lists all issues |
| D3 check categories 1–6 | yes | all six, including spelling |
| D5/D6 field types and site tiers | yes | profiles for all five named sites |
| D8/D9 dictionary | yes | nspell + Hunspell en-US, ~91 ms init |
| D12 six skip rules | yes | all six, individually toggleable |
| D13 Chrome + Edge | Chrome verified | Edge is the same MV3 package but has not been loaded |
| D14 load unpacked | yes | `npm run build` → `dist/extension` |
| D16 no keep-alive | yes | plus the content-script result cache |
| Personal dictionary | yes | add, remove, manage; synced, chunked for the 8 KB quota |

**Four bugs were caught by tests during the build**, each of which would otherwise have shipped:

1. Periods inside `3.5` and `grafana.acme.io` split sentences, so the next word was flagged as an uncapitalized sentence start.
2. The proper-noun skip suppressed *spacing* errors — which produced the purpose-scoped `excludeReasons` mechanism.
3. The mirror layer sat below the textarea, so the textarea intercepted every click and no squiggle was clickable. Identical appearance, entirely broken interaction.
4. The card focused its own first suggestion, firing `focusout` on the field, whose handler closed the card. It dismissed itself.

**Not verified, and cannot be automated** — the manual QA checklist is in `docs/TEST-CASES.md`:

- Real Gmail, Outlook, Slack and LinkedIn behaviour
- That an applied fix survives into a genuinely sent email
- Caret restoration inside a real rich editor
- Service worker suspension in practice
- Whether underlines sit pleasantly at every font size and zoom level

## 8. Open

- Personal dictionary storage: synced across browsers vs local-only (privacy trade)
- Whether to expand the abbreviation list to pySBD's full 227 entries, or keep the current curated set and add entries as real misfires appear
- Whether to classify abbreviations by following context (normally-lowercase / titles / numbers-only / always-internal), a design CoreNLP and pragmatic_segmenter arrived at independently

---

## Sources

**Dictionary and suggestions**
- [Hanov — succinct tries](https://stevehanov.ca/blog/?id=120) — 80k words, 611 KB → 216 KB
- [SymSpell](https://github.com/wolfgarbe/SymSpell)
- [Typo.js](https://github.com/cfinke/Typo.js/) — built for Chrome extensions, loads in the background page
- [nspell](https://github.com/wooorm/nspell)

**Shipping precedent**
- [Harper](https://github.com/Automattic/harper) — the closest existing analogue; source of D16, D19 and the fixture strategy
- [Grammarly privacy FAQ](https://support.grammarly.com/hc/en-us/articles/20916119474829-Privacy-and-security-FAQs) — cloud processing, the model we are not following
- [Grammarly known issues](https://support.grammarly.com/hc/en-us/articles/360041953832-Known-issues-on-websites) — what shipping without site automation looks like
- [LanguageTool local setup](https://docs.zettlr.com/en/guides/languagetool-local/)
- [InboxSDK](https://github.com/InboxSDK/InboxSDK) — Gmail ships rolling per-user DOM versions; censor any captured HTML

**Segmentation**
- [UAX #29](https://unicode.org/reports/tr29/) — rule SB8, and its own admission that it cannot handle "Mr. Jones"
- [pySBD](https://github.com/nipunsadvilkar/pySBD) — MIT, 227 abbreviations
- [sbd](https://www.npmjs.com/package/sbd) — MIT, 2.4 KB gzip, the fallback if the matcher becomes a burden

**Extension platform and testing**
- [Chrome — end-to-end testing extensions](https://developer.chrome.com/docs/extensions/how-to/test/end-to-end-testing)
- [Chrome — headless shell](https://developer.chrome.com/blog/chrome-headless-shell) — why default headless cannot load extensions
- [Puppeteer — Chrome extensions](https://pptr.dev/guides/chrome-extensions) — first-class `enableExtensions` API
- [Playwright — browsers](https://playwright.dev/docs/browsers)
- [jsdom — unimplemented parts of the web platform](https://github.com/jsdom/jsdom#unimplemented-parts-of-the-web-platform) — no layout engine
- [Vitest 4 announcement](https://voidzero.dev/posts/announcing-vitest-4) — Browser Mode stable
- [eyeo — testing MV3 service worker suspension](https://developer.chrome.com/blog/eyeos-journey-to-testing-mv3-service%20worker-suspension)
