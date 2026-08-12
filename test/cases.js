/**
 * Test cases for the pure core.
 *
 * Two kinds, and the second kind is the more important one:
 *
 *   expect      — these issues MUST be found (recall)
 *   expectNone  — this text must produce NO issue at all (precision)
 *
 * Precision cases are where a rule-based checker lives or dies. Any pattern
 * can be made to catch more; the work is catching more without becoming
 * noise. Every time a rule is widened, add the false-positive case that
 * pins down how far it may go.
 */

export const CASES = [
  /* -------------------------------------------------- tokenizer */
  {
    id: 'tok-offsets',
    group: 'Tokenizer',
    text: 'Hello world',
    assert: (r) => {
      const t = r.trace.tokens;
      return t.length === 2 && t[0].start === 0 && t[0].end === 5 && t[1].start === 6 && t[1].end === 11;
    },
    describe: 'token offsets index back into the source string exactly',
  },
  {
    id: 'tok-url-single',
    group: 'Tokenizer',
    text: 'See grafana.acme.io/d/x8f2 for logs',
    assert: (r) => r.trace.tokens.some((t) => t.type === 'url' && t.text === 'grafana.acme.io/d/x8f2'),
    describe: 'a URL is one token, not nine',
  },
  {
    id: 'tok-email-single',
    group: 'Tokenizer',
    text: 'Mail imranqureshi856@hotmail.com today',
    assert: (r) => r.trace.tokens.some((t) => t.type === 'email'),
    describe: 'an email address is one token',
  },
  {
    id: 'tok-abbrev-not-sentence',
    group: 'Tokenizer',
    text: 'Ask Dr. Smith about it.',
    assert: (r) => r.trace.sentences.length === 1,
    describe: '"Dr." does not end a sentence',
  },
  {
    id: 'tok-eg-not-sentence',
    group: 'Tokenizer',
    text: 'Use a tool, e.g. Grafana, for this.',
    assert: (r) => r.trace.sentences.length === 1,
    describe: '"e.g." does not end a sentence',
  },
  {
    id: 'tok-newline-sentence',
    group: 'Tokenizer',
    text: 'Hi Sarah\nThanks for the note.',
    assert: (r) => r.trace.sentences.length === 2,
    describe: 'a line break ends a sentence even without punctuation',
  },

  /* -------------------------------------------------- skip rules */
  {
    id: 'skip-url',
    group: 'Skip rules',
    text: 'The logs are at grafana.acme.io/d/x8f2 now',
    expectNone: true,
    describe: 'URLs are never spell-checked',
  },
  {
    id: 'skip-identifier',
    group: 'Skip rules',
    text: 'Ticket INFRA-4471 is open',
    expectNone: true,
    describe: 'identifiers with digits are skipped',
  },
  {
    id: 'skip-allcaps',
    group: 'Skip rules',
    text: 'The API and the SLA are agreed',
    expectNone: true,
    describe: 'ALL-CAPS acronyms are skipped',
  },
  {
    id: 'skip-proper-noun',
    group: 'Skip rules',
    text: 'Ping Sarah about the Kubernetes migration',
    expectNone: true,
    describe: 'capitalized words mid-sentence are treated as proper nouns',
  },
  {
    id: 'skip-quoted',
    group: 'Skip rules',
    text: 'Sounds good.\n> i think there is 3 items\n> please confirm',
    expectNone: true,
    describe: 'quoted reply history is not checked — you cannot fix it',
  },
  {
    id: 'skip-attribution',
    group: 'Skip rules',
    text: 'Will do.\nOn Mon, 3 Mar 2026, Sarah wrote:\ni dont think there is 3 items',
    expectNone: true,
    describe: 'everything after "... wrote:" is quoted history',
  },
  {
    id: 'skip-signature',
    group: 'Skip rules',
    text: 'Thanks for the update.\n--\ni am the sender\nacme corp',
    expectNone: true,
    describe: 'the signature block is not checked',
  },
  {
    id: 'skip-code',
    group: 'Skip rules',
    text: 'Run `npm i  dont` to install',
    expectNone: true,
    describe: 'inline code is not checked',
  },
  {
    id: 'skip-sentence-start-still-checked',
    group: 'Skip rules',
    text: 'monday works for me',
    expect: [{ ruleId: 'day-month-caps' }],
    describe: 'the proper-noun skip does not hide a lowercase weekday',
  },

  /* -------------------------------------------------- apostrophes */
  {
    id: 'apos-dont',
    group: 'Apostrophes',
    text: 'I dont think so',
    expect: [{ ruleId: 'apostrophe', original: 'dont', suggestion: "don't" }],
    describe: 'dont -> don\'t',
  },
  {
    id: 'apos-case',
    group: 'Apostrophes',
    text: 'Dont do that',
    expect: [{ ruleId: 'apostrophe', suggestion: "Don't" }],
    describe: 'capitalization is preserved in the suggestion',
  },
  {
    id: 'apos-not-ambiguous-words',
    group: 'Apostrophes',
    text: 'The well is deep and were going now and ill see you',
    assert: (r) => !r.issues.some((i) => i.ruleId === 'apostrophe'),
    describe: 'well / were / ill are real words and must not be flagged',
  },

  /* -------------------------------------------------- confusions */
  {
    id: 'conf-your-welcome',
    group: 'Confused words',
    text: 'Thanks, your welcome to join',
    expect: [{ ruleId: 'your-youre', suggestion: "you're welcome" }],
    describe: 'your welcome -> you\'re welcome',
  },
  {
    id: 'conf-your-possessive-ok',
    group: 'Confused words',
    text: 'Thanks for your patience and your report',
    expectNone: true,
    describe: 'legitimate possessive "your" is not flagged',
  },
  {
    id: 'conf-its-a',
    group: 'Confused words',
    text: 'its a good plan',
    expect: [{ ruleId: 'its-it-is' }],
    describe: 'its a -> it\'s a',
  },
  {
    id: 'conf-its-possessive-ok',
    group: 'Confused words',
    text: 'The team changed its process and its structure',
    expectNone: true,
    describe: 'possessive "its" is correct and must stay quiet',
  },
  {
    id: 'conf-to-many',
    group: 'Confused words',
    text: 'There are to many meetings',
    expect: [{ ruleId: 'to-many' }, { ruleId: 'to-too' }],
    matchAny: true,
    describe: 'to many -> too many',
  },
  {
    id: 'conf-to-infinitive-ok',
    group: 'Confused words',
    text: 'I want to discuss the report and to review it',
    expectNone: true,
    describe: 'infinitive "to" is not flagged',
  },
  {
    id: 'conf-more-then',
    group: 'Confused words',
    text: 'This took more then an hour',
    expect: [{ ruleId: 'then-than' }],
    describe: 'more then -> more than',
  },
  {
    id: 'conf-then-time-ok',
    group: 'Confused words',
    text: 'We reviewed it and then sent it',
    expectNone: true,
    describe: 'temporal "then" is not flagged',
  },
  {
    id: 'conf-their-is',
    group: 'Confused words',
    text: 'their is a problem here',
    expect: [{ ruleId: 'their-there' }],
    describe: 'their is -> there is',
  },

  /* -------------------------------------------------- agreement */
  {
    id: 'agr-there-is-number',
    group: 'Agreement',
    text: 'There is 3 items to review',
    expect: [{ ruleId: 'there-is-plural', suggestion: 'There are 3' }],
    describe: 'there is 3 -> there are 3',
  },
  {
    id: 'agr-there-is-singular-ok',
    group: 'Agreement',
    text: 'There is a problem with the report',
    expectNone: true,
    describe: 'singular "there is" is correct',
  },
  {
    id: 'agr-he-have',
    group: 'Agreement',
    text: 'He have already replied',
    expect: [{ ruleId: 'singular-have', suggestion: 'He has' }],
    describe: 'he have -> he has',
  },
  {
    id: 'agr-they-have-ok',
    group: 'Agreement',
    text: 'They have already replied',
    expectNone: true,
    describe: 'plural "they have" is correct',
  },

  /* -------------------------------------------------- capitalization */
  {
    id: 'cap-standalone-i',
    group: 'Capitalization',
    text: 'Yesterday i sent the report',
    expect: [{ ruleId: 'lowercase-i', suggestion: 'I' }],
    describe: 'standalone "i" -> "I"',
  },
  {
    id: 'cap-ie-not-flagged',
    group: 'Capitalization',
    text: 'Use a tool, i.e. Grafana, for this',
    assert: (r) => !r.issues.some((i) => i.ruleId === 'lowercase-i'),
    describe: 'the "i" in "i.e." is not the pronoun',
  },
  {
    id: 'cap-sentence-start',
    group: 'Capitalization',
    text: 'The report is ready. please review it.',
    expect: [{ ruleId: 'sentence-caps', suggestion: 'Please' }],
    describe: 'sentences start with a capital',
  },
  {
    id: 'cap-weekday',
    group: 'Capitalization',
    text: 'I will send it on monday',
    expect: [{ ruleId: 'day-month-caps', suggestion: 'Monday' }],
    describe: 'weekdays are capitalized',
  },
  {
    id: 'cap-may-not-flagged',
    group: 'Capitalization',
    text: 'This may be the right approach',
    expectNone: true,
    describe: '"may" as an ordinary verb is not treated as a month',
  },

  /* -------------------------------------------------- mechanics */
  {
    id: 'mech-repeated',
    group: 'Mechanics',
    text: 'Let me know the the date',
    expect: [{ ruleId: 'repeated-word', suggestion: 'the' }],
    describe: 'repeated word is caught',
  },
  {
    id: 'mech-space-before-comma',
    group: 'Mechanics',
    text: 'Confirm the date , then send it',
    expect: [{ ruleId: 'space-before-punct' }],
    describe: 'space before a comma is removed',
  },
  {
    id: 'mech-missing-space',
    group: 'Mechanics',
    text: 'I will confirm.Thanks for waiting',
    expect: [{ ruleId: 'missing-space' }],
    describe: 'missing space after a period',
  },
  {
    id: 'mech-decimal-ok',
    group: 'Mechanics',
    text: 'The value is 3.5 and version 2.1 shipped',
    expectNone: true,
    describe: 'decimals are not "missing space" errors',
  },
  {
    id: 'mech-double-space',
    group: 'Mechanics',
    text: 'Send  it today',
    expect: [{ ruleId: 'double-space' }],
    describe: 'doubled space inside a line',
  },
  {
    id: 'mech-ellipsis-ok',
    group: 'Mechanics',
    text: 'Well... it depends',
    assert: (r) => !r.issues.some((i) => i.ruleId === 'repeated-punct'),
    describe: 'a three-dot ellipsis is deliberate, not an error',
  },

  /* -------------------------------------------------- integration */
  {
    id: 'int-clean-email',
    group: 'Integration',
    text:
      'Hi Sarah,\n\n' +
      'The Kubernetes migration for Acme is done. Ticket INFRA-4471 has the logs at grafana.acme.io/d/x8f2.\n\n' +
      'Best,\nImran',
    expectNone: true,
    describe: 'a clean, realistic email produces zero flags',
  },
  {
    id: 'int-noisy-email',
    group: 'Integration',
    text:
      'hi Sarah,\n\n' +
      'i dont think there is 3 items. your welcome to check the the logs on monday.\n\n' +
      '> please confirm recieved\n',
    assert: (r) => {
      const ids = new Set(r.issues.map((i) => i.ruleId));
      const wanted = ['lowercase-i', 'apostrophe', 'there-is-plural', 'your-youre', 'repeated-word', 'day-month-caps'];
      const allFound = wanted.every((w) => ids.has(w));
      const quotedClean = !r.issues.some((i) => i.start > r.text0.indexOf('>'));
      return allFound && quotedClean;
    },
    needsText0: true,
    describe: 'all six rule types fire, and the quoted line stays silent',
  },
];

