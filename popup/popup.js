"use strict";

(async function () {
  I18n.applyI18n(document);

  const hostEl = document.getElementById("host");
  const containerEl = document.getElementById("container");
  const matchEl = document.getElementById("match");
  const addBtn = document.getElementById("add-rule");
  const optionsBtn = document.getElementById("open-options");
  const enabledToggle = document.getElementById("global-enabled");
  const banner = document.getElementById("disabled-banner");

  const enabled = await Storage.loadEnabled();
  enabledToggle.checked = enabled;
  banner.hidden = enabled;

  enabledToggle.addEventListener("change", async () => {
    await Storage.saveEnabled(enabledToggle.checked);
    banner.hidden = enabledToggle.checked;
  });

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  let url = null;
  try { url = tab && tab.url ? new URL(tab.url) : null; } catch (_) { url = null; }

  if (url && /^https?:$/.test(url.protocol)) {
    hostEl.textContent = url.hostname;
  } else {
    hostEl.textContent = I18n.t("popupNonHttp");
    addBtn.disabled = true;
  }

  // current container
  try {
    if (tab && tab.cookieStoreId && tab.cookieStoreId !== "firefox-default") {
      const c = await browser.contextualIdentities.get(tab.cookieStoreId);
      containerEl.textContent = c ? c.name : tab.cookieStoreId;
    } else {
      containerEl.textContent = I18n.t("popupDefault");
    }
  } catch (_) {
    containerEl.textContent = I18n.t("popupDefault");
  }

  // matched rule
  if (url) {
    const rules = await Storage.loadRules();
    const matched = Matcher.match(url, rules);
    if (matched) {
      const patterns = Matcher.patternsOf(matched);
      const desc = patterns.length === 1 ? patterns[0] : `${patterns.length}`;
      matchEl.textContent = `${matched.type} · ${desc} → ${matched.container}`;
    } else {
      matchEl.textContent = I18n.t("popupNone");
    }
  }

  addBtn.addEventListener("click", async () => {
    if (!url) return;
    const rules = await Storage.loadRules();
    rules.push({
      id: Storage.newId(),
      type: "domain",
      patterns: [url.hostname],
      container: "",
      enabled: true,
    });
    await Storage.saveRules(rules);
    await browser.runtime.openOptionsPage();
    window.close();
  });

  optionsBtn.addEventListener("click", async () => {
    await browser.runtime.openOptionsPage();
    window.close();
  });
})();
