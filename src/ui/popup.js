/**
 * Toolbar popup — per-site control.
 *
 * This exists because `disabledOrigins` was reachable from storage but from
 * no user interface, which makes it dead weight. Per-site control needs to
 * know which site you are on, and the options page cannot know that, so the
 * popup is its natural home.
 */

function send(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) return resolve(null);
      resolve(response);
    });
  });
}

async function currentOrigin() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return null;
  try {
    const url = new URL(tab.url);
    // Extension and browser pages have no content script, so there is
    // nothing to toggle for them.
    if (!/^https?:$/.test(url.protocol)) return null;
    return { origin: url.origin, host: url.host };
  } catch {
    return null;
  }
}

const els = {
  host: document.getElementById('host'),
  state: document.getElementById('state'),
  site: document.getElementById('site'),
  siteSub: document.getElementById('site-sub'),
  global: document.getElementById('global'),
};

let settings = null;
let site = null;

function render() {
  const globallyOn = settings?.enabled !== false;
  const siteOn = site ? !(settings?.disabledOrigins || []).includes(site.origin) : false;

  els.global.checked = globallyOn;
  els.site.checked = siteOn;
  els.site.disabled = !site || !globallyOn;

  if (!site) {
    els.host.textContent = '—';
    els.state.textContent = 'Nothing to check on this page.';
    els.state.dataset.kind = 'off';
    els.siteSub.textContent = 'grAImmer only runs on ordinary web pages.';
    return;
  }

  els.host.textContent = site.host;
  els.siteSub.textContent = 'Underline mistakes as you type here.';

  if (!globallyOn) {
    els.state.textContent = 'Turned off everywhere.';
    els.state.dataset.kind = 'off';
  } else if (!siteOn) {
    els.state.textContent = `Turned off on ${site.host}.`;
    els.state.dataset.kind = 'off';
  } else {
    els.state.textContent = 'Checking this site.';
    els.state.dataset.kind = 'on';
  }
}

els.site.addEventListener('change', async () => {
  if (!site) return;
  const disabled = new Set(settings.disabledOrigins || []);
  if (els.site.checked) disabled.delete(site.origin);
  else disabled.add(site.origin);

  const saved = await send({
    type: 'SAVE_SETTINGS',
    settings: { disabledOrigins: [...disabled] },
  });
  if (saved?.settings) settings = saved.settings;
  render();
});

els.global.addEventListener('change', async () => {
  const saved = await send({ type: 'SAVE_SETTINGS', settings: { enabled: els.global.checked } });
  if (saved?.settings) settings = saved.settings;
  render();
});

document.getElementById('open-options').addEventListener('click', (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});

(async function boot() {
  const [config, current] = await Promise.all([send({ type: 'GET_CONFIG' }), currentOrigin()]);
  settings = config?.settings || { enabled: true, disabledOrigins: [] };
  site = current;
  render();
})();
