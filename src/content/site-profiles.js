/**
 * Site profiles — every piece of per-site knowledge in the codebase.
 *
 * Isolated here on purpose (spec §5.1). When Gmail ships a redesign, this
 * file changes and the checker does not.
 *
 * Selectors and editor engines below were verified against shipped production
 * bundles rather than inferred from documentation. Where something is
 * unverified it says so, because a confidently wrong selector fails silently.
 */

/**
 * `data-gramm="false"` — a deliberate product decision, not an oversight.
 *
 * Quill 1.3.7's constructor sets this attribute, and Slack ships it
 * unmodified. It is a 2018-era opt-out aimed at extensions that INJECT NODES
 * into the editable root — which is exactly the failure mode it was created
 * to prevent, and exactly the thing grAImmer never does. Our underlines live
 * on a separate layer outside the editor's tree.
 *
 * Honouring the attribute would silently disable grAImmer on Slack, a launch
 * target, with no indication to the user. So we ignore it — but visibly, with
 * a per-site toggle, so the behaviour is a choice the user can reverse rather
 * than a surprise. Grammarly itself has moved to `data-enable-grammarly`.
 */
export const IGNORE_DATA_GRAMM_BY_DEFAULT = true;

const PROFILES = [
  {
    id: 'gmail',
    tier: 1,
    match: /(^|\.)mail\.google\.com$/,
    // Top-level document. The old `canvas_frame` iframe was retired around
    // 2013; plain-text compose uses this same element.
    editableSelector: 'div[role="textbox"][g_editable="true"], div[role="textbox"][contenteditable="true"]',
    // Gmail rewrites attributes on the compose node constantly. Observing
    // attribute mutations here produces an endless re-check loop.
    observeAttributes: false,
    notes: 'native contenteditable + execCommand, no model layer',
  },
  {
    id: 'outlook',
    tier: 1,
    match: /(^|\.)(outlook\.(live|office|office365)\.com|outlook\.com)$/,
    editableSelector: 'div[contenteditable="true"][role="textbox"], div[contenteditable="true"][aria-multiline="true"]',
    observeAttributes: false,
    // RoosterJS replaces whole changed blocks and deletes nodes that are not
    // part of its content model. Re-resolve everything each tick.
    volatileDom: true,
    notes: 'RoosterJS content model',
  },
  {
    id: 'github',
    tier: 1,
    match: /(^|\.)github\.com$/,
    editableSelector: 'textarea',
    observeAttributes: false,
    notes: 'plain textarea - the control case',
  },
  {
    id: 'slack',
    tier: 2,
    match: /(^|\.)slack\.com$/,
    // `.ql-clipboard` is an off-screen paste trap and the multi-select input
    // is the recipient picker. Both are contenteditable and neither is a
    // message composer.
    editableSelector: '[data-qa="message_input"] .ql-editor[contenteditable="true"]',
    excludeSelector: '.ql-clipboard, .c-multi_select_input__input',
    observeAttributes: false,
    volatileDom: true,
    // Chat register: sentence-case warnings are noise here (spec §3.3).
    checks: { capitalization: false },
    notes: 'Quill 1.3.7 - Parchment replaceChild()s foreign nodes',
  },
  {
    id: 'linkedin',
    tier: 2,
    match: /(^|\.)linkedin\.com$/,
    editableSelector: 'div[contenteditable="true"][role="textbox"], .ql-editor[contenteditable="true"]',
    excludeSelector: '.ql-clipboard',
    observeAttributes: false,
    volatileDom: true,
    // Post composer is Quill 2.x. The DM composer engine is UNVERIFIED - it is
    // contenteditable with ARIA, but do not assume Quill.
    notes: 'Quill 2.x (post composer); DM composer unverified',
  },
];

/** Sites where no extension can reach the text, recorded so it is a decision. */
const IMPOSSIBLE = [
  {
    match: /(^|\.)docs\.google\.com$/,
    reason:
      'Google Docs paints text to <canvas>. Reaching it requires setting ' +
      'window._docs_annotate_canvas_by_ext from a MAIN-world script and reading ' +
      'SVG rect[aria-label] nodes, which is out of scope for Phase 1 (spec D7).',
  },
];

export const DEFAULT_PROFILE = {
  id: 'default',
  tier: 3,
  editableSelector:
    'textarea, input[type="text"], input[type="search"], input[type="email"], ' +
    'input:not([type]), div[contenteditable="true"], div[contenteditable=""]',
  excludeSelector: '[aria-hidden="true"]',
  observeAttributes: false,
  volatileDom: false,
  notes: 'best effort',
};

export function profileForHost(host = location.hostname) {
  return PROFILES.find((profile) => profile.match.test(host)) || DEFAULT_PROFILE;
}

export function impossibleForHost(host = location.hostname) {
  return IMPOSSIBLE.find((entry) => entry.match.test(host)) || null;
}

export { PROFILES };
