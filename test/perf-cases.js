/**
 * Performance regression guard.
 *
 * Asserts SHAPE, not speed. An absolute millisecond budget would fail on a
 * loaded CI machine and teach everyone to ignore it; what actually matters is
 * that cost stays roughly proportional to document length. Two separate
 * quadratic scans (a `tokens.find()` inside a per-sentence loop, in two
 * files) once made a long document cost 3.5x more for 2.7x the text. Email is
 * short enough that nobody would have noticed until someone pasted a chapter
 * into a compose box.
 *
 * The threshold is deliberately loose. It catches an accidental O(n^2), not a
 * 20% slowdown.
 */

import { check } from '../src/core/engine.js';

const PARAGRAPH =
  'Hi Sarah, i dont think there is 3 items to review. your welcome to check ' +
  'the the logs at grafana.acme.io/x8f2 on monday. He have already replied ,so ' +
  'we should be fine. Ticket INFRA-4471 covers it .Thanks for your patience.\n\n';

function timeCheck(text, runs = 3) {
  check(text); // warm, so JIT compilation is not measured
  const started = performance.now();
  for (let i = 0; i < runs; i++) check(text);
  return (performance.now() - started) / runs;
}

export const PERF_CASES = [
  {
    id: 'perf-linear-scaling',
    group: 'Performance',
    describe: 'checking cost stays roughly proportional to document length',
    run: () => {
      const small = PARAGRAPH.repeat(50);
      const large = PARAGRAPH.repeat(200); // 4x the text
      const ratio = timeCheck(large) / Math.max(timeCheck(small), 0.01);
      // Linear would be 4. Quadratic would be 16. Anything under 8 means the
      // growth is not quadratic; the slack absorbs GC and a noisy machine.
      if (ratio > 8) throw new Error(`4x text cost ${ratio.toFixed(1)}x time — likely quadratic`);
      return true;
    },
  },
  {
    id: 'perf-typical-email',
    group: 'Performance',
    describe: 'a normal-length email checks in well under one frame',
    run: () => {
      // Roughly 1,600 characters — a long email, not a document.
      const ms = timeCheck(PARAGRAPH.repeat(7), 5);
      // 16ms is one frame at 60Hz. Exceeding it means typing could stutter.
      if (ms > 16) throw new Error(`${ms.toFixed(1)}ms for a normal email — over one frame`);
      return true;
    },
  },
];

export function runPerfCases(cases = PERF_CASES) {
  return cases.map((testCase) => {
    try {
      return { ...testCase, pass: Boolean(testCase.run()), reason: '' };
    } catch (error) {
      return { ...testCase, pass: false, reason: error.message };
    }
  });
}
