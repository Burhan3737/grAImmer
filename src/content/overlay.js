/**
 * Overlay — the only code that paints underlines.
 *
 * The layer is a fixed-position element appended to document.body, never
 * inserted into the editor's tree. That is not a stylistic choice: Quill's
 * Parchment `replaceChild`s any node it cannot resolve to a registered blot,
 * and RoosterJS deletes nodes outside its content model. Anything placed
 * inside the editable root on Slack or Outlook is removed, often silently.
 *
 * Body-level and fixed also sidesteps a second class of bug — a layer
 * inserted as a sibling inherits the site's stacking context, transforms and
 * overflow clipping, and debugging that on someone else's CSS is miserable.
 */

const LAYER_CLASS = 'graimmer-layer';
const MARK_CLASS = 'graimmer-mark';

export function createOverlay(adapter, { onMarkClick }) {
  const layer = document.createElement('div');
  layer.className = LAYER_CLASS;
  layer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(layer);

  let painted = [];

  layer.addEventListener('mousedown', (event) => {
    const mark = event.target.closest(`.${MARK_CLASS}`);
    if (!mark) return;
    // Prevent the editor losing its selection before we can act on it.
    event.preventDefault();
    event.stopPropagation();
    const issue = painted[Number(mark.dataset.index)];
    if (issue) onMarkClick(issue, mark.getBoundingClientRect());
  });

  function clear() {
    layer.textContent = '';
  }

  /**
   * @param {Array} issues
   * @param {boolean} fieldIsScrollContainer  clip to the field, e.g. Slack
   */
  function paint(issues, fieldIsScrollContainer = false) {
    painted = issues;
    clear();

    const container = adapter.getContainerRect();
    if (container.width === 0 || container.height === 0) return;

    Object.assign(layer.style, {
      left: `${container.left}px`,
      top: `${container.top}px`,
      width: `${container.width}px`,
      height: `${container.height}px`,
    });

    const fragment = document.createDocumentFragment();

    issues.forEach((issue, index) => {
      const boxes = adapter.getBoxes(issue.start, issue.end, {
        clip: true,
        // An issue split across two lines produces two boxes, both tagged
        // with the same issue index so either one opens the same card.
        minWidth: 1,
      });

      for (const box of boxes) {
        const mark = document.createElement('span');
        mark.className = MARK_CLASS;
        mark.dataset.index = String(index);
        mark.dataset.severity = issue.severity;
        Object.assign(mark.style, {
          left: `${box.left}px`,
          top: `${box.top}px`,
          width: `${box.width}px`,
          height: `${box.height}px`,
        });
        fragment.appendChild(mark);
      }
    });

    layer.appendChild(fragment);
    void fieldIsScrollContainer;
  }

  function hide() {
    layer.style.display = 'none';
  }

  function show() {
    layer.style.display = '';
  }

  function destroy() {
    layer.remove();
    painted = [];
  }

  return { paint, clear, hide, show, destroy, get issues() { return painted; } };
}
