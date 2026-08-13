# grAImmer

Spelling and grammar checking as you type, in the text boxes you actually write in — email, tickets, comments. Rule-based and English only.

The name is a joke. **There is no AI in it.** Checking is done by pattern rules and a bundled dictionary, which is why nothing you type ever leaves the browser: no server, no API call, nothing to breach.

---

## Install

Not on the Chrome Web Store — load it unpacked.

```bash
npm install
npm run build          # produces dist/extension
```

Then in Chrome or Edge:

1. Go to `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → select `dist/extension`

Re-run `npm run build` and press reload on the extension card to pick up changes.

---

## What it catches

| Category | Example | Becomes |
|---|---|---|
| Spelling | I have **recieved** it | received |
| Confused words | Thanks for **your** patience → fine; **your** welcome | you're welcome |
| Missing apostrophes | I **dont** think so | don't |
| Capitalization | **i** will send it on **monday** | I … Monday |
| Spacing and repeats | Let me know **the the** date | the |
| Subject–verb agreement | **There is 3** items | There are 3 |

Two ways to fix things: click any underline for a suggestion card, or click the **issue-count badge** in the corner of the field to see every problem in one list before you send.

The toolbar icon turns grAImmer off for the site you are on — useful for a web IDE, an internal tool, or anywhere the underlines are noise.

**Confused word pairs matter most for email.** Every word in that category is spelled correctly, so no dictionary can catch them — they need patterns that read the surrounding words.

## What it will miss

Being straight about this up front, because it is a property of the approach rather than a gap to be closed later:

- *"The report which I sent it yesterday"*
- *"He walk to the office every day"*
- *"I am agree with you"*
- *"Discuss about the plan"*

These need to know each word's part of speech and the sentence's structure. Individual rules can be written for specific cases, but they cannot be enumerated. Subject–verb agreement is included but deliberately narrow, and is labelled as such in the settings.

---

## What it stays quiet about

A dictionary alone would wreck a real email — a typical reply produces around eleven flags of which one is a genuine mistake. Six skip rules run *before* any checking and remove text from consideration entirely:

- URLs, email addresses and file paths
- ALL-CAPS words and identifiers (`API`, `INFRA-4471`, `snake_case`)
- Quoted reply history — you cannot fix someone else's typo
- Your signature block
- Capitalized words mid-sentence, treated as names
- Code blocks and inline code

**Code editors are skipped entirely.** Monaco, CodeMirror and Ace all present as ordinary editable fields, and prose rules are simply wrong in source — so a web IDE would light up from top to bottom.

The capitalized-word rule is a real trade: a typo inside a capitalized word (`Micorsoft`) will slip through. In an inbox full of client and colleague names, that is worth it. It is a setting.

**"Add to dictionary" is different from skipping.** An added word becomes *correct*, so `Grafana` stops being flagged while `Graffana` is still caught and can be corrected to it.

---

## Sites

| | Site | Status |
|---|---|---|
| **Tier 1** | Gmail, Outlook web, GitHub | must work — release blocking |
| **Tier 2** | LinkedIn, Slack | verified, known issues documented rather than blocking |
| | everything else | best effort on any editable field |

**Google Docs cannot be supported.** It paints text to a `<canvas>`, so there are no text nodes for any extension to read. This is a limitation of Docs.

**Slack asks extensions not to run.** Its editor (Quill) sets `data-gramm="false"` automatically, and Slack ships it unmodified. grAImmer ignores that flag, deliberately: it exists to stop extensions writing *into* the editor, and grAImmer never does — underlines are painted on a separate layer and the field's DOM is never touched. The reasoning is in `src/content/site-profiles.js` and stated in plain English on the options page.

---

## Development

```bash
npm test                # 63 unit     - rules, skip rules, offsets, geometry, perf
npm run test:selectors  # 32 selector - profiles vs the markup each site ships
npm run test:harness    # 12 harness  - the engine in real Chromium
npm run test:e2e        # 30 e2e      - the built extension in a throwaway profile
npm run test:all        # all four (137 checks)
```

The selector suite exists because a typo there is the most dangerous failure in the codebase: the extension loads, attaches to nothing, reports no error, and looks exactly like being broken. Nothing else would catch it.

### The test bench

`npm run test:harness` builds `dist/harness.html` — a single self-contained page with a textarea and a contenteditable side by side, running the real engine. It shows the live pipeline (which tokens were dropped, by which skip rule) and the whole test suite in the same view, so a regression is visible next to the behaviour that caused it.

It is **generated from `src/core`**, never hand-copied. A duplicated harness drifts from source within a day and then proves nothing.

### Layout of the code

```
src/core/          pure - no DOM, no browser APIs, no site knowledge
  tokenizer.js       text -> tokens with absolute offsets, sentence splitting
  skip-rules.js      the six skip rules
  rules.js           check rules, one function per category
  engine.js          composes the pipeline
  overlay-geometry.js  rect maths, kept pure so it can be tested at all

src/content/       runs in the page
  adapters/          plain (textarea) and rich (contenteditable)
  overlay.js         the only code that paints
  card.js            the suggestion popup
  site-profiles.js   every per-site fact in the codebase
  badge.js           issue count and pre-send panel
  spell-client.js    result cache + messaging

src/background/    one instance, all tabs
  dictionary-service.js   check(word) / suggest(word) - the swappable one
  storage.js              personal dictionary and settings

src/ui/            popup.html (per-site) and options.html (everything)
```

Two seams are deliberate. `dictionary-service` exposes only `check` and `suggest`, so swapping nspell for a succinct trie later touches one file. `field-adapter` exposes `getText` / `getBoxes` / `replaceRange`, so every site is one of two implementations plus a quirks profile.

### What the tests cannot cover

Stated explicitly rather than implied by silence:

- **jsdom has no layout engine.** `getClientRects()` returns nothing there and throws on a `Range`, so overlay positioning cannot be unit-tested. That is why the rect maths is a pure function fed hand-written rectangles, and why obtaining rectangles is checked in real Chromium.
- **Real Gmail and Outlook are manual QA.** Nobody automates this — the sites serve different markup to different sessions. CI runs against synthetic fixtures that reproduce the *structural properties* of those editors (a range split by inline markup, a field that is its own scroll container), not captures of their markup.
- **Service worker suspension** is not simulated. The design assumes it and tolerates it, but the tolerance is by construction rather than by test.

---

## Design

`spec.md` carries every decision with its reasoning, including the ones that were reversed. Notably:

- The keep-alive port was removed after finding that [Harper](https://github.com/Automattic/harper) ships without one, and that re-parsing the dictionary (~104 ms) beats rehydrating a persisted structure (~170 ms).
- `Intl.Segmenter` cannot be used for sentence splitting: UAX #29 forbids breaking before a lowercase letter after a period, which is exactly the error the capitalization rule detects.

---

## Licence

Dictionary: SCOWL / Hunspell en-US, redistributed under its own licence in `dist/extension/dictionaries/LICENSE`.
