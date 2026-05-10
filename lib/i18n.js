"use strict";

// Tiny helper to apply browser.i18n.getMessage() onto DOM nodes that carry
// data-i18n / data-i18n-placeholder / data-i18n-title / data-i18n-aria
// attributes. Call applyI18n(document) once after the DOM is ready.

const I18n = (() => {
  function t(key, substitutions) {
    if (!key) return "";
    try {
      return browser.i18n.getMessage(key, substitutions) || key;
    } catch (_) {
      return key;
    }
  }

  function applyI18n(root) {
    root.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    });
    root.querySelectorAll("[data-i18n-title]").forEach((el) => {
      el.title = t(el.dataset.i18nTitle);
    });
    root.querySelectorAll("[data-i18n-aria]").forEach((el) => {
      el.setAttribute("aria-label", t(el.dataset.i18nAria));
    });
  }

  return { t, applyI18n };
})();

if (typeof self !== "undefined") self.I18n = I18n;
