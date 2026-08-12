/**
 * Overlay geometry — turning measured text rectangles into overlay boxes.
 *
 * This file is deliberately pure. It takes plain {left, top, width, height}
 * objects and returns plain objects; it never touches the DOM, never calls
 * getClientRects, and never reads scroll positions itself.
 *
 * That separation is the point. jsdom has no layout engine — getClientRects
 * returns nothing on elements and throws outright on a Range — so the only
 * way to unit-test positioning logic is to keep the logic somewhere that
 * never needs to obtain rectangles in the first place. Testing it any other
 * way means mocking getClientRects and then asserting against your own mock,
 * which proves nothing.
 *
 * Obtaining the rectangles is the caller's job, and is covered by browser
 * tests. Deciding what to draw is this file's job, and is covered here.
 */

/** A rectangle in viewport coordinates, as returned by getClientRects(). */
/** @typedef {{left:number, top:number, width:number, height:number}} Rect */

/** A box positioned relative to the overlay container. */
/** @typedef {{left:number, top:number, width:number, height:number}} Box */

const EPSILON = 1.5;

/**
 * Rectangles that sit on the same visual line and touch each other.
 *
 * getClientRects fragments a range at every element boundary, so a phrase
 * spanning a <b> tag arrives as three rectangles. Drawing them separately
 * produces a visibly broken underline with gaps at the seams.
 */
function sameLine(a, b) {
  return Math.abs(a.top - b.top) <= EPSILON && Math.abs(a.height - b.height) <= EPSILON;
}

function adjacent(a, b) {
  return b.left - (a.left + a.width) <= EPSILON;
}

/**
 * Merge fragmented rectangles back into one box per visual line.
 * @param {Rect[]} rects
 * @returns {Rect[]}
 */
export function mergeRects(rects) {
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

/**
 * Clip a box to the visible area of its container.
 *
 * A field with its own scrollbar will report rectangles for text scrolled out
 * of view. Those rectangles are real but must not be painted, or underlines
 * appear floating above and below the field.
 *
 * @returns {Box|null} null when the box is entirely outside the container
 */
export function clipToContainer(box, container) {
  const left = Math.max(box.left, container.left);
  const top = Math.max(box.top, container.top);
  const right = Math.min(box.left + box.width, container.left + container.width);
  const bottom = Math.min(box.top + box.height, container.top + container.height);

  if (right <= left || bottom <= top) return null;
  return { left, top, width: right - left, height: bottom - top };
}

/**
 * The whole transform: viewport rectangles in, container-relative boxes out.
 *
 * @param {Rect[]} clientRects  from Range.getClientRects()
 * @param {Rect} containerRect  the overlay host, in viewport coordinates
 * @param {object} [options]
 * @param {boolean} [options.clip=true]      drop content scrolled out of the field
 * @param {number}  [options.minWidth=1]     ignore slivers from collapsed ranges
 * @param {number}  [options.underlineInset=0] pull the box up from the baseline
 * @returns {Box[]} positioned relative to containerRect's top-left
 */
export function rectsToBoxes(clientRects, containerRect, options = {}) {
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
      height: Math.max(clipped.height - underlineInset, 1),
    });
  }

  return boxes;
}

/**
 * Where to place the suggestion card so it stays on screen.
 *
 * Pure for the same reason as everything else here: the flipping and clamping
 * rules are where the bugs live, and they are tedious to reproduce in a
 * browser test but trivial to pin down with numbers.
 *
 * @param {Rect} anchor     the underline being clicked, viewport coordinates
 * @param {{width:number, height:number}} card
 * @param {{width:number, height:number}} viewport
 * @param {number} [gap=6]
 * @returns {{left:number, top:number, placement:'below'|'above'}}
 */
export function positionCard(anchor, card, viewport, gap = 6) {
  const belowTop = anchor.top + anchor.height + gap;
  const aboveTop = anchor.top - card.height - gap;

  // Prefer below, flip above only when below would overflow AND above fits.
  const fitsBelow = belowTop + card.height <= viewport.height;
  const fitsAbove = aboveTop >= 0;
  const placement = fitsBelow || !fitsAbove ? 'below' : 'above';

  let top = placement === 'below' ? belowTop : aboveTop;
  top = Math.max(0, Math.min(top, Math.max(0, viewport.height - card.height)));

  let left = anchor.left;
  left = Math.min(left, viewport.width - card.width - gap);
  left = Math.max(gap, left);

  return { left, top, placement };
}
