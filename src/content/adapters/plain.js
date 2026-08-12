/**
 * Plain field adapter — textarea and text inputs.
 *
 * The easy case for reading text (`.value` is a flat string) and the awkward
 * case for measuring it. A textarea renders its own text internally and
 * exposes no way to ask "where is character 40 on screen".
 *
 * The standard answer is a mirror: an ordinary element laid out with exactly
 * the same typography and box metrics, positioned over the field, holding the
 * same text. Measuring a span inside the mirror gives the coordinates the
 * textarea would have used. The mirror is `visibility: hidden`, which still
 * produces layout — `display: none` would not.
 */

import { rectsToBoxes } from '../../core/overlay-geometry.js';

/** Properties that must match or the mirror's line breaks diverge from the field's. */
const COPIED_STYLES = [
  'boxSizing', 'width', 'height',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant',
  'letterSpacing', 'wordSpacing', 'lineHeight',
  'textIndent', 'textTransform', 'textAlign',
  'whiteSpace', 'wordBreak', 'overflowWrap', 'tabSize', 'direction',
];

export function createPlainAdapter(element) {
  let mirror = null;

  function ensureMirror() {
    if (mirror) return mirror;
    mirror = document.createElement('div');
    mirror.setAttribute('aria-hidden', 'true');
    Object.assign(mirror.style, {
      position: 'fixed',
      visibility: 'hidden',
      pointerEvents: 'none',
      overflow: 'hidden',
      zIndex: '-1',
      margin: '0',
      // A textarea always wraps; an input never does.
      whiteSpace: element.tagName === 'INPUT' ? 'pre' : 'pre-wrap',
      overflowWrap: 'break-word',
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

    node.textContent = '';
    node.appendChild(document.createTextNode(text.slice(0, start)));
    const marker = document.createElement('span');
    marker.textContent = text.slice(start, end);
    node.appendChild(marker);
    // A trailing newline is not laid out unless something follows it.
    node.appendChild(document.createTextNode(text.slice(end) + '​'));

    node.scrollTop = element.scrollTop;
    node.scrollLeft = element.scrollLeft;
    return marker;
  }

  return {
    element,
    kind: 'plain',

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
        left: r.left, top: r.top, width: r.width, height: r.height,
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
      if (typeof element.setRangeText === 'function') {
        element.setRangeText(replacement, start, end, 'end');
      } else {
        element.value = element.value.slice(0, start) + replacement + element.value.slice(end);
      }
      element.setSelectionRange(caret, caret);
      element.focus();
      // Sites listen for this. Without it Gmail never records the change and
      // the correction is silently lost on send.
      element.dispatchEvent(new Event('input', { bubbles: true }));
    },

    destroy() {
      if (mirror) mirror.remove();
      mirror = null;
    },
  };
}