/**
 * Runs the cases against an engine `check` function.
 * Shared by the browser harness and any future Node runner.
 */
export function runCases(check, cases = CASES) {
  return cases.map((testCase) => {
    let result;
    try {
      result = check(testCase.text);
    } catch (error) {
      return { ...testCase, pass: false, reason: `threw: ${error.message}`, issues: [] };
    }

    if (testCase.needsText0) result.text0 = testCase.text;

    if (testCase.assert) {
      let pass = false;
      let reason = '';
      try {
        pass = Boolean(testCase.assert(result));
      } catch (error) {
        reason = `assert threw: ${error.message}`;
      }
      return { ...testCase, pass, reason: pass ? '' : reason || 'assertion returned false', issues: result.issues };
    }

    if (testCase.expectNone) {
      const pass = result.issues.length === 0;
      return {
        ...testCase,
        pass,
        reason: pass ? '' : `expected no issues, got ${result.issues.length}: ` +
          result.issues.map((i) => `${i.ruleId}("${i.original}")`).join(', '),
        issues: result.issues,
      };
    }

    const missing = [];
    for (const expected of testCase.expect || []) {
      const hit = result.issues.find((i) => {
        if (expected.ruleId && i.ruleId !== expected.ruleId) return false;
        if (expected.original && i.original !== expected.original) return false;
        if (expected.suggestion && !i.suggestions.some((s) => s.includes(expected.suggestion))) return false;
        return true;
      });
      if (!hit) missing.push(expected);
    }

    const pass = testCase.matchAny
      ? missing.length < (testCase.expect || []).length
      : missing.length === 0;

    return {
      ...testCase,
      pass,
      reason: pass ? '' : `missing ${missing.map((e) => e.ruleId || e.suggestion).join(', ')}; ` +
        `got ${result.issues.map((i) => i.ruleId).join(', ') || 'nothing'}`,
      issues: result.issues,
    };
  });
}
