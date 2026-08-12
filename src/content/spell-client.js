/**
 * Spell client — the cache that makes the worker's lifecycle stop mattering.
 *
 * This is the lever identified in spec §5.4 (D16). Rather than keeping the
 * background worker alive, we make it unnecessary to talk to: once a word has
 * been resolved it is answered locally forever. In ordinary prose the great
 * majority of words repeat, so after the first paragraph almost nothing
 * crosses the process boundary at all.
 *
 * Two further protections against the worker being slow or asleep:
 *   - in-flight requests are deduplicated, so a burst of typing does not
 *     queue five identical lookups
 *   - a failed or timed-out lookup resolves as "assume correct", because a
 *     missing underline is invisible while a wrong one is in your face
 */

const MAX_ENTRIES = 5000;
const REQUEST_TIMEOUT_MS = 4000;

/** Insertion-ordered Map used as an LRU. */
const cache = new Map();
const inFlight = new Map();

function remember(word, verdict) {
  if (cache.has(word)) cache.delete(word);
  cache.set(word, verdict);
  if (cache.size > MAX_ENTRIES) {
    // Oldest insertion is the first key.
    cache.delete(cache.keys().next().value);
  }
}

function recall(word) {
  if (!cache.has(word)) return undefined;
  const verdict = cache.get(word);
  cache.delete(word);
  cache.set(word, verdict);
  return verdict;
}

function ask(words) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), REQUEST_TIMEOUT_MS);
    try {
      chrome.runtime.sendMessage({ type: 'CHECK_WORDS', words }, (response) => {
        clearTimeout(timer);
        // Reading lastError suppresses the "unchecked runtime.lastError" noise
        // that appears whenever the worker was torn down mid-flight.
        if (chrome.runtime.lastError) return resolve(null);
        resolve(response?.verdicts || null);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

/**
 * @param {string[]} words
 * @returns {Promise<Record<string, {ok:boolean, suggestions:string[]}>>}
 */
export async function resolveWords(words) {
  const verdicts = {};
  const missing = [];

  for (const word of words) {
    const known = recall(word);
    if (known) verdicts[word] = known;
    else if (!inFlight.has(word)) missing.push(word);
  }

  // Join any lookups already running for the same words.
  const joined = words.filter((w) => inFlight.has(w)).map((w) => inFlight.get(w));

  let request = null;
  if (missing.length) {
    request = ask(missing);
    for (const word of missing) inFlight.set(word, request);
  }

  const settled = await Promise.all([request, ...joined].filter(Boolean));

  if (missing.length) for (const word of missing) inFlight.delete(word);

  for (const batch of settled) {
    if (!batch) continue;
    for (const [word, verdict] of Object.entries(batch)) {
      remember(word, verdict);
      verdicts[word] = verdict;
    }
  }

  // Anything still unresolved is treated as correct. A silent miss beats a
  // false underline, and the next keystroke will retry it anyway.
  for (const word of words) {
    if (!verdicts[word]) verdicts[word] = { ok: true, suggestions: [] };
  }

  return verdicts;
}

/** Called when a word is added to the personal dictionary. */
export function forget(word) {
  cache.delete(word);
  cache.delete(word.toLowerCase());
}

export function cacheSize() {
  return cache.size;
}
