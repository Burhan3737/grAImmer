/**
 * Issue badge and panel — the pre-send overview (spec D2).
 *
 * The inline card fixes one problem where your eyes already are. This answers
 * the different question you ask before hitting send: "how many problems do I
 * have, and have I missed any?" Scrolling a long email hunting for squiggles
 * is exactly the chore this removes.
 *
 * Like the overlay, both elements are fixed-position and appended to the body
 * rather than inserted near the field, so no site's stacking context or
 * overflow clipping can swallow them.
 */

const SEVERITY_ORDER = { spelling: 0, grammar: 1, mechanics: 2 };

export function createBadge({ onSelect }) {
  const badge = document.createElement('button');
  badge.type = 'button';
  badge.className = 'graimmer-badge';
  badge.hidden = true;
  document.body.appendChild(badge);

  const panel = document.createElement('div');
  panel.className = 'graimmer-panel';
  panel.hidden = true;
  document.body.appendChild(panel);

  let issues = [];
  let anchorRect = null;

  badge.addEventListener('mousedown', (event) => {
    // Do not let the field lose its selection when the badge is clicked.
    event.preventDefault();
    event.stopPropagation();
    panel.hidden ? openPanel() : closePanel();
  });

  function closePanel() {
    panel.hidden = true;
  }

  function openPanel() {
    panel.textContent = '';

    const head = document.createElement('div');
    head.className = 'graimmer-panel-head';
    head.textContent = issues.length === 1 ? '1 issue' : `${issues.length} issues`;
    panel.appendChild(head);

    const ordered = [...issues].sort(
      (a, b) =>
        (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) ||
        a.start - b.start
    );

    for (const issue of ordered) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'graimmer-panel-row';
      row.dataset.severity = issue.severity;

      const category = document.createElement('span');
      category.className = 'graimmer-panel-cat';
      category.textContent = issue.category;

      const change = document.createElement('span');
      change.className = 'graimmer-panel-change';
      const from = document.createElement('s');
      from.textContent = issue.original;
      change.appendChild(from);
      if (issue.suggestions.length) {
        change.appendChild(document.createTextNode(' → '));
        const to = document.createElement('strong');
        to.textContent = issue.suggestions[0];
        change.appendChild(to);
      }

      row.append(category, change);
      row.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        closePanel();
        onSelect(issue);
      });
      panel.appendChild(row);
    }

    panel.hidden = false;
    position();
  }

  /** Bottom-right of the field, nudged inside so it never sits on the border. */
  function position() {
    if (!anchorRect) return;

    const badgeWidth = badge.offsetWidth || 74;
    const left = Math.max(4, anchorRect.left + anchorRect.width - badgeWidth - 8);
    const top = Math.max(4, anchorRect.top + anchorRect.height - (badge.offsetHeight || 22) - 8);
    badge.style.left = `${left}px`;
    badge.style.top = `${top}px`;

    if (panel.hidden) return;
    const panelHeight = panel.offsetHeight;
    const panelWidth = panel.offsetWidth;
    // Prefer above the badge; drop below only when there is no room up there.
    const above = top - panelHeight - 6;
    panel.style.top = `${above >= 4 ? above : Math.min(top + 30, window.innerHeight - panelHeight - 4)}px`;
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

    badge.hidden = false;
    badge.textContent = issues.length === 1 ? '1 issue' : `${issues.length} issues`;
    badge.setAttribute('aria-label', `${issues.length} writing issues. Show list.`);
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

  document.addEventListener('mousedown', (event) => {
    if (panel.hidden) return;
    if (panel.contains(event.target) || badge.contains(event.target)) return;
    closePanel();
  }, true);

  return { update, position, hide, destroy };
}
