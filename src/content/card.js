/**
 * Suggestion card — the popup shown when an underline is clicked.
 *
 * Placement maths lives in core/overlay-geometry (`positionCard`) so the
 * flip-above and clamp-to-edge rules are covered by unit tests rather than
 * discovered by a user with a compose window at the bottom of the screen.
 */

import { positionCard } from '../core/overlay-geometry.js';

const CARD_WIDTH = 268;

export function createCard({ onApply, onIgnore, onAddWord }) {
  let element = null;
  let current = null;

  function close() {
    if (element) element.remove();
    element = null;
    current = null;
  }

  function open(issue, anchorRect) {
    close();
    current = issue;

    element = document.createElement('div');
    element.className = 'graimmer-card';
    element.dataset.severity = issue.severity;

    const head = document.createElement('div');
    head.className = 'graimmer-card-head';
    head.textContent = issue.category;
    element.appendChild(head);

    const message = document.createElement('div');
    message.className = 'graimmer-card-msg';
    message.textContent = issue.message;
    element.appendChild(message);

    if (issue.suggestions.length === 0) {
      const none = document.createElement('div');
      none.className = 'graimmer-card-none';
      none.textContent = 'No suggestion available.';
      element.appendChild(none);
    }

    for (const suggestion of issue.suggestions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'graimmer-card-fix';
      button.textContent = suggestion;
      button.addEventListener('click', () => {
        const applied = onApply(issue, suggestion);
        close();
        if (applied === false) {
          // The text moved while the card was open. Saying nothing would look
          // like the click was ignored, which is worse than a brief note.
          flash('Text changed — re-checking');
        }
      });
      element.appendChild(button);
    }

    const foot = document.createElement('div');
    foot.className = 'graimmer-card-foot';

    const ignore = document.createElement('button');
    ignore.type = 'button';
    ignore.textContent = 'Ignore';
    ignore.addEventListener('click', () => { onIgnore(issue); close(); });
    foot.appendChild(ignore);

    if (issue.severity === 'spelling') {
      const add = document.createElement('button');
      add.type = 'button';
      add.textContent = 'Add to dictionary';
      add.addEventListener('click', () => { onAddWord(issue); close(); });
      foot.appendChild(add);
    }

    element.appendChild(foot);
    document.body.appendChild(element);

    // Measure after insertion — the height depends on how many suggestions
    // there are, and guessing it makes the flip decision wrong.
    const height = element.offsetHeight;
    const placement = positionCard(
      anchorRect,
      { width: CARD_WIDTH, height },
      { width: window.innerWidth, height: window.innerHeight }
    );
    element.style.left = `${placement.left}px`;
    element.style.top = `${placement.top}px`;

    const firstFix = element.querySelector('.graimmer-card-fix');
    if (firstFix) firstFix.focus({ preventScroll: true });
  }

  function flash(text) {
    const note = document.createElement('div');
    note.className = 'graimmer-toast';
    note.textContent = text;
    document.body.appendChild(note);
    setTimeout(() => note.remove(), 2200);
  }

  document.addEventListener('mousedown', (event) => {
    if (element && !element.contains(event.target)) close();
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && element) close();
  }, true);

  return { open, close, get issue() { return current; } };
}
