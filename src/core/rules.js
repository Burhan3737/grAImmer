/**
 * Check rules — the detectors. Each returns issues in absolute text offsets.
 *
 * Design constraint from spec §4: these are patterns, not a parser. Every
 * rule here is written for PRECISION over recall. A missed mistake is
 * invisible; a false alarm is in your face and trains you to ignore the
 * underline. When a pattern cannot be made confident, it is left out and
 * recorded as a known limit rather than shipped as noise.
 */

/** @typedef {{start:number,end:number,ruleId:string,category:string,severity:string,message:string,original:string,suggestions:string[]}} Issue */

const GRAMMAR = 'grammar';
const MECHANICS = 'mechanics';

function issue(start, end, text, ruleId, category, severity, message, suggestions) {
  return {
    start,
    end,
    ruleId,
    category,
    severity,
    message,
    original: text.slice(start, end),
    suggestions,
  };
}

/** Preserve the original capitalization when substituting a word. */
function matchCase(original, replacement) {
  if (original === original.toUpperCase() && original.length > 1) return replacement.toUpperCase();
  if (/^[A-Z]/.test(original)) return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  return replacement;
}

/* ------------------------------------------------------------------ *
 * Category 1 — spelling
 * ------------------------------------------------------------------ */

/**
 * Words that survived the skip rules and need the dictionary's opinion.
 *
 * The core stays synchronous and pure: it names the candidates, and the
 * caller resolves them however it likes — via the background worker in the
 * extension, or a stub in tests. That boundary is what keeps the rule engine
 * testable without a dictionary present at all.
 *
 * @returns {string[]} unique, in first-appearance order
 */
