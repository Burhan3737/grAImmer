/**
 * Tokenizer — text to tokens carrying absolute offsets.
 *
 * Offsets are the contract for everything downstream. A token's [start, end)
 * must index back into the original string exactly: rules report issues in
 * these coordinates, and the overlay turns them into screen rectangles. An
 * off-by-one here surfaces as an underline sitting under the wrong word.
 *
 * Protected patterns are matched BEFORE word splitting. Without that,
 * "grafana.acme.io/d/x8f2" would arrive downstream as nine separate tokens
 * and every one of them would be flagged as a misspelling.
 */

const TLD = 'com|org|net|io|dev|co|uk|ai|app|edu|gov|me|info|xyz|cloud|tech|local|sh|so';

/**
 * Order matters — email must win over url, since a URL pattern would
 * otherwise claim the domain half of an address.
 */
const PROTECTED = [
  { type: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  {
    type: 'url',
    re: new RegExp(
      `(?:https?:\\/\\/|www\\.)[^\\s<>()]+` +
        `|[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.(?:${TLD})\\b(?:\\/[^\\s<>()]*)?`,
      'gi'
    ),
  },
  { type: 'path', re: /[A-Za-z]:\\[^\s]+|(?:\.{0,2}\/)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+/g },
  { type: 'code', re: /`[^`\n]+`/g },
  // Identifiers: INFRA-4471, snake_case, api_key_2. Filtered below so that
  // ordinary hyphenated English ("well-known") is NOT swallowed.
  { type: 'identifier', re: /\b[A-Za-z][A-Za-z0-9]*(?:[-_][A-Za-z0-9]+)+\b/g },
];

/** A word, a number, or a single non-space character. */
const ATOM = /[A-Za-z][A-Za-z'’]*|\d[\d.,:]*|[^\s]/g;

function isIdentifier(text) {
  return /[_\d]/.test(text);
}

/** Collect non-overlapping protected ranges, earliest and longest first. */
function findProtected(text) {
  const found = [];
  for (const { type, re } of PROTECTED) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      if (type === 'identifier' && !isIdentifier(m[0])) continue;
      found.push({ type, start: m.index, end: m.index + m[0].length, text: m[0] });
    }
  }

  found.sort((a, b) => a.start - b.start || b.end - a.end);

  const kept = [];
  let cursor = 0;
  for (const range of found) {
    if (range.start >= cursor) {
      kept.push(range);
      cursor = range.end;
    }
  }
  return kept;
}

/** Split an ordinary stretch of text into word / number / punctuation atoms. */
function atomize(text, base, out) {
  ATOM.lastIndex = 0;
  let m;
  while ((m = ATOM.exec(text)) !== null) {
    const value = m[0];
    let type;
    if (/^[A-Za-z]/.test(value)) type = 'word';
    else if (/^\d/.test(value)) type = 'number';
    else type = 'punct';
    out.push({ type, text: value, start: base + m.index, end: base + m.index + value.length });
  }
}

/**
 * @param {string} text
 * @returns {Array<{type: string, text: string, start: number, end: number}>}
 *   Tokens in document order. Whitespace is not emitted — gaps between
 *   tokens are implicit, which keeps rules that inspect neighbours simple.
 */
export function tokenize(text) {
  if (!text) return [];

  const protectedRanges = findProtected(text);
  const tokens = [];
  let cursor = 0;

  for (const range of protectedRanges) {
    if (range.start > cursor) {
      atomize(text.slice(cursor, range.start), cursor, tokens);
    }
    tokens.push({ type: range.type, text: range.text, start: range.start, end: range.end });
    cursor = range.end;
  }

  if (cursor < text.length) {
    atomize(text.slice(cursor), cursor, tokens);
  }

  return tokens;
}

/**
 * Sentence segmentation, needed by the capitalization rule.
 *
 * The hard part is not finding periods, it is knowing which periods do not
 * end a sentence. Abbreviations are handled by an explicit list because
 * there is no general rule — "Dr." and "etc." simply have to be known.
 */
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st',
  'e.g', 'i.e', 'etc', 'vs', 'approx', 'dept', 'est',
  'fig', 'no', 'inc', 'ltd', 'co', 'corp', 'univ',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
  'mon', 'tue', 'tues', 'wed', 'thu', 'thur', 'thurs', 'fri', 'sat', 'sun',
  'a.m', 'p.m', 'u.s', 'u.k',
]);

function endsWithAbbreviation(text, periodIndex) {
  let start = periodIndex;
  while (start > 0 && /[A-Za-z.]/.test(text[start - 1])) start--;
  const candidate = text.slice(start, periodIndex).toLowerCase();
  if (ABBREVIATIONS.has(candidate)) return true;
  // A single initial: "J. Smith"
  if (/^[a-z]$/.test(candidate)) return true;
  return false;
}

/**
 * @param {string} text
 * @returns {Array<{start: number, end: number, text: string}>}
 */
export function segmentSentences(text) {
  if (!text) return [];

  const sentences = [];
  let start = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (ch === '\n') {
      // A line break ends a sentence regardless of punctuation. Email is
      // full of unpunctuated lines ("Hi Sarah") that are sentences anyway.
      if (i > start) sentences.push({ start, end: i, text: text.slice(start, i) });
      start = i + 1;
      continue;
    }

    if (ch === '.' || ch === '!' || ch === '?') {
      if (ch === '.' && endsWithAbbreviation(text, i)) continue;
      // Consume runs like "?!" and any closing quote or bracket.
      let end = i + 1;
      while (end < text.length && /[.!?"'’”)\]]/.test(text[end])) end++;
      // A boundary requires whitespace or end-of-text after it. This is what
      // stops "3.5" and "grafana.acme.io" from splitting a sentence — their
      // periods are followed by a digit or letter, never by a space.
      if (end < text.length && !/\s/.test(text[end])) continue;
      sentences.push({ start, end, text: text.slice(start, end) });
      while (end < text.length && /[ \t]/.test(text[end])) end++;
      start = end;
      i = end - 1;
    }
  }

  if (start < text.length) {
    const rest = text.slice(start);
    if (rest.trim().length > 0) sentences.push({ start, end: text.length, text: rest });
  }

  return sentences;
}
