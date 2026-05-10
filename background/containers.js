"use strict";

// Wrappers around the contextualIdentities API.
// Exposes a global `Containers`.

const Containers = (() => {
  const COLORS = ["blue", "turquoise", "green", "yellow", "orange", "red", "pink", "purple"];
  const DEFAULT_ICON = "fingerprint";

  // Pick a stable color from a name so the same name always gets the same color.
  function colorFor(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return COLORS[h % COLORS.length];
  }

  async function findByName(name) {
    if (!name) return null;
    const list = await browser.contextualIdentities.query({ name });
    return list[0] || null;
  }

  async function ensure(name) {
    const trimmed = String(name || "").trim();
    if (!trimmed) return null;
    const existing = await findByName(trimmed);
    if (existing) return existing;
    return browser.contextualIdentities.create({
      name: trimmed,
      color: colorFor(trimmed),
      icon: DEFAULT_ICON,
    });
  }

  async function list() {
    return browser.contextualIdentities.query({});
  }

  return { ensure, findByName, list };
})();

if (typeof self !== "undefined") self.Containers = Containers;