export function collectSpellingCandidates(tokens, skipped) {
  const seen = new Set();
  const candidates = [];

  tokens.forEach((token, index) => {
    if (skipped.has(index) || token.type !== 'word') return;
    // Contractions are handled by the apostrophe rules; the dictionary sees
    // the base word so "don't" is not reported as an unknown word.
    const word = token.text.replace(/[’']s$/i, '');
    if (word.length < 2) return;
    if (seen.has(word)) return;
    seen.add(word);
    candidates.push(word);
  });

  return candidates;
}

/**
 * @param {Record<string, {ok:boolean, suggestions:string[]}>} verdicts
 */
export function checkSpelling(text, tokens, skipped, verdicts) {
  const issues = [];

  tokens.forEach((token, index) => {
    if (skipped.has(index) || token.type !== 'word') return;
    const word = token.text.replace(/[’']s$/i, '');
    const verdict = verdicts[word];
    if (!verdict || verdict.ok) return;

    issues.push(
      issue(token.start, token.end, text, 'spelling', 'Spelling', 'spelling',
        `"${token.text}" is not in the dictionary.`,
        verdict.suggestions)
    );
  });

  return issues;
}

/* ------------------------------------------------------------------ *
 * Category 3 — missing apostrophes
 * ------------------------------------------------------------------ */

/**
 * Only unambiguous forms. Deliberately EXCLUDED because each is also a real
 * English word, and flagging them would produce constant false alarms:
 *   id, ill, hell, shed, were, wed, well, lets, hes, shes, whos, cant*
 * (*"cant" is a genuine but rare word — included below, accepted risk.)
 */
const APOSTROPHE_TABLE = {
  dont: "don't", doesnt: "doesn't", didnt: "didn't",
  isnt: "isn't", arent: "aren't", wasnt: "wasn't", werent: "weren't",
  hasnt: "hasn't", havent: "haven't", hadnt: "hadn't",
  wouldnt: "wouldn't", couldnt: "couldn't", shouldnt: "shouldn't",
  wont: "won't", cant: "can't", aint: "ain't", mustnt: "mustn't",
  youre: "you're", youve: "you've", youll: "you'll",
  theyre: "they're", theyve: "they've", theyll: "they'll",
  ive: "I've", im: "I'm", thats: "that's", whats: "what's",
  wheres: "where's", theres: "there's", couldve: "could've",
  wouldve: "would've", shouldve: "should've", mustve: "must've",
  weve: "we've", weren: "weren't",
};

export function checkApostrophes(text, tokens, skipped) {
  const issues = [];
  tokens.forEach((token, index) => {
    if (skipped.has(index) || token.type !== 'word') return;
    const replacement = APOSTROPHE_TABLE[token.text.toLowerCase()];
    if (!replacement) return;
    issues.push(
      issue(token.start, token.end, text, 'apostrophe', 'Missing apostrophe', GRAMMAR,
        `"${token.text}" is missing an apostrophe.`,
        [matchCase(token.text, replacement)])
    );
  });
  return issues;
}

/* ------------------------------------------------------------------ *
 * Category 2 — confused word pairs
 * ------------------------------------------------------------------ */

/**
 * The category that matters most for email (spec §3.1): every word here is
 * correctly spelled, so no dictionary can catch it.
 *
 * Each pattern is narrow on purpose. "your" followed by an arbitrary word
 * cannot be judged without knowing its part of speech, so instead we match
 * only the specific following words where the answer is certain.
 */
const CONFUSION_RULES = [
  {
    id: 'your-youre',
    re: /\byour\s+(welcome|right|wrong|correct|going|doing|being|able|sure|not|already|still|probably|definitely)\b/gi,
    fix: (m) => m[0].replace(/^your/i, (s) => matchCase(s, "you're")),
    message: '"your" is possessive. Before a verb or adjective you want "you\'re" (you are).',
  },
  {
    id: 'youre-your',
    re: /\byou're\s+(car|house|dog|cat|book|name|email|team|company|idea|help|time|day|work|job|office|desk|phone|account|order|feedback|manager|report)\b/gi,
    fix: (m) => m[0].replace(/^you're/i, (s) => matchCase(s, 'your')),
    message: '"you\'re" means "you are". Before a noun you want the possessive "your".',
  },
  {
    id: 'its-it-is',
    re: /\bits\s+(a|an|the|not|been|going|time|important|clear|possible|too|very|already|still|better|worth|likely)\b/gi,
    fix: (m) => m[0].replace(/^its/i, (s) => matchCase(s, "it's")),
    message: '"its" is possessive. For "it is" you want "it\'s".',
  },
  {
    id: 'it-is-its',
    re: /\bit's\s+(own|purpose|name|value|size|colour|color|scope|owner|team|contents|price)\b/gi,
    fix: (m) => m[0].replace(/^it's/i, (s) => matchCase(s, 'its')),
    message: '"it\'s" means "it is". For possession you want "its".',
  },
  {
    id: 'to-too',
    re: /\bto\s+(much|many|late|early|soon|far|big|small|long|short|expensive|slow|fast|often|difficult|easy)\b/gi,
    fix: (m) => m[0].replace(/^to/i, (s) => matchCase(s, 'too')),
    message: 'For "excessively" you want "too", not "to".',
  },
  {
    id: 'their-there',
    re: /\btheir\s+(is|are|was|were)\b/gi,
    fix: (m) => m[0].replace(/^their/i, (s) => matchCase(s, 'there')),
    message: '"their" is possessive. To introduce something you want "there".',
  },
  {
    id: 'there-their',
    re: /\bthere\s+(car|house|name|team|job|work|idea|help|office|desk|phone|account|order|feedback|manager|report|opinion)\b/gi,
    fix: (m) => m[0].replace(/^there/i, (s) => matchCase(s, 'their')),
    message: 'Before a possessed noun you want "their".',
  },
  {
    id: 'theyre-their',
    re: /\bthey're\s+(car|house|name|team|job|work|idea|office|account|order|manager|report)\b/gi,
    fix: (m) => m[0].replace(/^they're/i, (s) => matchCase(s, 'their')),
    message: '"they\'re" means "they are". Before a noun you want "their".',
  },
  {
    id: 'then-than',
    re: /\b(more|less|rather|other|better|worse|greater|fewer|sooner|later|bigger|smaller)\s+then\b/gi,
    fix: (m) => m[0].replace(/then$/i, (s) => matchCase(s, 'than')),
    message: 'Comparisons use "than". "then" is about time or sequence.',
  },
  {
    id: 'affect-effect',
    re: /\b(the|an|no|any|little|side|positive|negative|desired)\s+affect\b/gi,
    fix: (m) => m[0].replace(/affect$/i, (s) => matchCase(s, 'effect')),
    message: 'As a noun the word is "effect". "affect" is the verb.',
  },
  {
    id: 'loose-lose',
    re: /\b(to|will|would|might|could|don't|dont|didn't|didnt)\s+loose\b/gi,
    fix: (m) => m[0].replace(/loose$/i, (s) => matchCase(s, 'lose')),
    message: '"loose" means not tight. The verb is "lose".',
  },
];

export function checkConfusions(text, isSkipped) {
  const issues = [];
  for (const rule of CONFUSION_RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (isSkipped(start, end)) continue;
      issues.push(
        issue(start, end, text, rule.id, 'Confused words', GRAMMAR, rule.message, [rule.fix(m)])
      );
    }
  }
  return issues;
}

/* ------------------------------------------------------------------ *
 * Category 6 — subject-verb agreement (deliberately narrow, spec D3)
 * ------------------------------------------------------------------ */

const AGREEMENT_RULES = [
  {
    id: 'there-is-plural',
    re: /\bthere\s+is\s+(\d+|two|three|four|five|six|seven|eight|nine|ten|many|several|multiple|numerous)\b/gi,
    fix: (m) => m[0].replace(/\bis\b/i, (s) => matchCase(s, 'are')),
    message: 'A plural subject takes "there are".',
  },
  {
    id: 'there-was-plural',
    re: /\bthere\s+was\s+(\d+|two|three|four|five|many|several|multiple)\b/gi,
    fix: (m) => m[0].replace(/\bwas\b/i, (s) => matchCase(s, 'were')),
    message: 'A plural subject takes "there were".',
  },
  {
    id: 'singular-have',
    re: /\b(he|she|it)\s+have\b/gi,
    fix: (m) => m[0].replace(/have$/i, (s) => matchCase(s, 'has')),
    message: 'A singular subject takes "has".',
  },
  {
    id: 'plural-has',
    re: /\b(they|we)\s+has\b/gi,
    fix: (m) => m[0].replace(/has$/i, (s) => matchCase(s, 'have')),
    message: 'A plural subject takes "have".',
  },
  {
    id: 'i-is',
    re: /\bI\s+is\b/g,
    fix: () => 'I am',
    message: '"I" takes "am".',
  },
  {
    id: 'singular-were',
    re: /\b(he|she|it)\s+were\b/gi,
    fix: (m) => m[0].replace(/were$/i, (s) => matchCase(s, 'was')),
    message: 'A singular subject takes "was".',
  },
];

export function checkAgreement(text, isSkipped) {
  const issues = [];
  for (const rule of AGREEMENT_RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (isSkipped(start, end)) continue;
      issues.push(
        issue(start, end, text, rule.id, 'Agreement', GRAMMAR, rule.message, [rule.fix(m)])
      );
    }
  }
  return issues;
}

/* ------------------------------------------------------------------ *
 * Category 4 — capitalization
 * ------------------------------------------------------------------ */

const WEEKDAYS_MONTHS = new Set([
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'june', 'july',
  'august', 'september', 'october', 'november', 'december',
]);
// "may" and "march" are ordinary words too; only "march" is included above
// because "may" as a month is unrecoverable from a pattern.

export function checkCapitalization(text, tokens, sentences, skipped) {
  const issues = [];
  const skippedStarts = new Set();
  skipped.forEach((reason, index) => {
    if (reason !== 'nonword' && reason !== 'propernouns') skippedStarts.add(tokens[index].start);
  });

  // Standalone "i"
  tokens.forEach((token, index) => {
    if (token.text !== 'i') return;
    if (skipped.has(index) && skipped.get(index) !== 'propernouns') return;
    // Guard against "i.e." — the tokenizer splits it, and the period tells us.
    if (text[token.end] === '.') return;
    issues.push(
      issue(token.start, token.end, text, 'lowercase-i', 'Capitalization', MECHANICS,
        'The pronoun "I" is always capitalized.', ['I'])
    );
  });

  // Weekdays and months
  tokens.forEach((token, index) => {
    if (token.type !== 'word') return;
    if (skippedStarts.has(token.start)) return;
    if (!WEEKDAYS_MONTHS.has(token.text)) return; // exact lowercase match only
    issues.push(
      issue(token.start, token.end, text, 'day-month-caps', 'Capitalization', MECHANICS,
        'Days and months are capitalized.',
        [token.text.charAt(0).toUpperCase() + token.text.slice(1)])
    );
  });

  // Sentence starts
  for (const sentence of sentences) {
    const first = tokens.find(
      (t) => t.start >= sentence.start && t.end <= sentence.end && t.type === 'word'
    );
    if (!first) continue;
    if (skippedStarts.has(first.start)) continue;
    if (!/^[a-z]/.test(first.text)) continue;
    // "i" is already covered by its own rule with a better message.
    if (first.text === 'i') continue;
    issues.push(
      issue(first.start, first.end, text, 'sentence-caps', 'Capitalization', MECHANICS,
        'Sentences start with a capital letter.',
        [first.text.charAt(0).toUpperCase() + first.text.slice(1)])
    );
  }

  return issues;
}

/* ------------------------------------------------------------------ *
 * Category 5 — doubles, spacing, punctuation
 * ------------------------------------------------------------------ */

export function checkMechanics(text, isSkipped) {
  const issues = [];

  const add = (start, end, ruleId, message, suggestions) => {
    if (isSkipped(start, end)) return;
    issues.push(issue(start, end, text, ruleId, 'Mechanics', MECHANICS, message, suggestions));
  };

  // Repeated word: "the the". Case-insensitive, but not across a line break.
  const repeated = /\b([A-Za-z]+)([ \t]+)\1\b/gi;
  let m;
  while ((m = repeated.exec(text)) !== null) {
    add(m.index, m.index + m[0].length, 'repeated-word',
      `"${m[1]}" is repeated.`, [m[1]]);
  }

  // Space before punctuation.
  const spaceBefore = /[ \t]+([,.;:!?])/g;
  while ((m = spaceBefore.exec(text)) !== null) {
    add(m.index, m.index + m[0].length, 'space-before-punct',
      'Remove the space before punctuation.', [m[1]]);
  }

  // Missing space after sentence punctuation. Digits are excluded so that
  // decimals and version numbers survive; URLs are already skipped.
  const missingSpace = /(?<!\d)([.!?,;:])([A-Za-z])/g;
  while ((m = missingSpace.exec(text)) !== null) {
    add(m.index, m.index + m[0].length, 'missing-space',
      'Add a space after the punctuation.', [`${m[1]} ${m[2]}`]);
  }

  // Doubled spaces inside a line.
  const doubleSpace = /(?<=\S)[ ]{2,}(?=\S)/g;
  while ((m = doubleSpace.exec(text)) !== null) {
    add(m.index, m.index + m[0].length, 'double-space',
      'Collapse the extra space.', [' ']);
  }

  // Repeated punctuation, excluding a deliberate ellipsis.
  const repeatedPunct = /([,;:!?])\1+|\.{4,}/g;
  while ((m = repeatedPunct.exec(text)) !== null) {
    add(m.index, m.index + m[0].length, 'repeated-punct',
      'Repeated punctuation.', [m[0][0]]);
  }

  return issues;
}
