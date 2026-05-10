"use strict";

// Shared by background, options, popup. Exposes a global `Storage`.
// Slots:
//   rules            — array of rule objects, see below.
//   defaultContainer — string, name of the container to use when no rule
//                      matches; "" / unset means "no default".
//   enabled          — boolean, master switch. When false the extension is a
//                      no-op (background does no switching). Defaults to true
//                      when unset.
// Rule shape:
//   { id: string, type: "domain"|"path"|"regex", patterns: string[],
//     container: string, enabled: boolean }
// A rule matches if ANY pattern in `patterns` matches.
// Order in the array is the match priority (first matching rule wins).
//
// Legacy: rules saved by older versions had a single `pattern` string;
// loadRules() transparently migrates those to a one-element `patterns`.

const Storage = (() => {
  const KEY_RULES = "rules";
  const KEY_DEFAULT = "defaultContainer";
  const KEY_ENABLED = "enabled";

  function normalizeRule(r) {
    if (!r || typeof r !== "object") return null;
    return {
      id: r.id || (Math.random().toString(36).slice(2, 10)),
      type: r.type || "domain",
      container: r.container || "",
      enabled: r.enabled !== false,
      patterns: Array.isArray(r.patterns)
        ? r.patterns.filter((p) => typeof p === "string")
        : (typeof r.pattern === "string" ? [r.pattern] : []),
    };
  }

  async function loadRules() {
    const obj = await browser.storage.local.get(KEY_RULES);
    const arr = Array.isArray(obj[KEY_RULES]) ? obj[KEY_RULES] : [];
    return arr.map(normalizeRule).filter(Boolean);
  }

  async function saveRules(rules) {
    await browser.storage.local.set({ [KEY_RULES]: rules });
  }

  async function loadDefaultContainer() {
    const obj = await browser.storage.local.get(KEY_DEFAULT);
    return typeof obj[KEY_DEFAULT] === "string" ? obj[KEY_DEFAULT] : "";
  }

  async function saveDefaultContainer(name) {
    await browser.storage.local.set({ [KEY_DEFAULT]: name || "" });
  }

  async function loadEnabled() {
    const obj = await browser.storage.local.get(KEY_ENABLED);
    return obj[KEY_ENABLED] !== false; // default to true
  }

  async function saveEnabled(value) {
    await browser.storage.local.set({ [KEY_ENABLED]: !!value });
  }

  async function loadAll() {
    const [rules, defaultContainer, enabled] = await Promise.all([
      loadRules(), loadDefaultContainer(), loadEnabled(),
    ]);
    return { rules, defaultContainer, enabled };
  }

  async function saveAll({ rules, defaultContainer, enabled }) {
    await browser.storage.local.set({
      [KEY_RULES]: Array.isArray(rules) ? rules.map(normalizeRule).filter(Boolean) : [],
      [KEY_DEFAULT]: typeof defaultContainer === "string" ? defaultContainer : "",
      [KEY_ENABLED]: enabled !== false,
    });
  }

  function onRulesChanged(handler) {
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes[KEY_RULES]) return;
      const next = Array.isArray(changes[KEY_RULES].newValue)
        ? changes[KEY_RULES].newValue.map(normalizeRule).filter(Boolean)
        : [];
      handler(next);
    });
  }

  function onDefaultContainerChanged(handler) {
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes[KEY_DEFAULT]) return;
      handler(typeof changes[KEY_DEFAULT].newValue === "string" ? changes[KEY_DEFAULT].newValue : "");
    });
  }

  function onEnabledChanged(handler) {
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes[KEY_ENABLED]) return;
      handler(changes[KEY_ENABLED].newValue !== false);
    });
  }

  function newId() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  return {
    loadRules, saveRules, onRulesChanged,
    loadDefaultContainer, saveDefaultContainer, onDefaultContainerChanged,
    loadEnabled, saveEnabled, onEnabledChanged,
    loadAll, saveAll,
    normalizeRule, newId,
  };
})();

if (typeof self !== "undefined") self.Storage = Storage;
if (typeof module !== "undefined" && module.exports) module.exports = Storage;
