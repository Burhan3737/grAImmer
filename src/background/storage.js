/**
 * Personal dictionary and settings, both backed by extension storage.
 *
 * The personal dictionary is not a skip rule (spec §3.3). Adding "Grafana"
 * makes it a CORRECT word, so "Graffana" is still flagged and can be
 * corrected to it. Skipping the word would lose that.
 *
 * Storage area: `sync` so words follow the user between machines. It carries
 * a hard 8 KB per-item quota, so the list is chunked rather than stored as
 * one blob — a user with a few hundred internal product names would silently
 * hit that ceiling otherwise.
 */

const WORDS_PREFIX = 'words:';
const WORDS_PER_CHUNK = 200;
const SETTINGS_KEY = 'settings';

export const DEFAULT_SETTINGS = {
  enabled: true,
  skip: {
    urls: true,
    identifiers: true,
    quoted: true,
    signature: true,
    propernouns: true,
    code: true,
  },
  checks: {
    spelling: true,
    confusions: true,
    apostrophes: true,
    capitalization: true,
    mechanics: true,
    agreement: true,
  },
  /** Per-origin overrides, e.g. capitalization off in chat. */
  sites: {},
  disabledOrigins: [],
};

/* ------------------------------------------------------------ words */

export async function getPersonalWords() {
  const all = await chrome.storage.sync.get(null);
  const words = [];
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(WORDS_PREFIX) && Array.isArray(value)) words.push(...value);
  }
  return words;
}

export async function addPersonalWord(word) {
  const trimmed = String(word).trim();
  if (!trimmed) return getPersonalWords();

  const words = await getPersonalWords();
  if (words.some((w) => w.toLowerCase() === trimmed.toLowerCase())) return words;

  words.push(trimmed);
  await writeWords(words);
  return words;
}

export async function removePersonalWord(word) {
  const words = await getPersonalWords();
  const next = words.filter((w) => w.toLowerCase() !== String(word).toLowerCase());
  await writeWords(next);
  return next;
}

async function writeWords(words) {
  const existing = await chrome.storage.sync.get(null);
  const staleKeys = Object.keys(existing).filter((k) => k.startsWith(WORDS_PREFIX));
  if (staleKeys.length) await chrome.storage.sync.remove(staleKeys);

  const payload = {};
  for (let i = 0; i < words.length; i += WORDS_PER_CHUNK) {
    payload[`${WORDS_PREFIX}${i / WORDS_PER_CHUNK}`] = words.slice(i, i + WORDS_PER_CHUNK);
  }
  if (Object.keys(payload).length) await chrome.storage.sync.set(payload);
}

/* --------------------------------------------------------- settings */

export async function getSettings() {
  const stored = await chrome.storage.sync.get(SETTINGS_KEY);
  const settings = stored[SETTINGS_KEY] || {};
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    skip: { ...DEFAULT_SETTINGS.skip, ...(settings.skip || {}) },
    checks: { ...DEFAULT_SETTINGS.checks, ...(settings.checks || {}) },
    sites: { ...(settings.sites || {}) },
    disabledOrigins: settings.disabledOrigins || [],
  };
}

export async function saveSettings(partial) {
  const current = await getSettings();
  const next = {
    ...current,
    ...partial,
    skip: { ...current.skip, ...(partial.skip || {}) },
    checks: { ...current.checks, ...(partial.checks || {}) },
    sites: { ...current.sites, ...(partial.sites || {}) },
  };
  await chrome.storage.sync.set({ [SETTINGS_KEY]: next });
  return next;
}

/**
 * Merge the global settings with any override for this origin.
 * Chat sites want capitalization off; email wants it on (spec §3.3).
 */
export function settingsForOrigin(settings, origin) {
  const override = settings.sites?.[origin];
  if (!override) return settings;
  return {
    ...settings,
    skip: { ...settings.skip, ...(override.skip || {}) },
    checks: { ...settings.checks, ...(override.checks || {}) },
  };
}
