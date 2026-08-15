(() => {
  // src/background/storage.js
  var DEFAULT_SETTINGS = {
    enabled: true,
    skip: {
      urls: true,
      identifiers: true,
      quoted: true,
      signature: true,
      propernouns: true,
      code: true
    },
    checks: {
      spelling: true,
      confusions: true,
      apostrophes: true,
      capitalization: true,
      mechanics: true,
      agreement: true
    },
    /** Per-origin overrides, e.g. capitalization off in chat. */
    sites: {},
    disabledOrigins: []
  };

  // src/ui/options.js
  var CHECKS = [
    ["spelling", "Spelling", "Words that are not in the dictionary."],
    ["confusions", "Confused words", "your / you\u2019re, its / it\u2019s, to / too, there / their."],
    ["apostrophes", "Missing apostrophes", "dont, cant, wont, im, ive."],
    ["capitalization", "Capitalization", "Sentence starts, the pronoun I, weekdays and months."],
    ["mechanics", "Spacing and repeats", "Repeated words, space before a comma, missing space after a full stop."],
    ["agreement", "Subject\u2013verb agreement", 'Narrow patterns only \u2014 "there is 3 items", "he have". Rules cannot catch most agreement errors.']
  ];
  var SKIPS = [
    ["urls", "URLs, email addresses and file paths", "Never checked. Almost no downside."],
    ["identifiers", "ALL-CAPS words and identifiers", "API, SLA, INFRA-4471, snake_case."],
    ["quoted", "Quoted reply history", "The thread below your reply. You cannot fix someone else\u2019s typo."],
    ["signature", "Your signature block", 'Everything after a "--" line.'],
    ["propernouns", "Capitalized words mid-sentence", "Treats Sarah, Acme and Kubernetes as names. Removes the most noise of any rule here \u2014 the cost is that a typo inside a capitalized word slips through."],
    ["code", "Code blocks and inline code", "Anything in backticks or a code block."]
  ];
  var settings = { ...DEFAULT_SETTINGS };
  var words = [];
  function send(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) return resolve(null);
        resolve(response);
      });
    });
  }
  function rowFor(group, key, title, description) {
    const label = document.createElement("label");
    label.className = "row";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = Boolean(settings[group][key]);
    input.addEventListener("change", async () => {
      settings[group][key] = input.checked;
      const saved = await send({ type: "SAVE_SETTINGS", settings: { [group]: { [key]: input.checked } } });
      if (saved?.settings) settings = saved.settings;
    });
    const text = document.createElement("span");
    text.className = "text";
    const strong = document.createElement("strong");
    strong.textContent = title;
    const span = document.createElement("span");
    span.textContent = description;
    text.append(strong, span);
    label.append(input, text);
    return label;
  }
  function renderToggles() {
    const checks = document.getElementById("checks");
    const skips = document.getElementById("skips");
    checks.textContent = "";
    skips.textContent = "";
    for (const [key, title, description] of CHECKS) {
      checks.appendChild(rowFor("checks", key, title, description));
    }
    for (const [key, title, description] of SKIPS) {
      skips.appendChild(rowFor("skip", key, title, description));
    }
  }
  function renderWords() {
    const host = document.getElementById("words");
    host.textContent = "";
    if (words.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = 'No words yet. Add one below, or use "Add to dictionary" on any spelling suggestion.';
      host.appendChild(empty);
      return;
    }
    for (const word of [...words].sort((a, b) => a.localeCompare(b))) {
      const chip = document.createElement("span");
      chip.className = "word";
      chip.append(document.createTextNode(word));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "\xD7";
      remove.title = `Remove ${word}`;
      remove.setAttribute("aria-label", `Remove ${word}`);
      remove.addEventListener("click", async () => {
        const response = await send({ type: "REMOVE_WORD", word });
        words = response?.words || words.filter((w) => w !== word);
        renderWords();
      });
      chip.appendChild(remove);
      host.appendChild(chip);
    }
  }
  async function addWord() {
    const input = document.getElementById("new-word");
    const value = input.value.trim();
    if (!value) return;
    const response = await send({ type: "ADD_WORD", word: value });
    words = response?.words || [...words, value];
    input.value = "";
    input.focus();
    renderWords();
  }
  document.getElementById("add-word").addEventListener("click", addWord);
  document.getElementById("new-word").addEventListener("keydown", (event) => {
    if (event.key === "Enter") addWord();
  });
  var enabled = document.getElementById("enabled");
  enabled.addEventListener("change", async () => {
    const saved = await send({ type: "SAVE_SETTINGS", settings: { enabled: enabled.checked } });
    if (saved?.settings) settings = saved.settings;
  });
  (async function boot() {
    const config = await send({ type: "GET_CONFIG" });
    if (config?.settings) settings = config.settings;
    words = config?.words || [];
    enabled.checked = settings.enabled !== false;
    renderToggles();
    renderWords();
  })();
})();
