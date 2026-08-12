/**
 * Dictionary service — the only component that knows how spelling works.
 *
 * Its entire public surface is `checkWords`. That narrowness is deliberate
 * (spec §5.2): replacing nspell with a succinct trie later touches this file
 * and nothing else.
 *
 * Lifecycle (spec §5.4): no keep-alive, no persistence. Chrome terminates
 * this worker when idle and we simply rebuild on the next wake. Measured at
 * ~91 ms locally, and rehydrating a persisted structure was measured SLOWER
 * than re-parsing, so persisting would cost complexity for negative benefit.
 * The cache that actually matters lives in the content script.
 */

import nspell from 'nspell';

/** Held across wakes only for as long as the worker itself lives. */
let loading = null;

async function loadDictionary() {
  const [aff, dic] = await Promise.all([
    fetch(chrome.runtime.getURL('dictionaries/en.aff')).then((r) => r.text()),
    fetch(chrome.runtime.getURL('dictionaries/en.dic')).then((r) => r.text()),
  ]);
  return nspell({ aff, dic });
}

function getSpell() {
  if (!loading) {
    loading = loadDictionary().catch((error) => {
      // Reset so a transient failure does not poison every later request.
      loading = null;
      throw error;
    });
  }
  return loading;
}

/** Suggestions are capped — a card showing eight options helps nobody. */
const MAX_SUGGESTIONS = 3;

/**
 * @param {string[]} words     unique words the content script could not resolve
 * @param {string[]} personal  the user's added words
 * @returns {Promise<Record<string, {ok: boolean, suggestions: string[]}>>}
 */
export async function checkWords(words, personal = []) {
  const spell = await getSpell();
  const personalSet = new Set(personal.map((w) => w.toLowerCase()));
  const result = {};

  for (const word of words) {
    if (personalSet.has(word.toLowerCase())) {
      result[word] = { ok: true, suggestions: [] };
      continue;
    }

    // Hunspell dictionaries are case-sensitive for proper nouns, so a
    // lowercase form of a capitalized word can be a legitimate miss. Accept
    // either casing before declaring a word wrong.
    const ok = spell.correct(word) || spell.correct(word.toLowerCase());
    result[word] = {
      ok,
      suggestions: ok ? [] : spell.suggest(word).slice(0, MAX_SUGGESTIONS),
    };
  }

  return result;
}

/** Warm the dictionary without blocking on it. Called on install and startup. */
export function warm() {
  getSpell().catch(() => {});
}
