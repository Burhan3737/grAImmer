/**
 * Background service worker — the message boundary.
 *
 * Deliberately thin. It owns no checking logic; its whole job is to answer
 * "is this word real, and what did they mean" plus serve settings and the
 * personal dictionary. Everything else runs in the page (spec §5.1, D15).
 *
 * No keep-alive (spec §5.4, D16). Chrome terminates this worker when idle and
 * we rebuild on the next wake, which shipping precedent shows is fine.
 */

import { checkWords, warm } from './dictionary-service.js';
import {
  getSettings,
  saveSettings,
  getPersonalWords,
  addPersonalWord,
  removePersonalWord,
} from './storage.js';

const handlers = {
  async CHECK_WORDS({ words }) {
    const personal = await getPersonalWords();
    return { verdicts: await checkWords(words, personal) };
  },

  async GET_CONFIG() {
    const [settings, words] = await Promise.all([getSettings(), getPersonalWords()]);
    return { settings, words };
  },

  async SAVE_SETTINGS({ settings }) {
    return { settings: await saveSettings(settings) };
  },

  async ADD_WORD({ word }) {
    return { words: await addPersonalWord(word) };
  },

  async REMOVE_WORD({ word }) {
    return { words: await removePersonalWord(word) };
  },
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = handlers[message?.type];
  if (!handler) return false;

  handler(message)
    .then(sendResponse)
    .catch((error) => sendResponse({ error: String(error?.message || error) }));

  // Keeps the message channel open for the async reply.
  return true;
});

chrome.runtime.onInstalled.addListener(() => warm());
chrome.runtime.onStartup.addListener(() => warm());
