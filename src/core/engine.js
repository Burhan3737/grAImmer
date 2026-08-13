/**
 * Engine — composes the pipeline described in spec §3.
 *
 *   text -> tokenize -> segment -> SKIP RULES -> CHECK RULES -> issues
 *
 * Pure by design (spec §5.1): no DOM, no browser APIs, no site knowledge.
 * Everything here is testable by passing a string and asserting on offsets,
 * which is what test/cases.js does.
 *
 * Spelling is absent from this slice. It needs the dictionary in the
 * background worker, and is added behind the dictionary-service contract
 * (spec §5.2) without changing anything in this file's shape.
 */

import { tokenize, segmentSentences } from './tokenizer.js';
import { applySkipRules, makeSkipPredicate, DEFAULT_SKIP_SETTINGS } from './skip-rules.js';
import {
  checkApostrophes,
  checkConfusions,
  checkAgreement,
  checkCapitalization,
  checkMechanics,
  checkSpelling,
  collectSpellingCandidates,
} from './rules.js';

export const DEFAULT_CHECK_SETTINGS = {
  spelling: true,
  confusions: true,
  apostrophes: true,
  capitalization: true,
  mechanics: true,
  agreement: true,
};

/**
 * Later rules lose to earlier ones when they overlap. Ordering encodes
 * which explanation is more useful: a confused-word issue tells you more
 * than a capitalization issue on the same span.
 */
const PRIORITY = [
  'Confused words',
  'Agreement',
  'Missing apostrophe',
  'Spelling',
  'Mechanics',
  'Capitalization',
];

function dedupe(issues) {
  const sorted = [...issues].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    const pa = PRIORITY.indexOf(a.category);
    const pb = PRIORITY.indexOf(b.category);
    if (pa !== pb) return pa - pb;
    return b.end - b.start - (a.end - a.start);
  });

  // Only the most recently kept issue can overlap the next candidate.
  //
  // Candidates arrive sorted by start, and kept issues are pairwise
  // non-overlapping, so their ends are increasing too: if k1 starts before k2
  // and they do not overlap, k1.end <= k2.start < k2.end. The furthest-right
  // end therefore always belongs to the last one kept.
  //
  // Scanning all of `kept` per candidate instead made deduplication quadratic
  // in issue count — 3,600 issues in a long document is 6.5 million
  // comparisons, and it dominated everything else.
  const kept = [];
  for (const candidate of sorted) {
    const last = kept[kept.length - 1];
    if (last && candidate.start < last.end) continue;
    kept.push(candidate);
  }
  return kept;
}

/**
 * @param {string} text
 * @param {object} [settings]
 * @param {Record<string, {ok:boolean, suggestions:string[]}>} [verdicts]
 *   Dictionary answers for words named by a previous call's `candidates`.
 *   Omit it and spelling is simply absent — every other rule still runs, which
 *   is what lets underlines appear before the worker has replied (spec §5.4).
 * @returns {{issues: Issue[], candidates: string[], trace: object}}
 *   trace carries the intermediate stages so the harness can show what the
 *   pipeline did. Production callers ignore it; it costs nothing to build.
 */
export function check(text, settings = {}, verdicts = null) {
  const skipSettings = { ...DEFAULT_SKIP_SETTINGS, ...(settings.skip || {}) };
  const checkSettings = { ...DEFAULT_CHECK_SETTINGS, ...(settings.checks || {}) };

  const tokens = tokenize(text);
  const sentences = segmentSentences(text);
  const { skipped, regions } = applySkipRules(text, tokens, sentences, skipSettings);

  const isSkipped = makeSkipPredicate(tokens, skipped, regions);
  // Spacing and punctuation are properties of the text between words, not of
  // the words themselves, so the proper-noun skip must not apply to them.
  // Without this, "confirm.Thanks" goes unreported because "Thanks" is a
  // presumed proper noun. See makeSkipPredicate for the full reasoning.
  const isSkippedForMechanics = makeSkipPredicate(tokens, skipped, regions, ['propernouns']);

  let issues = [];
  if (checkSettings.apostrophes) issues.push(...checkApostrophes(text, tokens, skipped));
  if (checkSettings.confusions) issues.push(...checkConfusions(text, isSkipped));
  if (checkSettings.agreement) issues.push(...checkAgreement(text, isSkipped));
  if (checkSettings.capitalization) {
    issues.push(...checkCapitalization(text, tokens, sentences, skipped));
  }
  if (checkSettings.mechanics) issues.push(...checkMechanics(text, isSkippedForMechanics));
  if (checkSettings.spelling && verdicts) {
    issues.push(...checkSpelling(text, tokens, skipped, verdicts));
  }

  issues = dedupe(issues);

  const candidates = checkSettings.spelling ? collectSpellingCandidates(tokens, skipped) : [];

  return {
    issues,
    candidates,
    trace: { tokens, sentences, skipped, regions },
  };
}
