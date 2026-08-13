/**
 * Content script — orchestration.
 *
 * Two loops at different speeds (spec §data flow):
 *   check loop  — has the text changed?      debounced, ~500 ms
 *   paint loop  — have the underlines moved?  scroll/resize, one per frame
 *
 * Keeping them separate is what stops this feeling janky: a fast scroll must
 * never re-run the rule engine, and a keystroke must never wait on layout.
 */

import { check } from '../core/engine.js';
import { resolveWords, forget } from './spell-client.js';
import { createPlainAdapter } from './adapters/plain.js';
import { createRichAdapter } from './adapters/rich.js';
import { createOverlay } from './overlay.js';
import { createCard } from './card.js';
import { createBadge } from './badge.js';
import { profileForHost, impossibleForHost, IGNORE_DATA_GRAMM_BY_DEFAULT } from './site-profiles.js';

const DEBOUNCE_MS = 500;
const MAX_FIELD_LENGTH = 100_000;

/**
 * Used only when the background worker cannot be reached at all. Mirrors
 * DEFAULT_SETTINGS in background/storage.js; everything on, because a user
 * who installed a checker expects it to check.
 */
const FALLBACK_SETTINGS = {
  enabled: true,
  skip: { urls: true, identifiers: true, quoted: true, signature: true, propernouns: true, code: true },
  checks: { spelling: true, confusions: true, apostrophes: true, capitalization: true, mechanics: true, agreement: true },
  sites: {},
  disabledOrigins: [],
};

const profile = profileForHost();
const impossible = impossibleForHost();

let config = { settings: null, words: [] };
let active = null;
let version = 0;

/**
 * Settings arrive asynchronously from the background worker, and the worker
 * may be asleep when the page loads — which is its normal state (spec D16).
 * Focusing a field before they arrive must not silently do nothing, so the
 * element is remembered and attached once the config lands.
 *
 * Without this, clicking straight into Gmail's compose box after a page load
 * leaves grAImmer inert until you click away and back, with no indication
 * that anything is wrong.
 */
let configLoaded = false;
let pendingElement = null;

/* ------------------------------------------------------------- config */

async function loadConfig() {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, (response) => {
        if (chrome.runtime.lastError || !response) return resolve(null);
        resolve(response);
      });
    } catch {
      resolve(null);
    }
  });
}

function settingsForCheck() {
  const base = config.settings;
  if (!base) return {};
  const override = base.sites?.[location.origin] || {};
  return {
    skip: { ...base.skip, ...(override.skip || {}) },
    checks: { ...base.checks, ...(profile.checks || {}), ...(override.checks || {}) },
  };
}

/**
 * Deliberately distinguishes "switched off" from "not loaded yet". Conflating
 * them is what produced the race described above: a missing config looked
 * identical to a user disabling the extension, so the field was dropped
 * instead of queued.
 */
function enabledHere() {
  if (!configLoaded) return false;
  if (!config.settings?.enabled) return false;
  if (config.settings.disabledOrigins?.includes(location.origin)) return false;
  return true;
}

/* -------------------------------------------------------- field logic */

function isEditable(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
  if (profile.excludeSelector && element.matches(profile.excludeSelector)) return false;
  if (element.closest('[aria-hidden="true"]')) return false;

  // `data-gramm="false"` is ignored by default — see site-profiles.js for the
  // full reasoning. Honouring it would silently disable grAImmer on Slack.
  if (!IGNORE_DATA_GRAMM_BY_DEFAULT && element.closest('[data-gramm="false"]')) return false;

  if (element.matches('textarea')) return !element.disabled && !element.readOnly;
  if (element.matches('input')) {
    const type = (element.getAttribute('type') || 'text').toLowerCase();
    if (!['text', 'search', 'email', ''].includes(type)) return false;
    return !element.disabled && !element.readOnly;
  }
  // Use the attribute rather than isContentEditable so the check is testable
  // outside a browser, where isContentEditable is undefined.
  const attr = element.getAttribute('contenteditable');
  return attr === '' || attr === 'true' || attr === 'plaintext-only';
}

function makeAdapter(element) {
  const plain = element.matches('textarea, input');
  return plain ? createPlainAdapter(element) : createRichAdapter(element);
}

