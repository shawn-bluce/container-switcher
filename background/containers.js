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

  // Dedupe concurrent ensure() calls for the same name: findByName + create
  // is not atomic, so without this, two parallel callers (e.g. the source-tab
  // request and the freshly-opened tab's own first request) can both miss the
  // existing container and each create a new duplicate with the same name but
  // a different cookieStoreId — which then defeats background.js's
  // "already in target container" short-circuit and produces a cascade of
  // extra tabs.
  const pending = new Map();

  async function ensure(name) {
    const trimmed = String(name || "").trim();
    if (!trimmed) return null;
    const inflight = pending.get(trimmed);
    if (inflight) return inflight;
    const p = (async () => {
      const existing = await findByName(trimmed);
      if (existing) return existing;
      return browser.contextualIdentities.create({
        name: trimmed,
        color: colorFor(trimmed),
        icon: DEFAULT_ICON,
      });
    })();
    pending.set(trimmed, p);
    try {
      return await p;
    } finally {
      pending.delete(trimmed);
    }
  }

  async function list() {
    return browser.contextualIdentities.query({});
  }

  return { ensure, findByName, list };
})();

if (typeof self !== "undefined") self.Containers = Containers;
