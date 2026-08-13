/**
 * Node test runner for the pure core.
 *
 * The core has no DOM dependency by design (spec §5.1), so the entire rule
 * engine is verifiable here without a browser. Overlay positioning is NOT
 * covered — that needs real layout, and is checked in the browser harness.
 */

import { check } from '../src/core/engine.js';
import { CASES, runCases } from './cases.js';
import { runGeometryCases } from './geometry-cases.js';
import { runPerfCases } from './perf-cases.js';

const results = [...runCases(check, CASES), ...runGeometryCases(), ...runPerfCases()];
const failed = results.filter((r) => !r.pass);

const groups = [...new Set(results.map((r) => r.group))];
for (const group of groups) {
  const inGroup = results.filter((r) => r.group === group);
  const passed = inGroup.filter((r) => r.pass).length;
  console.log(`\n${group}  ${passed}/${inGroup.length}`);
  for (const result of inGroup) {
    const mark = result.pass ? '  ok  ' : '  FAIL';
    console.log(`${mark} ${result.id.padEnd(30)} ${result.describe}`);
    if (!result.pass) console.log(`       -> ${result.reason}`);
  }
}

console.log(`\n${results.length - failed.length}/${results.length} passing`);
process.exit(failed.length === 0 ? 0 : 1);