function detach() {
  if (!active) return;
  active.observer?.disconnect();
  active.resizeObserver?.disconnect();
  active.overlay.destroy();
  active.badge.destroy();
  active.adapter.destroy();
  clearTimeout(active.timer);
  active = null;
}

function attach(element) {
  if (active?.element === element) return;
  detach();

  const adapter = makeAdapter(element);
  const card = createCard({
    onApply: (issue, suggestion) => applyFix(issue, suggestion),
    onIgnore: (issue) => ignoreIssue(issue),
    onAddWord: (issue) => addWord(issue),
  });
  const overlay = createOverlay(adapter, {
    onMarkClick: (issue, rect) => card.open(issue, rect),
  });

  // Selecting from the panel opens the same card as clicking the underline.
  // The anchor is re-measured rather than remembered, because the text may
  // have reflowed since the panel was populated.
  const badge = createBadge({
    onSelect: (issue) => {
      const boxes = adapter.getBoxes(issue.start, issue.end, { clip: true });
      const container = adapter.getContainerRect();
      const anchor = boxes.length
        ? {
            left: container.left + boxes[0].left,
            top: container.top + boxes[0].top,
            width: boxes[0].width,
            height: boxes[0].height,
          }
        : container;
      card.open(issue, anchor);
    },
  });

  active = {
    element, adapter, overlay, card, badge,
    timer: null, issues: [], ignored: new Set(), raf: null,
    observer: null, resizeObserver: null,
  };

  // Attribute mutations are never observed. Gmail rewrites attributes on the
  // compose node constantly and observing them produces an endless loop.
  const observer = new MutationObserver(() => schedulePaint());
  observer.observe(element, { childList: true, subtree: true, characterData: true });
  active.observer = observer;

  // Also the removal signal: a detached element reports a zero box, which
  // fires this and lets schedulePaint notice `isConnected` is false.
  const resizeObserver = new ResizeObserver(() => schedulePaint());
  resizeObserver.observe(element);
  active.resizeObserver = resizeObserver;

  runCheck();
}

/* ---------------------------------------------------------- the loops */

function scheduleCheck() {
  if (!active) return;
  active.card.close();
  clearTimeout(active.timer);
  active.timer = setTimeout(runCheck, DEBOUNCE_MS);
}

async function runCheck() {
  if (!active || !enabledHere()) return;

  const pass = ++version;
  const text = active.adapter.getText();
  if (text.length > MAX_FIELD_LENGTH) return;

  const settings = settingsForCheck();

  // First pass without the dictionary. Grammar, apostrophe, capitalization
  // and spacing underlines paint immediately rather than waiting on a
  // possibly-asleep service worker (spec §5.4).
  const first = check(text, settings);
  if (pass !== version) return;
  paint(filterIgnored(first.issues));

  if (!settings.checks?.spelling || first.candidates.length === 0) return;

  const verdicts = await resolveWords(first.candidates);
  // The user may have typed on while the worker was answering. Applying a
  // stale reply would underline whatever now occupies those offsets.
  if (pass !== version || !active) return;

  const second = check(text, settings, verdicts);
  paint(filterIgnored(second.issues));
}

function filterIgnored(issues) {
  if (!active?.ignored.size) return issues;
  return issues.filter((issue) => !active.ignored.has(ignoreKey(issue)));
}

function ignoreKey(issue) {
  return `${issue.ruleId}:${issue.original}`;
}

function paint(issues) {
  if (!active) return;
  if (!active.element.isConnected) {
    detach();
    return;
  }
  active.issues = issues;
  active.adapter.sync?.();
  active.overlay.paint(issues);
  active.badge.update(issues, active.adapter.getContainerRect());
}

function schedulePaint() {
  if (!active || active.raf) return;
  active.raf = requestAnimationFrame(() => {
    if (!active) return;
    active.raf = null;

    // The field may have been removed while we waited for the frame. Gmail
    // creates and destroys compose windows constantly, and a teardown here
    // is what stops an orphaned overlay, badge and measuring mirror from
    // outliving their field, along with the observers holding it alive.
    if (!active.element.isConnected) {
      detach();
      return;
    }
    // Re-read the DOM first. Quill and RoosterJS rebuild nodes as a matter of
    // course, so a cached text node may be detached and measure nothing.
    active.adapter.sync?.();
    active.overlay.paint(active.issues);
    active.badge.update(active.issues, active.adapter.getContainerRect());
  });
}

