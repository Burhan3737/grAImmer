/**
 * Rich field adapter — contenteditable.
 *
 * The hard case, and what Gmail, Outlook, Slack and LinkedIn all are. Text is
 * scattered across nested nodes and formatting can split a word in half, so
 * there is no such thing as "character 40" until we build one.
 *
 * Two invariants this file exists to protect:
 *
 *   1. The field's DOM is never modified for rendering. Underlines are drawn
 *      on a separate layer, so a sent email is byte-for-byte what was typed.
 *   2. Offsets are stable. The flattened text must reproduce exactly what the
 *      user perceives, including the newlines that block elements imply but
 *      never store as characters.
 */

import { rectsToBoxes } from '../../core/overlay-geometry.js';

const BLOCK_SELECTOR = 'div,p,li,blockquote,tr,h1,h2,h3,h4,h5,h6,pre';

/**
 * Flatten to plain text plus a map back into the live nodes.
 *
 * Block boundaries contribute an implicit newline. Without it the last word
 * of one line and the first of the next fuse into a single token, and every
 * offset after that point is wrong.
 */
export function flatten(root) {
  const entries = [];
  let text = '';
  let lastBlock = null;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let node;

  while ((node = walker.nextNode())) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.tagName === 'BR' && text.length && !text.endsWith('\n')) text += '\n';
      continue;
    }
    // Skip text inside elements the user cannot edit, e.g. Slack mention chips.
    if (node.parentElement?.closest('[contenteditable="false"]')) continue;

    const block = node.parentElement?.closest(BLOCK_SELECTOR) || root;
    if (lastBlock && block !== lastBlock && text.length && !text.endsWith('\n')) text += '\n';
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

export function createRichAdapter(element) {
  let snapshot = { text: '', entries: [] };

  function refresh() {
    snapshot = flatten(element);
    return snapshot;
  }

  return {
    element,
    kind: 'rich',

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
        left: r.left, top: r.top, width: r.width, height: r.height,
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

      // Put the caret after the replacement rather than leaving it wherever
      // the DOM surgery happened to drop it.
      const caret = document.createRange();
      caret.setStart(inserted, inserted.length);
      caret.collapse(true);
      selection.removeAllRanges();
      selection.addRange(caret);

      element.normalize();
      element.dispatchEvent(new Event('input', { bubbles: true }));
      refresh();
      return true;
    },

    destroy() {
      snapshot = { text: '', entries: [] };
    },
  };
}
