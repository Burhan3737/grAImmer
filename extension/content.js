(() => {
  // src/core/tokenizer.js
  var TLD = "com|org|net|io|dev|co|uk|ai|app|edu|gov|me|info|xyz|cloud|tech|local|sh|so";
  var PROTECTED = [
    { type: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
    {
      type: "url",
      re: new RegExp(
        `(?:https?:\\/\\/|www\\.)[^\\s<>()]+|[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.(?:${TLD})\\b(?:\\/[^\\s<>()]*)?`,
        "gi"
      )
    },
    { type: "path", re: /[A-Za-z]:\\[^\s]+|(?:\.{0,2}\/)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+/g },
    { type: "code", re: /`[^`\n]+`/g },
    // Identifiers: INFRA-4471, snake_case, api_key_2. Filtered below so that
    // ordinary hyphenated English ("well-known") is NOT swallowed.
    { type: "identifier", re: /\b[A-Za-z][A-Za-z0-9]*(?:[-_][A-Za-z0-9]+)+\b/g }
  ];
  var ATOM = /[A-Za-z][A-Za-z'’]*|\d[\d.,:]*|[^\s]/g;
  function isIdentifier(text) {
    return /[_\d]/.test(text);
  }
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
        if (type === "identifier" && !isIdentifier(m[0])) continue;
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
  function atomize(text, base, out) {
    ATOM.lastIndex = 0;
    let m;
    while ((m = ATOM.exec(text)) !== null) {
      const value = m[0];
      let type;
      if (/^[A-Za-z]/.test(value)) type = "word";
      else if (/^\d/.test(value)) type = "number";
      else type = "punct";
      out.push({ type, text: value, start: base + m.index, end: base + m.index + value.length });
    }
  }
  function tokenize(text) {
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
  var ABBREVIATIONS = /* @__PURE__ */ new Set([
    "mr",
    "mrs",
    "ms",
    "dr",
    "prof",
    "sr",
    "jr",
    "st",
    "e.g",
    "i.e",
    "etc",
    "vs",
    "approx",
    "dept",
    "est",
    "fig",
    "no",
    "inc",
    "ltd",
    "co",
    "corp",
    "univ",
    "jan",
    "feb",
    "mar",
    "apr",
    "jun",
    "jul",
    "aug",
    "sep",
    "sept",
    "oct",
    "nov",
    "dec",
    "mon",
    "tue",
    "tues",
    "wed",
    "thu",
    "thur",
    "thurs",
    "fri",
    "sat",
    "sun",
    "a.m",
    "p.m",
    "u.s",
    "u.k"
  ]);
  function endsWithAbbreviation(text, periodIndex) {
    let start = periodIndex;
    while (start > 0 && /[A-Za-z.]/.test(text[start - 1])) start--;
    const candidate = text.slice(start, periodIndex).toLowerCase();
    if (ABBREVIATIONS.has(candidate)) return true;
    if (/^[a-z]$/.test(candidate)) return true;
    return false;
  }
  function firstWordOffsets(tokens, sentences) {
    const offsets = /* @__PURE__ */ new Set();
    let cursor = 0;
    for (const sentence of sentences) {
      while (cursor < tokens.length && tokens[cursor].start < sentence.start) cursor++;
      let scan = cursor;
      while (scan < tokens.length && tokens[scan].end <= sentence.end) {
        if (tokens[scan].type === "word") {
          offsets.add(tokens[scan].start);
          break;
        }
        scan++;
      }
    }
    return offsets;
  }
  function segmentSentences(text) {
    if (!text) return [];
    const sentences = [];
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === "\n") {
        if (i > start) sentences.push({ start, end: i, text: text.slice(start, i) });
        start = i + 1;
        continue;
      }
      if (ch === "." || ch === "!" || ch === "?") {
        if (ch === "." && endsWithAbbreviation(text, i)) continue;
        let end = i + 1;
        while (end < text.length && /[.!?"'’”)\]]/.test(text[end])) end++;
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

  // src/core/skip-rules.js
  var DEFAULT_SKIP_SETTINGS = {
    urls: true,
    identifiers: true,
    quoted: true,
    signature: true,
    propernouns: true,
    code: true
  };
  function findSkippedRegions(text, settings = DEFAULT_SKIP_SETTINGS) {
    const regions = [];
    if (settings.quoted) {
      const quoteLine = /^[ \t]*>.*$/gm;
      let m;
      while ((m = quoteLine.exec(text)) !== null) {
        regions.push({ start: m.index, end: m.index + m[0].length, reason: "quoted" });
      }
      const attribution = /^[ \t]*On .{0,120}\bwrote:[ \t]*$/m.exec(text);
      if (attribution) {
        regions.push({ start: attribution.index, end: text.length, reason: "quoted" });
      }
    }
    if (settings.signature) {
      const sigMarker = /^-- ?$/m.exec(text);
      if (sigMarker) {
        regions.push({ start: sigMarker.index, end: text.length, reason: "signature" });
      }
    }
    if (settings.code) {
      const fenced = /```[\s\S]*?```/g;
      let m;
      while ((m = fenced.exec(text)) !== null) {
        regions.push({ start: m.index, end: m.index + m[0].length, reason: "code" });
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
  function applySkipRules(text, tokens, sentences, settings = DEFAULT_SKIP_SETTINGS) {
    const regions = findSkippedRegions(text, settings);
    const skipped = /* @__PURE__ */ new Map();
    const sentenceFirstWord = firstWordOffsets(tokens, sentences);
    tokens.forEach((token, index) => {
      const region = inAnyRegion(token, regions);
      if (region) {
        skipped.set(index, region.reason);
        return;
      }
      if (token.type === "punct" || token.type === "number") {
        skipped.set(index, "nonword");
        return;
      }
      if (settings.urls && (token.type === "url" || token.type === "email" || token.type === "path")) {
        skipped.set(index, "urls");
        return;
      }
      if (settings.code && token.type === "code") {
        skipped.set(index, "code");
        return;
      }
      if (settings.identifiers) {
        if (token.type === "identifier") {
          skipped.set(index, "identifiers");
          return;
        }
        if (/^[A-Z]{2,}$/.test(token.text)) {
          skipped.set(index, "identifiers");
          return;
        }
      }
      if (settings.propernouns && token.type === "word") {
        const isCapitalized = /^[A-Z][a-z']/.test(token.text);
        if (isCapitalized && !sentenceFirstWord.has(token.start)) {
          skipped.set(index, "propernouns");
          return;
        }
      }
    });
    return { skipped, regions };
  }
  function makeSkipPredicate(tokens, skipped, regions, excludeReasons = []) {
    const ignored = /* @__PURE__ */ new Set(["nonword", ...excludeReasons]);
    const spans = [];
    skipped.forEach((reason, index) => {
      if (ignored.has(reason)) return;
      spans.push([tokens[index].start, tokens[index].end]);
    });
    for (const region of regions) spans.push([region.start, region.end]);
    spans.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const span of spans) {
      const last = merged[merged.length - 1];
      if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
      else merged.push([span[0], span[1]]);
    }
    return (start, end) => {
      let low = 0;
      let high = merged.length - 1;
      let candidate = -1;
      while (low <= high) {
        const mid = low + high >> 1;
        if (merged[mid][0] <= start) {
          candidate = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      if (candidate >= 0 && merged[candidate][1] > start) return true;
      const next = merged[candidate + 1];
      return Boolean(next && next[0] < end);
    };
  }

  // src/core/rules.js
  var GRAMMAR = "grammar";
  var MECHANICS = "mechanics";
  function issue(start, end, text, ruleId, category, severity, message, suggestions) {
    return {
      start,
      end,
      ruleId,
      category,
      severity,
      message,
      original: text.slice(start, end),
      suggestions
    };
  }
  function matchCase(original, replacement) {
    if (original === original.toUpperCase() && original.length > 1) return replacement.toUpperCase();
    if (/^[A-Z]/.test(original)) return replacement.charAt(0).toUpperCase() + replacement.slice(1);
    return replacement;
  }
  function collectSpellingCandidates(tokens, skipped) {
    const seen = /* @__PURE__ */ new Set();
    const candidates = [];
    tokens.forEach((token, index) => {
      if (skipped.has(index) || token.type !== "word") return;
      const word = token.text.replace(/[’']s$/i, "");
      if (word.length < 2) return;
      if (seen.has(word)) return;
      seen.add(word);
      candidates.push(word);
    });
    return candidates;
  }
  function checkSpelling(text, tokens, skipped, verdicts) {
    const issues = [];
    tokens.forEach((token, index) => {
      if (skipped.has(index) || token.type !== "word") return;
      const word = token.text.replace(/[’']s$/i, "");
      const verdict = verdicts[word];
      if (!verdict || verdict.ok) return;
      issues.push(
        issue(
          token.start,
          token.end,
          text,
          "spelling",
          "Spelling",
          "spelling",
          `"${token.text}" is not in the dictionary.`,
          verdict.suggestions
        )
      );
    });
    return issues;
  }
  var APOSTROPHE_TABLE = {
    dont: "don't",
    doesnt: "doesn't",
    didnt: "didn't",
    isnt: "isn't",
    arent: "aren't",
    wasnt: "wasn't",
    werent: "weren't",
    hasnt: "hasn't",
    havent: "haven't",
    hadnt: "hadn't",
    wouldnt: "wouldn't",
    couldnt: "couldn't",
    shouldnt: "shouldn't",
    wont: "won't",
    cant: "can't",
    aint: "ain't",
    mustnt: "mustn't",
    youre: "you're",
    youve: "you've",
    youll: "you'll",
    theyre: "they're",
    theyve: "they've",
    theyll: "they'll",
    ive: "I've",
    im: "I'm",
    thats: "that's",
    whats: "what's",
    wheres: "where's",
    theres: "there's",
    couldve: "could've",
    wouldve: "would've",
    shouldve: "should've",
    mustve: "must've",
    weve: "we've",
    weren: "weren't"
  };
  function checkApostrophes(text, tokens, skipped) {
    const issues = [];
    tokens.forEach((token, index) => {
      if (skipped.has(index) || token.type !== "word") return;
      const replacement = APOSTROPHE_TABLE[token.text.toLowerCase()];
      if (!replacement) return;
      issues.push(
        issue(
          token.start,
          token.end,
          text,
          "apostrophe",
          "Missing apostrophe",
          GRAMMAR,
          `"${token.text}" is missing an apostrophe.`,
          [matchCase(token.text, replacement)]
        )
      );
    });
    return issues;
  }
  var CONFUSION_RULES = [
    {
      id: "your-youre",
      re: /\byour\s+(welcome|right|wrong|correct|going|doing|being|able|sure|not|already|still|probably|definitely)\b/gi,
      fix: (m) => m[0].replace(/^your/i, (s) => matchCase(s, "you're")),
      message: `"your" is possessive. Before a verb or adjective you want "you're" (you are).`
    },
    {
      id: "youre-your",
      re: /\byou're\s+(car|house|dog|cat|book|name|email|team|company|idea|help|time|day|work|job|office|desk|phone|account|order|feedback|manager|report)\b/gi,
      fix: (m) => m[0].replace(/^you're/i, (s) => matchCase(s, "your")),
      message: `"you're" means "you are". Before a noun you want the possessive "your".`
    },
    {
      id: "its-it-is",
      re: /\bits\s+(a|an|the|not|been|going|time|important|clear|possible|too|very|already|still|better|worth|likely)\b/gi,
      fix: (m) => m[0].replace(/^its/i, (s) => matchCase(s, "it's")),
      message: `"its" is possessive. For "it is" you want "it's".`
    },
    {
      id: "it-is-its",
      re: /\bit's\s+(own|purpose|name|value|size|colour|color|scope|owner|team|contents|price)\b/gi,
      fix: (m) => m[0].replace(/^it's/i, (s) => matchCase(s, "its")),
      message: `"it's" means "it is". For possession you want "its".`
    },
    {
      id: "to-too",
      re: /\bto\s+(much|many|late|early|soon|far|big|small|long|short|expensive|slow|fast|often|difficult|easy)\b/gi,
      fix: (m) => m[0].replace(/^to/i, (s) => matchCase(s, "too")),
      message: 'For "excessively" you want "too", not "to".'
    },
    {
      id: "their-there",
      re: /\btheir\s+(is|are|was|were)\b/gi,
      fix: (m) => m[0].replace(/^their/i, (s) => matchCase(s, "there")),
      message: '"their" is possessive. To introduce something you want "there".'
    },
    {
      id: "there-their",
      re: /\bthere\s+(car|house|name|team|job|work|idea|help|office|desk|phone|account|order|feedback|manager|report|opinion)\b/gi,
      fix: (m) => m[0].replace(/^there/i, (s) => matchCase(s, "their")),
      message: 'Before a possessed noun you want "their".'
    },
    {
      id: "theyre-their",
      re: /\bthey're\s+(car|house|name|team|job|work|idea|office|account|order|manager|report)\b/gi,
      fix: (m) => m[0].replace(/^they're/i, (s) => matchCase(s, "their")),
      message: `"they're" means "they are". Before a noun you want "their".`
    },
    {
      id: "then-than",
      re: /\b(more|less|rather|other|better|worse|greater|fewer|sooner|later|bigger|smaller)\s+then\b/gi,
      fix: (m) => m[0].replace(/then$/i, (s) => matchCase(s, "than")),
      message: 'Comparisons use "than". "then" is about time or sequence.'
    },
    {
      id: "affect-effect",
      re: /\b(the|an|no|any|little|side|positive|negative|desired)\s+affect\b/gi,
      fix: (m) => m[0].replace(/affect$/i, (s) => matchCase(s, "effect")),
      message: 'As a noun the word is "effect". "affect" is the verb.'
    },
    {
      id: "loose-lose",
      re: /\b(to|will|would|might|could|don't|dont|didn't|didnt)\s+loose\b/gi,
      fix: (m) => m[0].replace(/loose$/i, (s) => matchCase(s, "lose")),
      message: '"loose" means not tight. The verb is "lose".'
    }
  ];
  function checkConfusions(text, isSkipped) {
    const issues = [];
    for (const rule of CONFUSION_RULES) {
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(text)) !== null) {
        const start = m.index;
        const end = start + m[0].length;
        if (isSkipped(start, end)) continue;
        issues.push(
          issue(start, end, text, rule.id, "Confused words", GRAMMAR, rule.message, [rule.fix(m)])
        );
      }
    }
    return issues;
  }
  var AGREEMENT_RULES = [
    {
      id: "there-is-plural",
      re: /\bthere\s+is\s+(\d+|two|three|four|five|six|seven|eight|nine|ten|many|several|multiple|numerous)\b/gi,
      fix: (m) => m[0].replace(/\bis\b/i, (s) => matchCase(s, "are")),
      message: 'A plural subject takes "there are".'
    },
    {
      id: "there-was-plural",
      re: /\bthere\s+was\s+(\d+|two|three|four|five|many|several|multiple)\b/gi,
      fix: (m) => m[0].replace(/\bwas\b/i, (s) => matchCase(s, "were")),
      message: 'A plural subject takes "there were".'
    },
    {
      id: "singular-have",
      re: /\b(he|she|it)\s+have\b/gi,
      fix: (m) => m[0].replace(/have$/i, (s) => matchCase(s, "has")),
      message: 'A singular subject takes "has".'
    },
    {
      id: "plural-has",
      re: /\b(they|we)\s+has\b/gi,
      fix: (m) => m[0].replace(/has$/i, (s) => matchCase(s, "have")),
      message: 'A plural subject takes "have".'
    },
    {
      id: "i-is",
      re: /\bI\s+is\b/g,
      fix: () => "I am",
      message: '"I" takes "am".'
    },
    {
      id: "singular-were",
      re: /\b(he|she|it)\s+were\b/gi,
      fix: (m) => m[0].replace(/were$/i, (s) => matchCase(s, "was")),
      message: 'A singular subject takes "was".'
    }
  ];
  function checkAgreement(text, isSkipped) {
    const issues = [];
    for (const rule of AGREEMENT_RULES) {
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(text)) !== null) {
        const start = m.index;
        const end = start + m[0].length;
        if (isSkipped(start, end)) continue;
        issues.push(
          issue(start, end, text, rule.id, "Agreement", GRAMMAR, rule.message, [rule.fix(m)])
        );
      }
    }
    return issues;
  }
  var WEEKDAYS_MONTHS = /* @__PURE__ */ new Set([
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
    "january",
    "february",
    "march",
    "april",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december"
  ]);
  function checkCapitalization(text, tokens, sentences, skipped) {
    const issues = [];
    const skippedStarts = /* @__PURE__ */ new Set();
    skipped.forEach((reason, index) => {
      if (reason !== "nonword" && reason !== "propernouns") skippedStarts.add(tokens[index].start);
    });
    tokens.forEach((token, index) => {
      if (token.text !== "i") return;
      if (skipped.has(index) && skipped.get(index) !== "propernouns") return;
      if (text[token.end] === ".") return;
      issues.push(
        issue(
          token.start,
          token.end,
          text,
          "lowercase-i",
          "Capitalization",
          MECHANICS,
          'The pronoun "I" is always capitalized.',
          ["I"]
        )
      );
    });
    tokens.forEach((token, index) => {
      if (token.type !== "word") return;
      if (skippedStarts.has(token.start)) return;
      if (!WEEKDAYS_MONTHS.has(token.text)) return;
      issues.push(
        issue(
          token.start,
          token.end,
          text,
          "day-month-caps",
          "Capitalization",
          MECHANICS,
          "Days and months are capitalized.",
          [token.text.charAt(0).toUpperCase() + token.text.slice(1)]
        )
      );
    });
    const firstStarts = firstWordOffsets(tokens, sentences);
    for (const token of tokens) {
      if (!firstStarts.has(token.start)) continue;
      if (skippedStarts.has(token.start)) continue;
      if (!/^[a-z]/.test(token.text)) continue;
      if (token.text === "i") continue;
      issues.push(
        issue(
          token.start,
          token.end,
          text,
          "sentence-caps",
          "Capitalization",
          MECHANICS,
          "Sentences start with a capital letter.",
          [token.text.charAt(0).toUpperCase() + token.text.slice(1)]
        )
      );
    }
    return issues;
  }
  function checkMechanics(text, isSkipped) {
    const issues = [];
    const add = (start, end, ruleId, message, suggestions) => {
      if (isSkipped(start, end)) return;
      issues.push(issue(start, end, text, ruleId, "Mechanics", MECHANICS, message, suggestions));
    };
    const repeated = /\b([A-Za-z]+)([ \t]+)\1\b/gi;
    let m;
    while ((m = repeated.exec(text)) !== null) {
      add(
        m.index,
        m.index + m[0].length,
        "repeated-word",
        `"${m[1]}" is repeated.`,
        [m[1]]
      );
    }
    const spaceBefore = /[ \t]+([,.;:!?])/g;
    while ((m = spaceBefore.exec(text)) !== null) {
      add(
        m.index,
        m.index + m[0].length,
        "space-before-punct",
        "Remove the space before punctuation.",
        [m[1]]
      );
    }
    const missingSpace = /(?<!\d)([.!?,;:])([A-Za-z])/g;
    while ((m = missingSpace.exec(text)) !== null) {
      add(
        m.index,
        m.index + m[0].length,
        "missing-space",
        "Add a space after the punctuation.",
        [`${m[1]} ${m[2]}`]
      );
    }
    const doubleSpace = /(?<=\S)[ ]{2,}(?=\S)/g;
    while ((m = doubleSpace.exec(text)) !== null) {
      add(
        m.index,
        m.index + m[0].length,
        "double-space",
        "Collapse the extra space.",
        [" "]
      );
    }
    const repeatedPunct = /([,;:!?])\1+|\.{4,}/g;
    while ((m = repeatedPunct.exec(text)) !== null) {
      add(
        m.index,
        m.index + m[0].length,
        "repeated-punct",
        "Repeated punctuation.",
        [m[0][0]]
      );
    }
    return issues;
  }

  // src/core/engine.js
  var DEFAULT_CHECK_SETTINGS = {
    spelling: true,
    confusions: true,
    apostrophes: true,
    capitalization: true,
    mechanics: true,
    agreement: true
  };
  var PRIORITY = [
    "Confused words",
    "Agreement",
    "Missing apostrophe",
    "Spelling",
    "Mechanics",
    "Capitalization"
  ];
  function dedupe(issues) {
    const sorted = [...issues].sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      const pa = PRIORITY.indexOf(a.category);
      const pb = PRIORITY.indexOf(b.category);
      if (pa !== pb) return pa - pb;
      return b.end - b.start - (a.end - a.start);
    });
    const kept = [];
    for (const candidate of sorted) {
      const last = kept[kept.length - 1];
      if (last && candidate.start < last.end) continue;
      kept.push(candidate);
    }
    return kept;
  }
  function check(text, settings = {}, verdicts = null) {
    const skipSettings = { ...DEFAULT_SKIP_SETTINGS, ...settings.skip || {} };
    const checkSettings = { ...DEFAULT_CHECK_SETTINGS, ...settings.checks || {} };
    const tokens = tokenize(text);
    const sentences = segmentSentences(text);
    const { skipped, regions } = applySkipRules(text, tokens, sentences, skipSettings);
    const isSkipped = makeSkipPredicate(tokens, skipped, regions);
    const isSkippedForMechanics = makeSkipPredicate(tokens, skipped, regions, ["propernouns"]);
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
      trace: { tokens, sentences, skipped, regions }
    };
  }

  // src/content/spell-client.js
  var MAX_ENTRIES = 5e3;
  var REQUEST_TIMEOUT_MS = 4e3;
  var cache = /* @__PURE__ */ new Map();
  var inFlight = /* @__PURE__ */ new Map();
  function remember(word, verdict) {
    if (cache.has(word)) cache.delete(word);
    cache.set(word, verdict);
    if (cache.size > MAX_ENTRIES) {
      cache.delete(cache.keys().next().value);
    }
  }
  function recall(word) {
    if (!cache.has(word)) return void 0;
    const verdict = cache.get(word);
    cache.delete(word);
    cache.set(word, verdict);
    return verdict;
  }
  function ask(words) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), REQUEST_TIMEOUT_MS);
      try {
        chrome.runtime.sendMessage({ type: "CHECK_WORDS", words }, (response) => {
          clearTimeout(timer);
          if (chrome.runtime.lastError) return resolve(null);
          resolve(response?.verdicts || null);
        });
      } catch {
        clearTimeout(timer);
        resolve(null);
      }
    });
  }
  async function resolveWords(words) {
    const verdicts = {};
    const missing = [];
    for (const word of words) {
      const known = recall(word);
      if (known) verdicts[word] = known;
      else if (!inFlight.has(word)) missing.push(word);
    }
    const joined = words.filter((w) => inFlight.has(w)).map((w) => inFlight.get(w));
    let request = null;
    if (missing.length) {
      request = ask(missing);
      for (const word of missing) inFlight.set(word, request);
    }
    const settled = await Promise.all([request, ...joined].filter(Boolean));
    if (missing.length) for (const word of missing) inFlight.delete(word);
    for (const batch of settled) {
      if (!batch) continue;
      for (const [word, verdict] of Object.entries(batch)) {
        remember(word, verdict);
        verdicts[word] = verdict;
      }
    }
    for (const word of words) {
      if (!verdicts[word]) verdicts[word] = { ok: true, suggestions: [] };
    }
    return verdicts;
  }
  function forget(word) {
    cache.delete(word);
    cache.delete(word.toLowerCase());
  }
  function clearCache() {
    cache.clear();
  }

  // src/core/overlay-geometry.js
  var EPSILON = 1.5;
  function sameLine(a, b) {
    return Math.abs(a.top - b.top) <= EPSILON && Math.abs(a.height - b.height) <= EPSILON;
  }
  function adjacent(a, b) {
    return b.left - (a.left + a.width) <= EPSILON;
  }
  function mergeRects(rects) {
    const usable = rects.filter((r) => r.width > 0 && r.height > 0);
    if (usable.length === 0) return [];
    const sorted = [...usable].sort((a, b) => a.top - b.top || a.left - b.left);
    const merged = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      const current = sorted[i];
      const previous = merged[merged.length - 1];
      if (sameLine(previous, current) && adjacent(previous, current)) {
        const right = Math.max(previous.left + previous.width, current.left + current.width);
        previous.width = right - previous.left;
        previous.height = Math.max(previous.height, current.height);
      } else {
        merged.push({ ...current });
      }
    }
    return merged;
  }
  function clipToContainer(box, container) {
    const left = Math.max(box.left, container.left);
    const top = Math.max(box.top, container.top);
    const right = Math.min(box.left + box.width, container.left + container.width);
    const bottom = Math.min(box.top + box.height, container.top + container.height);
    if (right <= left || bottom <= top) return null;
    return { left, top, width: right - left, height: bottom - top };
  }
  function rectsToBoxes(clientRects, containerRect, options = {}) {
    const { clip = true, minWidth = 1, underlineInset = 0 } = options;
    const merged = mergeRects(clientRects);
    const boxes = [];
    for (const rect of merged) {
      const clipped = clip ? clipToContainer(rect, containerRect) : rect;
      if (!clipped) continue;
      if (clipped.width < minWidth) continue;
      boxes.push({
        left: clipped.left - containerRect.left,
        top: clipped.top - containerRect.top,
        width: clipped.width,
        height: Math.max(clipped.height - underlineInset, 1)
      });
    }
    return boxes;
  }
  function positionCard(anchor, card, viewport, gap = 6) {
    const belowTop = anchor.top + anchor.height + gap;
    const aboveTop = anchor.top - card.height - gap;
    const fitsBelow = belowTop + card.height <= viewport.height;
    const fitsAbove = aboveTop >= 0;
    const placement = fitsBelow || !fitsAbove ? "below" : "above";
    let top = placement === "below" ? belowTop : aboveTop;
    top = Math.max(0, Math.min(top, Math.max(0, viewport.height - card.height)));
    let left = anchor.left;
    left = Math.min(left, viewport.width - card.width - gap);
    left = Math.max(gap, left);
    return { left, top, placement };
  }

  // src/content/adapters/plain.js
  var COPIED_STYLES = [
    "boxSizing",
    "width",
    "height",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "fontVariant",
    "letterSpacing",
    "wordSpacing",
    "lineHeight",
    "textIndent",
    "textTransform",
    "textAlign",
    "whiteSpace",
    "wordBreak",
    "overflowWrap",
    "tabSize",
    "direction"
  ];
  function createPlainAdapter(element) {
    let mirror = null;
    function ensureMirror() {
      if (mirror) return mirror;
      mirror = document.createElement("div");
      mirror.setAttribute("aria-hidden", "true");
      Object.assign(mirror.style, {
        position: "fixed",
        visibility: "hidden",
        pointerEvents: "none",
        overflow: "hidden",
        zIndex: "-1",
        margin: "0",
        // A textarea always wraps; an input never does.
        whiteSpace: element.tagName === "INPUT" ? "pre" : "pre-wrap",
        overflowWrap: "break-word"
      });
      document.body.appendChild(mirror);
      return mirror;
    }
    function syncMirror(text, start, end) {
      const node = ensureMirror();
      const computed = getComputedStyle(element);
      for (const property of COPIED_STYLES) node.style[property] = computed[property];
      const box = element.getBoundingClientRect();
      node.style.left = `${box.left}px`;
      node.style.top = `${box.top}px`;
      node.style.width = `${box.width}px`;
      node.style.height = `${box.height}px`;
      node.textContent = "";
      node.appendChild(document.createTextNode(text.slice(0, start)));
      const marker = document.createElement("span");
      marker.textContent = text.slice(start, end);
      node.appendChild(marker);
      node.appendChild(document.createTextNode(text.slice(end) + "\u200B"));
      node.scrollTop = element.scrollTop;
      node.scrollLeft = element.scrollLeft;
      return marker;
    }
    return {
      element,
      kind: "plain",
      getText() {
        return element.value;
      },
      getContainerRect() {
        return element.getBoundingClientRect();
      },
      /** @returns {Array<{left:number,top:number,width:number,height:number}>} viewport coords */
      getRects(start, end) {
        const marker = syncMirror(element.value, start, end);
        return Array.from(marker.getClientRects()).map((r) => ({
          left: r.left,
          top: r.top,
          width: r.width,
          height: r.height
        }));
      },
      getBoxes(start, end, options) {
        return rectsToBoxes(this.getRects(start, end), this.getContainerRect(), options);
      },
      /**
       * Replace a range and restore the caret. `setRangeText` is used rather
       * than rebuilding `.value` because it preserves the field's native undo
       * stack — rewriting the value wholesale destroys it.
       */
      replaceRange(start, end, replacement) {
        const caret = start + replacement.length;
        if (typeof element.setRangeText === "function") {
          element.setRangeText(replacement, start, end, "end");
        } else {
          element.value = element.value.slice(0, start) + replacement + element.value.slice(end);
        }
        element.setSelectionRange(caret, caret);
        element.focus();
        element.dispatchEvent(new Event("input", { bubbles: true }));
      },
      destroy() {
        if (mirror) mirror.remove();
        mirror = null;
      }
    };
  }

  // src/content/adapters/rich.js
  var BLOCK_SELECTOR = "div,p,li,blockquote,tr,h1,h2,h3,h4,h5,h6,pre";
  function flatten(root) {
    const entries = [];
    let text = "";
    let lastBlock = null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let node;
    while (node = walker.nextNode()) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.tagName === "BR" && text.length && !text.endsWith("\n")) text += "\n";
        continue;
      }
      if (node.parentElement?.closest('[contenteditable="false"]')) continue;
      const block = node.parentElement?.closest(BLOCK_SELECTOR) || root;
      if (lastBlock && block !== lastBlock && text.length && !text.endsWith("\n")) text += "\n";
      lastBlock = block;
      entries.push({ node, start: text.length, end: text.length + node.nodeValue.length });
      text += node.nodeValue;
    }
    return { text, entries };
  }
  function rangeFor(entries, start, end) {
    const from = entries.find((e) => start >= e.start && start < e.end);
    const to = entries.find((e) => end > e.start && end <= e.end);
    if (!from || !to) return null;
    const range = document.createRange();
    range.setStart(from.node, start - from.start);
    range.setEnd(to.node, end - to.start);
    return range;
  }
  function createRichAdapter(element) {
    let snapshot = { text: "", entries: [] };
    function refresh() {
      snapshot = flatten(element);
      return snapshot;
    }
    return {
      element,
      kind: "rich",
      getText() {
        return refresh().text;
      },
      /**
       * Re-read the DOM without re-running any checks.
       *
       * The paint loop must call this before measuring. Quill's Parchment and
       * RoosterJS both rebuild nodes inside the editable root as a matter of
       * course — Parchment will `replaceChild` anything it cannot resolve to a
       * registered blot, and RoosterJS replaces whole changed blocks. A cached
       * text node from the previous tick may therefore be detached, in which
       * case its Range measures nothing and underlines vanish silently.
       */
      sync() {
        return refresh();
      },
      getContainerRect() {
        return element.getBoundingClientRect();
      },
      getRects(start, end) {
        const range = rangeFor(snapshot.entries, start, end);
        if (!range) return [];
        return Array.from(range.getClientRects()).map((r) => ({
          left: r.left,
          top: r.top,
          width: r.width,
          height: r.height
        }));
      },
      getBoxes(start, end, options) {
        return rectsToBoxes(this.getRects(start, end), this.getContainerRect(), options);
      },
      /**
       * Replace a range, guarding against a stale suggestion.
       *
       * The card can sit open while the user keeps typing. By the time a fix is
       * applied the offsets may name completely different text, and applying it
       * blindly would corrupt what they wrote (spec §data flow, stale results).
       *
       * @param {string} expected the text the suggestion was generated for
       * @returns {boolean} false when the fix was refused as stale
       */
      replaceRange(start, end, replacement, expected) {
        const { text, entries } = refresh();
        if (expected != null && text.slice(start, end) !== expected) return false;
        const range = rangeFor(entries, start, end);
        if (!range) return false;
        const selection = window.getSelection();
        range.deleteContents();
        const inserted = document.createTextNode(replacement);
        range.insertNode(inserted);
        const caret = document.createRange();
        caret.setStart(inserted, inserted.length);
        caret.collapse(true);
        selection.removeAllRanges();
        selection.addRange(caret);
        element.normalize();
        element.dispatchEvent(new Event("input", { bubbles: true }));
        refresh();
        return true;
      },
      destroy() {
        snapshot = { text: "", entries: [] };
      }
    };
  }

  // src/content/overlay.js
  var LAYER_CLASS = "graimmer-layer";
  var MARK_CLASS = "graimmer-mark";
  function createOverlay(adapter, { onMarkClick }) {
    const layer = document.createElement("div");
    layer.className = LAYER_CLASS;
    layer.setAttribute("aria-hidden", "true");
    document.body.appendChild(layer);
    let painted = [];
    layer.addEventListener("mousedown", (event) => {
      const mark = event.target.closest(`.${MARK_CLASS}`);
      if (!mark) return;
      event.preventDefault();
      event.stopPropagation();
      const issue2 = painted[Number(mark.dataset.index)];
      if (issue2) onMarkClick(issue2, mark.getBoundingClientRect());
    });
    function clear() {
      layer.textContent = "";
    }
    function paint2(issues) {
      painted = issues;
      clear();
      const container = adapter.getContainerRect();
      if (container.width === 0 || container.height === 0) return;
      Object.assign(layer.style, {
        left: `${container.left}px`,
        top: `${container.top}px`,
        width: `${container.width}px`,
        height: `${container.height}px`
      });
      const fragment = document.createDocumentFragment();
      issues.forEach((issue2, index) => {
        const boxes = adapter.getBoxes(issue2.start, issue2.end, {
          clip: true,
          // An issue split across two lines produces two boxes, both tagged
          // with the same issue index so either one opens the same card.
          minWidth: 1
        });
        for (const box of boxes) {
          const mark = document.createElement("span");
          mark.className = MARK_CLASS;
          mark.dataset.index = String(index);
          mark.dataset.severity = issue2.severity;
          Object.assign(mark.style, {
            left: `${box.left}px`,
            top: `${box.top}px`,
            width: `${box.width}px`,
            height: `${box.height}px`
          });
          fragment.appendChild(mark);
        }
      });
      layer.appendChild(fragment);
    }
    function hide() {
      layer.style.display = "none";
    }
    function show() {
      layer.style.display = "";
    }
    function destroy() {
      layer.remove();
      painted = [];
    }
    return { paint: paint2, clear, hide, show, destroy, get issues() {
      return painted;
    } };
  }

  // src/content/card.js
  var CARD_WIDTH = 268;
  function createCard({ onApply, onIgnore, onAddWord }) {
    let element = null;
    let current = null;
    function close() {
      if (element) element.remove();
      element = null;
      current = null;
    }
    function open(issue2, anchorRect) {
      close();
      current = issue2;
      element = document.createElement("div");
      element.className = "graimmer-card";
      element.dataset.severity = issue2.severity;
      const head = document.createElement("div");
      head.className = "graimmer-card-head";
      head.textContent = issue2.category;
      element.appendChild(head);
      const message = document.createElement("div");
      message.className = "graimmer-card-msg";
      message.textContent = issue2.message;
      element.appendChild(message);
      if (issue2.suggestions.length === 0) {
        const none = document.createElement("div");
        none.className = "graimmer-card-none";
        none.textContent = "No suggestion available.";
        element.appendChild(none);
      }
      for (const suggestion of issue2.suggestions) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "graimmer-card-fix";
        button.textContent = suggestion;
        button.addEventListener("click", () => {
          const applied = onApply(issue2, suggestion);
          close();
          if (applied === false) {
            flash("Text changed \u2014 re-checking");
          }
        });
        element.appendChild(button);
      }
      const foot = document.createElement("div");
      foot.className = "graimmer-card-foot";
      const ignore = document.createElement("button");
      ignore.type = "button";
      ignore.textContent = "Ignore";
      ignore.addEventListener("click", () => {
        onIgnore(issue2);
        close();
      });
      foot.appendChild(ignore);
      if (issue2.severity === "spelling") {
        const add = document.createElement("button");
        add.type = "button";
        add.textContent = "Add to dictionary";
        add.addEventListener("click", () => {
          onAddWord(issue2);
          close();
        });
        foot.appendChild(add);
      }
      element.appendChild(foot);
      document.body.appendChild(element);
      const height = element.offsetHeight;
      const placement = positionCard(
        anchorRect,
        { width: CARD_WIDTH, height },
        { width: window.innerWidth, height: window.innerHeight }
      );
      element.style.left = `${placement.left}px`;
      element.style.top = `${placement.top}px`;
      const firstFix = element.querySelector(".graimmer-card-fix");
      if (firstFix) firstFix.focus({ preventScroll: true });
    }
    function flash(text) {
      const note = document.createElement("div");
      note.className = "graimmer-toast";
      note.textContent = text;
      document.body.appendChild(note);
      setTimeout(() => note.remove(), 2200);
    }
    document.addEventListener("mousedown", (event) => {
      if (element && !element.contains(event.target)) close();
    }, true);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && element) close();
    }, true);
    return { open, close, get issue() {
      return current;
    } };
  }

  // src/content/badge.js
  var SEVERITY_ORDER = { spelling: 0, grammar: 1, mechanics: 2 };
  function createBadge({ onSelect }) {
    const badge = document.createElement("button");
    badge.type = "button";
    badge.className = "graimmer-badge";
    badge.hidden = true;
    document.body.appendChild(badge);
    const panel = document.createElement("div");
    panel.className = "graimmer-panel";
    panel.hidden = true;
    document.body.appendChild(panel);
    let issues = [];
    let anchorRect = null;
    badge.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      panel.hidden ? openPanel() : closePanel();
    });
    function closePanel() {
      panel.hidden = true;
    }
    function openPanel() {
      panel.textContent = "";
      const head = document.createElement("div");
      head.className = "graimmer-panel-head";
      head.textContent = issues.length === 1 ? "1 issue" : `${issues.length} issues`;
      panel.appendChild(head);
      const ordered = [...issues].sort(
        (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) || a.start - b.start
      );
      for (const issue2 of ordered) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "graimmer-panel-row";
        row.dataset.severity = issue2.severity;
        const category = document.createElement("span");
        category.className = "graimmer-panel-cat";
        category.textContent = issue2.category;
        const change = document.createElement("span");
        change.className = "graimmer-panel-change";
        const from = document.createElement("s");
        from.textContent = issue2.original;
        change.appendChild(from);
        if (issue2.suggestions.length) {
          change.appendChild(document.createTextNode(" \u2192 "));
          const to = document.createElement("strong");
          to.textContent = issue2.suggestions[0];
          change.appendChild(to);
        }
        row.append(category, change);
        row.addEventListener("mousedown", (event) => {
          event.preventDefault();
          event.stopPropagation();
          closePanel();
          onSelect(issue2);
        });
        panel.appendChild(row);
      }
      panel.hidden = false;
      position();
    }
    function position() {
      if (!anchorRect) return;
      const offscreen = anchorRect.bottom <= 0 || anchorRect.top >= window.innerHeight || anchorRect.right <= 0 || anchorRect.left >= window.innerWidth || anchorRect.width === 0 || anchorRect.height === 0;
      if (offscreen) {
        badge.hidden = true;
        closePanel();
        return;
      }
      badge.hidden = false;
      const badgeWidth = badge.offsetWidth || 74;
      const badgeHeight = badge.offsetHeight || 22;
      const left = anchorRect.left + anchorRect.width - badgeWidth - 8;
      const top = anchorRect.top + anchorRect.height - badgeHeight - 8;
      badge.style.left = `${left}px`;
      badge.style.top = `${top}px`;
      if (panel.hidden) return;
      const panelHeight = panel.offsetHeight;
      const panelWidth = panel.offsetWidth;
      const above = top - panelHeight - 6;
      panel.style.top = `${above >= 4 ? above : Math.max(4, Math.min(top + 30, window.innerHeight - panelHeight - 4))}px`;
      panel.style.left = `${Math.max(4, Math.min(left + badgeWidth - panelWidth, window.innerWidth - panelWidth - 4))}px`;
    }
    function update(nextIssues, rect) {
      issues = nextIssues;
      anchorRect = rect;
      if (!issues.length) {
        badge.hidden = true;
        closePanel();
        return;
      }
      badge.textContent = issues.length === 1 ? "1 issue" : `${issues.length} issues`;
      badge.setAttribute("aria-label", `${issues.length} writing issues. Show list.`);
      if (!panel.hidden) openPanel();
      else position();
    }
    function hide() {
      badge.hidden = true;
      closePanel();
    }
    function destroy() {
      badge.remove();
      panel.remove();
      issues = [];
    }
    document.addEventListener("mousedown", (event) => {
      if (panel.hidden) return;
      if (panel.contains(event.target) || badge.contains(event.target)) return;
      closePanel();
    }, true);
    return { update, position, hide, destroy };
  }

  // src/content/site-profiles.js
  var IGNORE_DATA_GRAMM_BY_DEFAULT = true;
  var PROFILES = [
    {
      id: "gmail",
      tier: 1,
      match: /(^|\.)mail\.google\.com$/,
      // Top-level document. The old `canvas_frame` iframe was retired around
      // 2013; plain-text compose uses this same element.
      editableSelector: 'div[role="textbox"][g_editable="true"], div[role="textbox"][contenteditable="true"]',
      // Gmail rewrites attributes on the compose node constantly. Observing
      // attribute mutations here produces an endless re-check loop.
      observeAttributes: false,
      notes: "native contenteditable + execCommand, no model layer"
    },
    {
      id: "outlook",
      tier: 1,
      match: /(^|\.)(outlook\.(live|office|office365)\.com|outlook\.com)$/,
      editableSelector: 'div[contenteditable="true"][role="textbox"], div[contenteditable="true"][aria-multiline="true"]',
      observeAttributes: false,
      // RoosterJS replaces whole changed blocks and deletes nodes that are not
      // part of its content model. Re-resolve everything each tick.
      volatileDom: true,
      notes: "RoosterJS content model"
    },
    {
      id: "github",
      tier: 1,
      match: /(^|\.)github\.com$/,
      editableSelector: "textarea",
      observeAttributes: false,
      notes: "plain textarea - the control case"
    },
    {
      id: "slack",
      tier: 2,
      match: /(^|\.)slack\.com$/,
      // `.ql-clipboard` is an off-screen paste trap and the multi-select input
      // is the recipient picker. Both are contenteditable and neither is a
      // message composer.
      editableSelector: '[data-qa="message_input"] .ql-editor[contenteditable="true"]',
      excludeSelector: ".ql-clipboard, .c-multi_select_input__input",
      observeAttributes: false,
      volatileDom: true,
      // Chat register: sentence-case warnings are noise here (spec §3.3).
      checks: { capitalization: false },
      notes: "Quill 1.3.7 - Parchment replaceChild()s foreign nodes"
    },
    {
      id: "linkedin",
      tier: 2,
      match: /(^|\.)linkedin\.com$/,
      editableSelector: 'div[contenteditable="true"][role="textbox"], .ql-editor[contenteditable="true"]',
      excludeSelector: ".ql-clipboard",
      observeAttributes: false,
      volatileDom: true,
      // Post composer is Quill 2.x. The DM composer engine is UNVERIFIED - it is
      // contenteditable with ARIA, but do not assume Quill.
      notes: "Quill 2.x (post composer); DM composer unverified"
    }
  ];
  var IMPOSSIBLE = [
    {
      match: /(^|\.)docs\.google\.com$/,
      reason: "Google Docs paints text to <canvas>. Reaching it requires setting window._docs_annotate_canvas_by_ext from a MAIN-world script and reading SVG rect[aria-label] nodes, which is out of scope for Phase 1 (spec D7)."
    }
  ];
  var CODE_EDITOR_ANCESTORS = '.monaco-editor, .cm-editor, .CodeMirror, .ace_editor, [data-mode-id], [role="code"], pre[contenteditable]';
  var DEFAULT_PROFILE = {
    id: "default",
    tier: 3,
    editableSelector: 'textarea, input[type="text"], input[type="search"], input[type="email"], input:not([type]), div[contenteditable="true"], div[contenteditable=""]',
    excludeSelector: '[aria-hidden="true"]',
    observeAttributes: false,
    volatileDom: false,
    notes: "best effort"
  };
  function profileForHost(host = location.hostname) {
    return PROFILES.find((profile2) => profile2.match.test(host)) || DEFAULT_PROFILE;
  }
  function impossibleForHost(host = location.hostname) {
    return IMPOSSIBLE.find((entry) => entry.match.test(host)) || null;
  }

  // src/content/index.js
  var DEBOUNCE_MS = 500;
  var MAX_FIELD_LENGTH = 1e5;
  var FALLBACK_SETTINGS = {
    enabled: true,
    skip: { urls: true, identifiers: true, quoted: true, signature: true, propernouns: true, code: true },
    checks: { spelling: true, confusions: true, apostrophes: true, capitalization: true, mechanics: true, agreement: true },
    sites: {},
    disabledOrigins: []
  };
  var profile = profileForHost();
  var impossible = impossibleForHost();
  var config = { settings: null, words: [] };
  var active = null;
  var version = 0;
  var configLoaded = false;
  var pendingElement = null;
  async function loadConfig() {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "GET_CONFIG" }, (response) => {
          if (chrome.runtime.lastError || !response) return resolve(null);
          resolve(response);
        });
      } catch {
        resolve(null);
      }
    });
  }
  function settingsForCheck() {
    const base = config.settings;
    if (!base) return {};
    const override = base.sites?.[location.origin] || {};
    return {
      skip: { ...base.skip, ...override.skip || {} },
      checks: { ...base.checks, ...profile.checks || {}, ...override.checks || {} }
    };
  }
  function enabledHere() {
    if (!configLoaded) return false;
    if (!config.settings?.enabled) return false;
    if (config.settings.disabledOrigins?.includes(location.origin)) return false;
    return true;
  }
  function isEditable(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    if (profile.excludeSelector && element.matches(profile.excludeSelector)) return false;
    if (element.closest('[aria-hidden="true"]')) return false;
    if (element.closest(CODE_EDITOR_ANCESTORS)) return false;
    if (!IGNORE_DATA_GRAMM_BY_DEFAULT && element.closest('[data-gramm="false"]')) return false;
    if (element.matches("textarea")) return !element.disabled && !element.readOnly;
    if (element.matches("input")) {
      const type = (element.getAttribute("type") || "text").toLowerCase();
      if (!["text", "search", "email", ""].includes(type)) return false;
      return !element.disabled && !element.readOnly;
    }
    const attr = element.getAttribute("contenteditable");
    return attr === "" || attr === "true" || attr === "plaintext-only";
  }
  function makeAdapter(element) {
    const plain = element.matches("textarea, input");
    return plain ? createPlainAdapter(element) : createRichAdapter(element);
  }
  function detach() {
    if (!active) return;
    active.observer?.disconnect();
    active.resizeObserver?.disconnect();
    active.overlay.destroy();
    active.badge.destroy();
    active.adapter.destroy();
    clearTimeout(active.timer);
    active = null;
  }
  function attach(element) {
    if (active?.element === element) return;
    detach();
    const adapter = makeAdapter(element);
    const card = createCard({
      onApply: (issue2, suggestion) => applyFix(issue2, suggestion),
      onIgnore: (issue2) => ignoreIssue(issue2),
      onAddWord: (issue2) => addWord(issue2)
    });
    const overlay = createOverlay(adapter, {
      onMarkClick: (issue2, rect) => card.open(issue2, rect)
    });
    const badge = createBadge({
      onSelect: (issue2) => {
        const boxes = adapter.getBoxes(issue2.start, issue2.end, { clip: true });
        const container = adapter.getContainerRect();
        const anchor = boxes.length ? {
          left: container.left + boxes[0].left,
          top: container.top + boxes[0].top,
          width: boxes[0].width,
          height: boxes[0].height
        } : container;
        card.open(issue2, anchor);
      }
    });
    active = {
      element,
      adapter,
      overlay,
      card,
      badge,
      timer: null,
      issues: [],
      ignored: /* @__PURE__ */ new Set(),
      raf: null,
      observer: null,
      resizeObserver: null
    };
    const observer = new MutationObserver(() => schedulePaint());
    observer.observe(element, { childList: true, subtree: true, characterData: true });
    active.observer = observer;
    const resizeObserver = new ResizeObserver(() => schedulePaint());
    resizeObserver.observe(element);
    active.resizeObserver = resizeObserver;
    runCheck();
  }
  function scheduleCheck() {
    if (!active) return;
    active.card.close();
    clearTimeout(active.timer);
    active.timer = setTimeout(runCheck, DEBOUNCE_MS);
  }
  async function runCheck() {
    if (!active || !enabledHere()) return;
    const pass = ++version;
    const text = active.adapter.getText();
    if (text.length > MAX_FIELD_LENGTH) return;
    const settings = settingsForCheck();
    const first = check(text, settings);
    if (pass !== version) return;
    paint(filterIgnored(first.issues));
    if (!settings.checks?.spelling || first.candidates.length === 0) return;
    const verdicts = await resolveWords(first.candidates);
    if (pass !== version || !active) return;
    const second = check(text, settings, verdicts);
    paint(filterIgnored(second.issues));
  }
  function filterIgnored(issues) {
    if (!active?.ignored.size) return issues;
    return issues.filter((issue2) => !active.ignored.has(ignoreKey(issue2)));
  }
  function ignoreKey(issue2) {
    return `${issue2.ruleId}:${issue2.original}`;
  }
  function paint(issues) {
    if (!active) return;
    if (!active.element.isConnected) {
      detach();
      return;
    }
    active.issues = issues;
    active.adapter.sync?.();
    active.overlay.paint(issues);
    active.badge.update(issues, active.adapter.getContainerRect());
  }
  function schedulePaint() {
    if (!active || active.raf) return;
    active.raf = requestAnimationFrame(() => {
      if (!active) return;
      active.raf = null;
      if (!active.element.isConnected) {
        detach();
        return;
      }
      active.adapter.sync?.();
      active.overlay.paint(active.issues);
      active.badge.update(active.issues, active.adapter.getContainerRect());
    });
  }
  function applyFix(issue2, suggestion) {
    if (!active) return false;
    const applied = active.adapter.replaceRange(
      issue2.start,
      issue2.end,
      suggestion,
      issue2.original
    );
    if (applied === false) {
      runCheck();
      return false;
    }
    runCheck();
    return true;
  }
  function ignoreIssue(issue2) {
    if (!active) return;
    active.ignored.add(ignoreKey(issue2));
    paint(filterIgnored(active.issues));
  }
  function addWord(issue2) {
    const word = issue2.original;
    forget(word);
    try {
      chrome.runtime.sendMessage({ type: "ADD_WORD", word }, (response) => {
        if (chrome.runtime.lastError || !response) return;
        config.words = response.words || config.words;
        runCheck();
      });
    } catch {
    }
  }
  function shouldAttach(element) {
    if (!isEditable(element)) return false;
    if (profile.tier > 2) return true;
    if (element.matches("textarea, input")) return true;
    return Boolean(profile.editableSelector) && element.matches(profile.editableSelector);
  }
  document.addEventListener("focusin", (event) => {
    if (!shouldAttach(event.target)) return;
    if (!configLoaded) {
      pendingElement = event.target;
      return;
    }
    if (!enabledHere()) return;
    attach(event.target);
  }, true);
  document.addEventListener("focusout", (event) => {
    if (!active || event.target !== active.element) return;
    const next = event.relatedTarget;
    if (next && typeof next.closest === "function" && next.closest(".graimmer-card")) return;
    if (document.activeElement?.closest?.(".graimmer-card")) return;
    active.card.close();
  }, true);
  document.addEventListener("input", (event) => {
    if (active && event.target === active.element) scheduleCheck();
  }, true);
  window.addEventListener("scroll", schedulePaint, true);
  window.addEventListener("resize", schedulePaint);
  chrome.storage?.onChanged?.addListener(async (changes) => {
    if (Object.keys(changes).some((key) => key.startsWith("words:"))) clearCache();
    const next = await loadConfig();
    if (next) {
      config = next;
      runCheck();
    }
  });
  (async function boot() {
    if (impossible) {
      console.info(`[grAImmer] inactive on this site: ${impossible.reason}`);
      return;
    }
    const loaded = await loadConfig();
    if (loaded) config = loaded;
    if (!config.settings) config = { settings: { ...FALLBACK_SETTINGS }, words: [] };
    configLoaded = true;
    const candidate = pendingElement || document.activeElement;
    pendingElement = null;
    if (candidate && enabledHere() && shouldAttach(candidate)) attach(candidate);
  })();
})();