/* --------------------------------------------------------- user actions */

function applyFix(issue, suggestion) {
  if (!active) return false;
  const applied = active.adapter.replaceRange(
    issue.start, issue.end, suggestion, issue.original
  );
  // Plain fields return undefined; only the rich adapter can refuse.
  if (applied === false) {
    runCheck();
    return false;
  }
  runCheck();
  return true;
}

function ignoreIssue(issue) {
  if (!active) return;
  active.ignored.add(ignoreKey(issue));
  paint(filterIgnored(active.issues));
}

function addWord(issue) {
  const word = issue.original;
  forget(word);
  try {
    chrome.runtime.sendMessage({ type: 'ADD_WORD', word }, (response) => {
      if (chrome.runtime.lastError || !response) return;
      config.words = response.words || config.words;
      runCheck();
    });
  } catch { /* worker unavailable; the word simply is not saved */ }
}

/* ------------------------------------------------------------- events */

/**
 * On a named site we know exactly which element is the composer, so a rich
 * field that is NOT it is treated as off-limits: Slack's off-screen paste
 * trap and its recipient picker are both `contenteditable`, and attaching to
 * either would paint underlines on something that is not a message.
 *
 * Plain textareas and text inputs are exempt from that narrowing. They carry
 * no such traps, and a named site still has ordinary search boxes and forms
 * that are worth checking.
 *
 * Elsewhere (the default profile) anything editable is fair game.
 */
function shouldAttach(element) {
  if (!isEditable(element)) return false;
  if (profile.tier > 2) return true;
  if (element.matches('textarea, input')) return true;
  return Boolean(profile.editableSelector) && element.matches(profile.editableSelector);
}

document.addEventListener('focusin', (event) => {
  if (!shouldAttach(event.target)) return;
  if (!configLoaded) {
    // Queue rather than discard — boot() picks this up when settings land.
    pendingElement = event.target;
    return;
  }
  if (!enabledHere()) return;
  attach(event.target);
}, true);

document.addEventListener('focusout', (event) => {
  if (!active || event.target !== active.element) return;

  // The card focuses its first suggestion so it is keyboard-reachable, and
  // that moves focus out of the field. Closing here unconditionally would
  // dismiss the card in the same tick it opened, making underlines look
  // unclickable. Only close when focus has genuinely left for somewhere else.
  const next = event.relatedTarget;
  if (next && typeof next.closest === 'function' && next.closest('.graimmer-card')) return;
  if (document.activeElement?.closest?.('.graimmer-card')) return;

  // The overlay stays so issues remain visible while the field is unfocused.
  active.card.close();
}, true);

document.addEventListener('input', (event) => {
  if (active && event.target === active.element) scheduleCheck();
}, true);

window.addEventListener('scroll', schedulePaint, true);
window.addEventListener('resize', schedulePaint);

chrome.storage?.onChanged?.addListener(async () => {
  const next = await loadConfig();
  if (next) { config = next; runCheck(); }
});

/* --------------------------------------------------------------- boot */

(async function boot() {
  if (impossible) {
    console.info(`[grAImmer] inactive on this site: ${impossible.reason}`);
    return;
  }

  const loaded = await loadConfig();
  if (loaded) config = loaded;
  // If the worker never answered, fall back to defaults rather than staying
  // inert forever. A checker that silently does nothing is worse than one
  // running on defaults it will correct on the next storage change.
  if (!config.settings) config = { settings: { ...FALLBACK_SETTINGS }, words: [] };
  configLoaded = true;

  // Catch the field the user focused while we were waiting. activeElement is
  // consulted too, because focus can be set before the content script runs at
  // all — document_idle fires after the page has settled.
  const candidate = pendingElement || document.activeElement;
  pendingElement = null;
  if (candidate && enabledHere() && shouldAttach(candidate)) attach(candidate);
})();
