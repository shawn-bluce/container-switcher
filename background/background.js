"use strict";

// Top-level navigation interceptor.
//
// On a main_frame request, look up the first matching rule. If no rule
// matches, optionally fall back to the user's default container. Once we
// have a target container we cancel the request, open a new tab with the
// URL inside that container, and only close the source tab if it was
// blank — so user history on real pages is preserved.
//
// The non-obvious bit is when to respect an existing container choice on
// the tab. Two cases:
//
//   - Fresh tab in a named container (tab.url is about:blank/about:newtab)
//     → user just did "Open in new container tab" or "Reopen in Container".
//     Honor their choice, don't yank them to a rule's container.
//   - Navigation triggered from within a page (details.originUrl is set)
//     → an in-page link click in a container tab. The user is browsing
//     inside that container on purpose; don't yank them out.
//
// Anything else navigating in a named container — URL bar, bookmarks,
// history — is treated like a regular navigation and the rule applies.

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

    // When the tab is already in a named container, we step back — i.e.
    // honor the existing placement — in two specific situations:
    //   (a) The tab is "fresh" (still on about:blank / about:newtab),
    //       which is the signature of "Open in new container tab" /
    //       "Reopen in Container" right after the new tab is created.
    //   (b) The navigation was triggered from within a page (a link
    //       click), surfaced as a non-empty `details.originUrl`. The user
    //       picked the container for this tab on purpose; in-page links
    //       shouldn't yank them out of it.
    // Outside of these two, a navigation in a non-default container —
    // typed URL, bookmark, history pick — is treated like any other and
    // the rule fires normally.
    if (tab.cookieStoreId !== FIREFOX_DEFAULT) {
      const isFreshTab = BLANK_URLS.has(tab.url || "");
      const isInPageNav = !!details.originUrl;
      if (isFreshTab || isInPageNav) return {};
    }

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
    // a real page that needed a different container. Awaited so the
    // removal completes before we cancel; the previous fire-and-forget
    // could race with the cancel teardown and leave the empty source tab
    // dangling, producing the "two tabs after empty-tab search" symptom.
    if (BLANK_URLS.has(tab.url || "")) {
      try {
        await browser.tabs.remove(details.tabId);
      } catch (e) {
        console.warn(
          "[container-switcher] could not close source tab",
          details.tabId, tab.url, e
        );
      }
    }

    return { cancel: true };
  } catch (e) {
    console.error("[container-switcher] handleRequest failed", e, details.url);
    return {};
  }
}
