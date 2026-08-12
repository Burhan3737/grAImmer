# Test cases

Every case in the suite, what it pins down, and — at the end — what is deliberately not covered.

Run with `npm run test:all`. Totals as of the current commit: **61 unit + 12 harness + 13 end-to-end = 86**.

---

## The two kinds of case, and why the second matters more

```
expect      these issues MUST be found          recall
expectNone  this text must produce NO issue     precision
```

Any pattern can be widened to catch more. The work is catching more *without becoming noise*, because a missed mistake is invisible while a false alarm is in your face and trains you to ignore the underline. **Every time a rule is widened, add the precision case that pins down how far it may go.**

Two real bugs were caught by precision cases during development, both of which would have shipped:

- Periods inside `3.5` and `grafana.acme.io` were splitting sentences, so the following word was flagged as an uncapitalized sentence start.
- The proper-noun skip was suppressing *spacing* errors. Skipping `Thanks` is about not spell-checking a name; it should never have blinded the checker to the missing space in `confirm.Thanks`. This produced the `excludeReasons` mechanism — skip reasons are purpose-scoped, not global.

---

## Unit — tokenizer (6)

| id | pins down |
|---|---|
| `tok-offsets` | token offsets index back into the source string exactly |
| `tok-url-single` | a URL is one token, not nine |
| `tok-email-single` | an email address is one token |
| `tok-abbrev-not-sentence` | `Dr.` does not end a sentence |
| `tok-eg-not-sentence` | `e.g.` does not end a sentence |
| `tok-newline-sentence` | a line break ends a sentence even without punctuation — email is full of unpunctuated lines |

## Unit — skip rules (9)

| id | pins down |
|---|---|
| `skip-url` | URLs are never spell-checked |
| `skip-identifier` | identifiers containing digits are skipped |
| `skip-allcaps` | ALL-CAPS acronyms are skipped |
| `skip-proper-noun` | capitalized words mid-sentence are treated as names |
| `skip-quoted` | quoted reply history is not checked |
| `skip-attribution` | everything after `... wrote:` is quoted history |
| `skip-signature` | the signature block is not checked |
| `skip-code` | inline code is not checked |
| `skip-sentence-start-still-checked` | the proper-noun skip does not hide a lowercase weekday |

## Unit — apostrophes (3)

| id | pins down |
|---|---|
| `apos-dont` | `dont` → `don't` |
| `apos-case` | capitalization is preserved in the suggestion |
| `apos-not-ambiguous-words` | **precision** — `well`, `were`, `ill` are real words and must never be flagged |

## Unit — confused words (9)

| id | pins down |
|---|---|
| `conf-your-welcome` | `your welcome` → `you're welcome` |
| `conf-your-possessive-ok` | **precision** — legitimate possessive `your` is silent |
| `conf-its-a` | `its a` → `it's a` |
| `conf-its-possessive-ok` | **precision** — possessive `its` is correct and stays silent |
| `conf-to-many` | `to many` → `too many` |
| `conf-to-infinitive-ok` | **precision** — infinitive `to` is silent |
| `conf-more-then` | `more then` → `more than` |
| `conf-then-time-ok` | **precision** — temporal `then` is silent |
| `conf-their-is` | `their is` → `there is` |

## Unit — agreement (4)

| id | pins down |
|---|---|
| `agr-there-is-number` | `there is 3` → `there are 3` |
| `agr-there-is-singular-ok` | **precision** — singular `there is` is correct |
| `agr-he-have` | `he have` → `he has` |
| `agr-they-have-ok` | **precision** — plural `they have` is correct |

## Unit — capitalization (5)

| id | pins down |
|---|---|
| `cap-standalone-i` | standalone `i` → `I` |
| `cap-ie-not-flagged` | **precision** — the `i` in `i.e.` is not the pronoun |
| `cap-sentence-start` | sentences start with a capital |
| `cap-weekday` | weekdays are capitalized |
| `cap-may-not-flagged` | **precision** — `may` as an ordinary verb is not treated as a month |

## Unit — mechanics (6)

| id | pins down |
|---|---|
| `mech-repeated` | repeated word is caught |
| `mech-space-before-comma` | space before a comma is removed |
| `mech-missing-space` | missing space after a full stop |
| `mech-decimal-ok` | **precision** — decimals are not "missing space" errors |
| `mech-double-space` | doubled space inside a line |
| `mech-ellipsis-ok` | **precision** — a three-dot ellipsis is deliberate |

## Unit — integration (2)

| id | pins down |
|---|---|
| `int-clean-email` | a realistic clean email produces **zero** flags |
| `int-noisy-email` | all six rule types fire, and the quoted line stays silent |

## Unit — geometry (17)

Hand-written rectangles. These are the cases that are painful to reproduce in a browser but trivial to state as numbers.

