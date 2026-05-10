"use strict";

// Shared by background, options, popup. Exposes a global `Matcher`.
//
// A rule contains an array `patterns` plus a single `type` shared by all
// patterns. The rule matches a URL if ANY of its patterns matches under the
// rule's type.
//
// Pattern semantics by type:
//   - domain: match `url.hostname`. `*.example.com` matches the apex and any
//     subdomain. Plain `example.com` is exact host match.
//   - path:   glob (`*` = any chars) tested against `hostname + pathname`.
//             Example: `example.com/admin/*`
//   - regex:  ECMAScript regex tested against the full URL string.

const Matcher = (() => {
  function patternsOf(rule) {
    if (!rule) return [];
    if (Array.isArray(rule.patterns)) return rule.patterns;
    if (typeof rule.pattern === "string") return [rule.pattern];
    return [];
  }

  function compileOne(type, pattern) {
    switch (type) {
      case "domain": return compileDomain(pattern);
      case "path":   return compilePath(pattern);
      case "regex":  return compileRegex(pattern);
      default:       return () => false;
    }
  }

  function compile(rule) {
    const tests = patternsOf(rule)
      .map((p) => (p == null ? "" : String(p)))
      .filter((p) => p.trim() !== "")
      .map((p) => compileOne(rule.type, p));
    if (tests.length === 0) return () => false;
    return (url) => tests.some((t) => t(url));
  }

  function compileDomain(pattern) {
    const p = String(pattern || "").toLowerCase().trim();
    if (!p) return () => false;
    if (p.startsWith("*.")) {
      const suffix = p.slice(2);
      return (url) => {
        const h = url.hostname.toLowerCase();
        return h === suffix || h.endsWith("." + suffix);
      };
    }
    return (url) => url.hostname.toLowerCase() === p;
  }

  function compilePath(pattern) {
    const p = String(pattern || "").trim();
    if (!p) return () => false;
    const re = globToRegex(p);
    return (url) => re.test(url.hostname.toLowerCase() + url.pathname);
  }

  function compileRegex(pattern) {
    const re = safeRegex(pattern);
    if (!re) return () => false;
    return (url) => re.test(url.href);
  }

  function globToRegex(glob) {
    const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp("^" + escaped + "$");
  }

  function safeRegex(pattern) {
    try { return new RegExp(pattern); } catch (_) { return null; }
  }

  function isValidPattern(type, pattern) {
    const p = String(pattern || "").trim();
    if (!p) return true;
    if (type === "regex") return safeRegex(p) !== null;
    return true;
  }

  function validate(rule) {
    const filled = patternsOf(rule)
      .map((p) => String(p || "").trim())
      .filter(Boolean);
    if (filled.length === 0) return "至少填一行模式";
    if (!rule.container || !String(rule.container).trim()) return "container 不能为空";
    if (rule.type === "regex") {
      for (const p of filled) {
        if (!safeRegex(p)) return `正则无效: ${p}`;
      }
    }
    return null;
  }

  function match(url, rules) {
    for (const rule of rules) {
      if (!rule || rule.enabled === false) continue;
      if (compile(rule)(url)) return rule;
    }
    return null;
  }

  return { compile, match, validate, patternsOf, isValidPattern };
})();

if (typeof self !== "undefined") self.Matcher = Matcher;
if (typeof module !== "undefined" && module.exports) module.exports = Matcher;
