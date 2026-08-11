# grAImmer — Specification

A browser extension that checks spelling and grammar in the text boxes you type into, using rules and word lists rather than AI.

**Status:** design in progress
**Last updated:** 2026-08-11

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

Chrome terminates idle background workers after ~30 seconds. A cold worker must reload and re-parse the dictionary, stalling the first check after any pause — the most likely way grAImmer feels broken.

**Mitigation:** the content script opens a long-lived port to the worker when an editable field is focused. An open port keeps the worker alive; closing the field lets it terminate. This is designed in, not bolted on.

Because rules run in the page (D15), a cold worker delays only spelling underlines. Grammar, apostrophe, capitalization and spacing underlines have already rendered.

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

## 8. Open

- Design sections still to be agreed: data flow, rule engine structure, failure modes, testing strategy
- Personal dictionary storage: synced across browsers vs local-only (privacy trade)

---

## Sources

- [Hanov — succinct tries](https://stevehanov.ca/blog/?id=120)
- [SymSpell](https://github.com/wolfgarbe/SymSpell)
- [Typo.js](https://github.com/cfinke/Typo.js/)
- [nspell](https://github.com/wooorm/nspell)
- [Grammarly privacy FAQ](https://support.grammarly.com/hc/en-us/articles/20916119474829-Privacy-and-security-FAQs)
- [LanguageTool local setup](https://docs.zettlr.com/en/guides/languagetool-local/)
