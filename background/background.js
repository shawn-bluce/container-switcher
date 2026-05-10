"use strict";

// Top-level navigation interceptor.
//
// Strategy: on a main_frame request, look up the first matching rule. If no
// rule matches and the tab is currently in the no-container default
// (cookieStoreId === "firefox-default"), fall back to the user's configured
// default container. Once a target container is decided, cancel the request,
// open a new tab with the same URL inside that container, and only close the
// original tab if it was a fresh tab (about:newtab/about:blank/empty) — that
// way we don't blow away the user's existing browsing history when they
// click a link that needs a different container.
//
// We deliberately do NOT override an explicit container choice (e.g. a tab
// the user manually opened in "Banking") with the default — only rules win
// against an explicit container.

const FIREFOX_DEFAULT = "firefox-default";
const BLANK_URLS = new Set([
  "", "about:blank", "about:newtab", "about:home", "about:privatebrowsing",
]);

let rules = [];
let defaultContainer = "";
let enabled = true;
let configReady = false;

// Register synchronously so requests during startup are short-circuited
// rather than missed; also required so Firefox can wake up the event page
// after idle and re-attach the listener.
browser.webRequest.onBeforeRequest.addListener(
  handleRequest,
  { urls: ["<all_urls>"], types: ["main_frame"] },
  ["blocking"]
);

(async function init() {
  try {
    const cfg = await Storage.loadAll();
    rules = cfg.rules;
    defaultContainer = cfg.defaultContainer;
    enabled = cfg.enabled;
    configReady = true;
    Storage.onRulesChanged((next) => { rules = next; });
    Storage.onDefaultContainerChanged((next) => { defaultContainer = next; });
    Storage.onEnabledChanged((next) => { enabled = next; });
    console.log(
      "[container-switcher] ready, enabled: %s, rules: %d, default: %s",
      enabled, rules.length, defaultContainer || "(none)"
    );
  } catch (e) {
    console.error("[container-switcher] init failed", e);
  }
})();

async function handleRequest(details) {
  if (!configReady || !enabled) return {};
  if (details.tabId < 0) return {};

  let url;
  try { url = new URL(details.url); } catch (_) { return {}; }
  if (!/^https?:$/.test(url.protocol)) return {};

  const rule = Matcher.match(url, rules);

  // No rule + no default → nothing to do.
  if (!rule && !defaultContainer) return {};

  try {
    const tab = await browser.tabs.get(details.tabId);

    // Default container only kicks in for tabs that haven't been explicitly
    // assigned one. Rules always win.
    if (!rule && tab.cookieStoreId !== FIREFOX_DEFAULT) return {};

    const targetName = rule ? rule.container : defaultContainer;
    const container = await Containers.ensure(targetName);
    if (!container) {
      console.warn("[container-switcher] could not resolve container", targetName);
      return {};
    }
    if (tab.cookieStoreId === container.cookieStoreId) return {};

    console.log(
      "[container-switcher] %s → %s (%s)",
      url.href, container.name,
      rule ? `${rule.type} ${Matcher.patternsOf(rule).join("|")}` : "default"
    );

    await browser.tabs.create({
      url: details.url,
      cookieStoreId: container.cookieStoreId,
      active: tab.active,
      index: tab.index + 1,
      windowId: tab.windowId,
    });

    // Only close the source tab when it has no meaningful content. This
    // preserves the user's existing tab history if they clicked a link from
    // a real page that needed a different container.
    if (BLANK_URLS.has(tab.url || "")) {
      browser.tabs.remove(details.tabId).catch(() => {});
    }

    return { cancel: true };
  } catch (e) {
    console.error("[container-switcher] handleRequest failed", e, details.url);
    return {};
  }
}
