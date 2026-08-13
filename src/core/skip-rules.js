/**
 * Skip rules — the filter that runs BEFORE any check rule.
 *
 * These never produce an issue. They remove text from consideration, and
 * anything they remove is invisible to every check that follows. That
 * ordering is why they are powerful and why they need care: a skip rule
 * that is too eager silently disables the checker for that text.
 *
 * Each rule is independently toggleable because per-site profiles need to
 * turn them on and off (spec §2 D6 — chat sites want different behaviour).
 */

import { firstWordOffsets } from './tokenizer.js';

export const SKIP_RULES = [
  { id: 'urls', label: 'URLs, emails, file paths' },
  { id: 'identifiers', label: 'ALL-CAPS tokens and identifiers' },
  { id: 'quoted', label: 'Quoted reply history' },
  { id: 'signature', label: 'Signature block' },
  { id: 'propernouns', label: 'Capitalized words mid-sentence' },
  { id: 'code', label: 'Code blocks and inline code' },
];

export const DEFAULT_SKIP_SETTINGS = {
  urls: true,
  identifiers: true,
  quoted: true,
  signature: true,
  propernouns: true,
  code: true,
};

/**
 * Character ranges that are skipped wholesale, independent of tokens —
 * quoted history and signature blocks are regions, not words.
 *
 * @returns {Array<{start: number, end: number, reason: string}>}
 */
export function findSkippedRegions(text, settings = DEFAULT_SKIP_SETTINGS) {
  const regions = [];

  if (settings.quoted) {
    // Lines beginning with ">" — the universal quoting convention.
    const quoteLine = /^[ \t]*>.*$/gm;
    let m;
    while ((m = quoteLine.exec(text)) !== null) {
      regions.push({ start: m.index, end: m.index + m[0].length, reason: 'quoted' });
    }

    // "On <date>, <person> wrote:" and everything after it. Gmail, Outlook
    // and Apple Mail all emit some variant of this attribution line.
    const attribution = /^[ \t]*On .{0,120}\bwrote:[ \t]*$/m.exec(text);
    if (attribution) {
      regions.push({ start: attribution.index, end: text.length, reason: 'quoted' });
    }
  }

  if (settings.signature) {
    // The RFC 3676 convention: a line containing exactly "--" or "-- ".
    const sigMarker = /^-- ?$/m.exec(text);
    if (sigMarker) {
      regions.push({ start: sigMarker.index, end: text.length, reason: 'signature' });
    }
  }

  if (settings.code) {
    const fenced = /```[\s\S]*?```/g;
    let m;
    while ((m = fenced.exec(text)) !== null) {
      regions.push({ start: m.index, end: m.index + m[0].length, reason: 'code' });
    }
  }

  return regions;
}

function inAnyRegion(token, regions) {
  for (const region of regions) {
    if (token.start >= region.start && token.end <= region.end) return region;
  }
  return null;
}

/**
 * Decide which tokens survive to the check stage.
 *
 * @param {string} text
 * @param {Array} tokens        from tokenize()
 * @param {Array} sentences     from segmentSentences()
 * @param {object} settings
 * @returns {{skipped: Map<number, string>, regions: Array}}
 *   skipped maps token index -> reason id. Callers keep the full token list
 *   so the inspector can show what was dropped and why.
 */
export function applySkipRules(text, tokens, sentences, settings = DEFAULT_SKIP_SETTINGS) {
  const regions = findSkippedRegions(text, settings);
  const skipped = new Map();

  // Offset of the first word token in each sentence, so "mid-sentence" is
  // decidable without re-scanning. A capitalized word in first position is
  // just normal sentence casing and tells us nothing.
  const sentenceFirstWord = firstWordOffsets(tokens, sentences);

  tokens.forEach((token, index) => {
    const region = inAnyRegion(token, regions);
    if (region) {
      skipped.set(index, region.reason);
      return;
    }

    if (token.type === 'punct' || token.type === 'number') {
      skipped.set(index, 'nonword');
      return;
    }

    if (settings.urls && (token.type === 'url' || token.type === 'email' || token.type === 'path')) {
      skipped.set(index, 'urls');
      return;
    }

    if (settings.code && token.type === 'code') {
      skipped.set(index, 'code');
      return;
    }

    if (settings.identifiers) {
      if (token.type === 'identifier') {
        skipped.set(index, 'identifiers');
        return;
      }
      // ALL-CAPS of two or more letters: API, SLA, NASA.
      if (/^[A-Z]{2,}$/.test(token.text)) {
        skipped.set(index, 'identifiers');
        return;
      }
    }

    if (settings.propernouns && token.type === 'word') {
      const isCapitalized = /^[A-Z][a-z']/.test(token.text);
      if (isCapitalized && !sentenceFirstWord.has(token.start)) {
        skipped.set(index, 'propernouns');
        return;
      }
    }
  });

  return { skipped, regions };
}

/**
 * True when a character offset falls inside skipped text. Check rules that
 * work on raw text rather than tokens (the mechanics regexes) use this to
 * stay consistent with the token-level decisions.
 *
 * Skip reasons are PURPOSE-SCOPED, not global — this is the subtlety that
 * `excludeReasons` exists for. "Sarah" is skipped so that it is not
 * spell-checked; that says nothing about whether the space before it is
 * correct. Applying every skip reason to every rule silently disables
 * spacing and punctuation checks around every proper noun in the text.
 *
 * @param {string[]} excludeReasons reasons this caller should ignore
 */
export function makeSkipPredicate(tokens, skipped, regions, excludeReasons = []) {
  const ignored = new Set(['nonword', ...excludeReasons]);
  const spans = [];

  skipped.forEach((reason, index) => {
    if (ignored.has(reason)) return;
    spans.push([tokens[index].start, tokens[index].end]);
  });
  for (const region of regions) spans.push([region.start, region.end]);

  // Sorted and merged so lookup can binary-search instead of scanning.
  //
  // The naive version scanned every span per query, which made checking
  // quadratic in document length: more text means both more rule matches and
  // more spans for each one to scan. Measured on a long document, 2.7x the
  // text cost 3.5x the time. Email is short enough that it never mattered,
  // but the cost is unbounded and the fix is small.
  spans.sort((a, b) => a[0] - b[0]);

  const merged = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push([span[0], span[1]]);
  }

  return (start, end) => {
    // Rightmost span beginning at or before `start`.
    let low = 0;
    let high = merged.length - 1;
    let candidate = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (merged[mid][0] <= start) {
        candidate = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    // Spans are disjoint after merging, so only the one at or before `start`
    // and the one after it can overlap [start, end).
    if (candidate >= 0 && merged[candidate][1] > start) return true;
    const next = merged[candidate + 1];
    return Boolean(next && next[0] < end);
  };
}
