/**
 * Geometry tests — the positioning logic, with no browser involved.
 *
 * Every rectangle here is hand-written. That is the whole point: these are
 * the cases that are painful to reproduce in a real browser (a word wrapping
 * across a line, a range fragmented by a <b> tag, text scrolled half out of
 * a field, a card near the bottom edge) but trivial to state as numbers.
 */

import { mergeRects, clipToContainer, rectsToBoxes, positionCard } from '../src/core/overlay-geometry.js';

const rect = (left, top, width, height) => ({ left, top, width, height });

export const GEOMETRY_CASES = [
  /* ------------------------------------------------------- mergeRects */
  {
    id: 'geo-drop-empty',
    group: 'Geometry / merge',
    describe: 'zero-width rectangles from collapsed ranges are dropped',
    run: () => mergeRects([rect(10, 0, 0, 18), rect(20, 0, 30, 18)]).length === 1,
  },
  {
    id: 'geo-merge-fragments',
    group: 'Geometry / merge',
    describe: 'a range fragmented by inline markup merges into one underline',
    run: () => {
      // "you're welcome" split by a <b> around "welcome"
      const merged = mergeRects([rect(10, 40, 30, 18), rect(40, 40, 25, 18), rect(65, 40, 20, 18)]);
      return merged.length === 1 && merged[0].left === 10 && merged[0].width === 75;
    },
  },
  {
    id: 'geo-keep-lines-separate',
    group: 'Geometry / merge',
    describe: 'a phrase wrapping across two lines stays two underlines',
    run: () => mergeRects([rect(200, 40, 60, 18), rect(10, 62, 40, 18)]).length === 2,
  },
  {
    id: 'geo-gap-not-merged',
    group: 'Geometry / merge',
    describe: 'rectangles on one line with a real gap are not joined',
    run: () => mergeRects([rect(10, 40, 30, 18), rect(120, 40, 30, 18)]).length === 2,
  },
  {
    id: 'geo-merge-order',
    group: 'Geometry / merge',
    describe: 'rectangles arriving out of order still merge correctly',
    run: () => {
      const merged = mergeRects([rect(40, 40, 25, 18), rect(10, 40, 30, 18)]);
      return merged.length === 1 && merged[0].left === 10 && merged[0].width === 55;
    },
  },

  /* ------------------------------------------------------------- clip */
  {
    id: 'geo-clip-above',
    group: 'Geometry / clip',
    describe: 'text scrolled above the field is not painted',
    run: () => clipToContainer(rect(10, -40, 50, 18), rect(0, 0, 300, 100)) === null,
  },
  {
    id: 'geo-clip-partial',
    group: 'Geometry / clip',
    describe: 'a half-visible line is clipped, not dropped',
    run: () => {
      const clipped = clipToContainer(rect(10, 90, 50, 18), rect(0, 0, 300, 100));
      return clipped !== null && clipped.top === 90 && clipped.height === 10;
    },
  },
  {
    id: 'geo-clip-inside',
    group: 'Geometry / clip',
    describe: 'a fully visible box is returned unchanged',
    run: () => {
      const clipped = clipToContainer(rect(10, 20, 50, 18), rect(0, 0, 300, 100));
      return clipped.left === 10 && clipped.top === 20 && clipped.width === 50 && clipped.height === 18;
    },
  },

  /* --------------------------------------------------- rectsToBoxes */
  {
    id: 'geo-relative-coords',
    group: 'Geometry / transform',
    describe: 'boxes come back relative to the container, not the viewport',
    run: () => {
      // Container is scrolled down the page; the box must not inherit that offset.
      const boxes = rectsToBoxes([rect(120, 340, 50, 18)], rect(100, 300, 400, 200));
      return boxes.length === 1 && boxes[0].left === 20 && boxes[0].top === 40;
    },
  },
  {
    id: 'geo-scrolled-out-dropped',
    group: 'Geometry / transform',
    describe: 'an issue scrolled out of a field produces no box at all',
    run: () => rectsToBoxes([rect(120, 100, 50, 18)], rect(100, 300, 400, 200)).length === 0,
  },
  {
    id: 'geo-slivers-ignored',
    group: 'Geometry / transform',
    describe: 'sub-pixel slivers are ignored rather than drawn',
    run: () => rectsToBoxes([rect(120, 340, 0.4, 18)], rect(100, 300, 400, 200)).length === 0,
  },
  {
    id: 'geo-no-clip-option',
    group: 'Geometry / transform',
    describe: 'clipping can be disabled for fields that do not scroll',
    run: () => rectsToBoxes([rect(120, 100, 50, 18)], rect(100, 300, 400, 200), { clip: false }).length === 1,
  },

  /* -------------------------------------------------------- the card */
  {
    id: 'card-below-by-default',
    group: 'Geometry / card',
    describe: 'the card sits below the word when there is room',
    run: () => {
      const p = positionCard(rect(50, 100, 60, 18), { width: 268, height: 160 }, { width: 1200, height: 800 });
      return p.placement === 'below' && p.top === 124;
    },
  },
  {
    id: 'card-flips-above',
    group: 'Geometry / card',
    describe: 'near the bottom edge the card flips above the word',
    run: () => {
      const p = positionCard(rect(50, 700, 60, 18), { width: 268, height: 160 }, { width: 1200, height: 800 });
      return p.placement === 'above' && p.top === 534;
    },
  },
  {
    id: 'card-no-room-either-way',
    group: 'Geometry / card',
    describe: 'in a viewport too short for either placement the card stays on screen',
    run: () => {
      const p = positionCard(rect(50, 80, 60, 18), { width: 268, height: 160 }, { width: 1200, height: 200 });
      return p.top >= 0 && p.top + 160 <= 200;
    },
  },
  {
    id: 'card-clamped-right',
    group: 'Geometry / card',
    describe: 'a word near the right edge does not push the card off screen',
    run: () => {
      const p = positionCard(rect(1150, 100, 40, 18), { width: 268, height: 160 }, { width: 1200, height: 800 });
      return p.left + 268 <= 1200;
    },
  },
  {
    id: 'card-clamped-left',
    group: 'Geometry / card',
    describe: 'the card never goes off the left edge',
    run: () => {
      const p = positionCard(rect(2, 100, 40, 18), { width: 268, height: 160 }, { width: 1200, height: 800 });
      return p.left >= 0;
    },
  },
];

export function runGeometryCases(cases = GEOMETRY_CASES) {
  return cases.map((testCase) => {
    try {
      const pass = Boolean(testCase.run());
      return { ...testCase, pass, reason: pass ? '' : 'returned false' };
    } catch (error) {
      return { ...testCase, pass: false, reason: `threw: ${error.message}` };
    }
  });
}