| id | pins down |
|---|---|
| `geo-drop-empty` | zero-width rects from collapsed ranges are dropped |
| `geo-merge-fragments` | a range fragmented by `<b>` merges into ONE underline |
| `geo-keep-lines-separate` | a phrase wrapping across lines stays two underlines |
| `geo-gap-not-merged` | rects on one line with a real gap are not joined |
| `geo-merge-order` | out-of-order rects still merge correctly |
| `geo-clip-above` | text scrolled above the field is not painted |
| `geo-clip-partial` | a half-visible line is clipped, not dropped |
| `geo-clip-inside` | a fully visible box is unchanged |
| `geo-relative-coords` | boxes are relative to the container, not the viewport |
| `geo-scrolled-out-dropped` | an issue scrolled out of a field produces no box |
| `geo-slivers-ignored` | sub-pixel slivers are not drawn |
| `geo-no-clip-option` | clipping is optional for non-scrolling fields |
| `card-below-by-default` | the card sits below the word when there is room |
| `card-flips-above` | near the bottom edge it flips above |
| `card-no-room-either-way` | in a short viewport it stays on screen |
| `card-clamped-right` | a word near the right edge does not push it off screen |
| `card-clamped-left` | it never goes off the left edge |

---

## Harness — real Chromium (12)

`npm run test:harness`. Isolated browser context, no profile, no cookies.

1. page loads with no JavaScript errors
2. the 44-case engine suite reports 44/44 **in the browser**, not just in Node
3. textarea overlay draws underlines
4. contenteditable overlay measures **non-zero** rectangles — zero-size means offset mapping silently failed
5. contenteditable content is not modified by the overlay
6. clicking a squiggle opens the suggestion card
7. applying a fix changes the field text
8. the applied text contains the suggestion
9. the field re-checks after a fix
10. turning off a skip rule lets more tokens through
11. turning off the quoted-history skip surfaces more issues
12. dark theme body contrast ≥ 7:1

**Check 6 caught a bug that unit tests structurally cannot:** the mirror layer sat *below* the textarea, so the textarea intercepted every click and no squiggle was ever clickable. Identical appearance, completely broken interaction.

---

## End-to-end — the loaded extension (13)

`npm run test:e2e`. Throwaway Chrome profile under the OS temp directory, deleted afterwards. Full Chromium, because the default headless shell cannot load extensions at all. Fixture served from `127.0.0.1`.

1. background service worker registers
2. content script attaches and paints on a textarea
3. no page errors from the content script
4. **spelling underlines arrive from the background worker** — the full round trip
5. names, URLs and identifiers produce **no** underlines
6. contenteditable markup is untouched by the overlay
7. an issue split by inline markup draws one underline, not three
8. a field marked `data-gramm="false"` is still checked
9. clicking an underline opens the suggestion card
10. applying a suggestion edits the field
11. options page renders every check toggle
12. options page has no errors
13. a word can be added to the personal dictionary

**Check 9 caught a second bug:** the card focuses its first suggestion for keyboard access, which fired `focusout` on the field, whose handler closed the card. It dismissed itself in the tick it opened.

**Check 8 is a product decision, not a technical one.** Slack's editor sets `data-gramm="false"` automatically. If grAImmer honoured it, it would silently show nothing on Slack. The test exists so that behaviour can never change by accident.

### The fixtures are synthetic, on purpose

`test/fixtures/compose.html` reproduces the *structural properties* of real editors — a range split by inline markup, a field that is its own scroll container, a `data-gramm` attribute — rather than capturing their markup. Harper reached the same conclusion for Google Docs and reimplemented the mechanism instead of snapshotting it. A generated fixture carries no PII, no copyright question, and cannot go stale when the real site redeploys.

---

## Not covered — must be verified by hand

Listed explicitly, because silence here would read as coverage.

| Gap | Why it cannot be automated |
|---|---|
| **Real Gmail / Outlook / Slack / LinkedIn** | These serve different markup to different sessions and require authentication. Refined GitHub built live-selector tests properly and then disabled them because CI runners received different HTML. Grammarly ships a public known-issues page instead. |
| **Service worker suspension** | The design tolerates it by construction (no keep-alive, cache in the page), but the tolerance is not exercised by a test. Chrome exposes no API to force suspension; eyeo resorted to clicking a button in `chrome://serviceworker-internals`. |
| **Toolbar icon and anchored popup** | Upstream browser limitation in every automation tool. Options pages are reachable directly by URL; the toolbar is not. |
| **Caret restoration inside a real rich editor** | Verified against the fixture. Gmail and Outlook run their own selection managers on top, and only hand testing shows whether the caret lands where the user expects. |
| **Visual correctness of underline placement** | The tests assert rectangles are non-zero and correctly merged. Whether the line sits pleasantly under the text at every font and zoom level is a judgement, not an assertion. |

### Manual QA checklist before any release

Run in Chrome with the extension loaded unpacked:

1. **Gmail** — compose, type `i dont think there is 3 items`, confirm four underlines and that clicking each applies cleanly. Reply to a thread and confirm the quoted history below is untouched.
2. **Gmail** — apply a fix, then send to yourself. Confirm the correction is present in the received mail (this is what catches a missing `input` event).
3. **Outlook web** — as above. Watch for underlines surviving after the editor reflows a block.
4. **GitHub** — a PR comment box, and one that grows as you type.
5. **Slack** — confirm underlines appear at all (this is the `data-gramm` decision), and that mention chips and emoji are not corrupted by applying a fix near them.
6. **LinkedIn** — the message composer and the post composer are different editors; check both.
7. Scroll a long compose window and confirm underlines track the text rather than floating.
8. Zoom to 150% and confirm underlines stay aligned.
