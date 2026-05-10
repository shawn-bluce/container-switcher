"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const Matcher = require("../lib/matcher.js");

const u = (s) => new URL(s);
const rule = (over = {}) => ({
  id: "x",
  type: "domain",
  patterns: [],
  container: "Work",
  enabled: true,
  ...over,
});

// --- patternsOf / legacy ---------------------------------------------------

test("patternsOf reads patterns array", () => {
  assert.deepEqual(Matcher.patternsOf({ patterns: ["a", "b"] }), ["a", "b"]);
});

test("patternsOf migrates legacy single pattern", () => {
  assert.deepEqual(Matcher.patternsOf({ pattern: "a" }), ["a"]);
});

test("patternsOf returns empty for unset", () => {
  assert.deepEqual(Matcher.patternsOf({}), []);
});

// --- domain ----------------------------------------------------------------

test("domain exact match", () => {
  const r = rule({ type: "domain", patterns: ["mail.google.com"] });
  assert.equal(Matcher.match(u("https://mail.google.com/"), [r]), r);
  assert.equal(Matcher.match(u("https://www.google.com/"), [r]), null);
});

test("domain is case-insensitive on host", () => {
  const r = rule({ type: "domain", patterns: ["Example.COM"] });
  assert.equal(Matcher.match(u("https://EXAMPLE.com/"), [r]), r);
});

test("domain wildcard matches apex and subdomains", () => {
  const r = rule({ type: "domain", patterns: ["*.google.com"] });
  assert.equal(Matcher.match(u("https://google.com/"), [r]), r);
  assert.equal(Matcher.match(u("https://mail.google.com/"), [r]), r);
  assert.equal(Matcher.match(u("https://a.b.google.com/"), [r]), r);
});

test("domain wildcard does not match unrelated hosts", () => {
  const r = rule({ type: "domain", patterns: ["*.google.com"] });
  assert.equal(Matcher.match(u("https://googlex.com/"), [r]), null);
  assert.equal(Matcher.match(u("https://notgoogle.com/"), [r]), null);
  assert.equal(Matcher.match(u("https://evil.com/?google.com"), [r]), null);
});

test("domain ignores port and path", () => {
  const r = rule({ type: "domain", patterns: ["example.com"] });
  assert.equal(Matcher.match(u("https://example.com:8443/foo"), [r]), r);
});

test("domain works with IDN punycode", () => {
  const r = rule({ type: "domain", patterns: ["xn--fsq.com"] });
  // URL parses unicode hostnames into punycode form
  assert.equal(Matcher.match(u("https://例.com/"), [r]), r);
});

// --- path ------------------------------------------------------------------

test("path glob matches host+path prefix", () => {
  const r = rule({ type: "path", patterns: ["example.com/admin/*"] });
  assert.equal(Matcher.match(u("https://example.com/admin/users"), [r]), r);
  assert.equal(Matcher.match(u("https://example.com/admin/"), [r]), r);
  assert.equal(Matcher.match(u("https://example.com/public"), [r]), null);
});

test("path glob full-string anchored", () => {
  const r = rule({ type: "path", patterns: ["example.com/admin"] });
  assert.equal(Matcher.match(u("https://example.com/admin"), [r]), r);
  assert.equal(Matcher.match(u("https://example.com/admin/x"), [r]), null);
});

test("path glob does not consider query string", () => {
  const r = rule({ type: "path", patterns: ["example.com/admin"] });
  assert.equal(Matcher.match(u("https://example.com/admin?x=1"), [r]), r);
});

test("path glob escapes regex meta", () => {
  const r = rule({ type: "path", patterns: ["example.com/foo+bar"] });
  assert.equal(Matcher.match(u("https://example.com/foo+bar"), [r]), r);
  assert.equal(Matcher.match(u("https://example.com/fooobar"), [r]), null);
});

// --- regex -----------------------------------------------------------------

test("regex matches full URL", () => {
  const r = rule({ type: "regex", patterns: ["^https://[^/]+\\.corp\\.local/"] });
  assert.equal(Matcher.match(u("https://api.corp.local/v1/x"), [r]), r);
  assert.equal(Matcher.match(u("https://corp.local/x"), [r]), null);
});

test("invalid regex never matches", () => {
  const r = rule({ type: "regex", patterns: ["[unterminated"] });
  assert.equal(Matcher.match(u("https://example.com/"), [r]), null);
});

// --- multi-pattern + ordering ---------------------------------------------

test("multi-pattern: any line matches", () => {
  const r = rule({
    type: "domain",
    patterns: ["mail.google.com", "drive.google.com"],
  });
  assert.equal(Matcher.match(u("https://drive.google.com/"), [r]), r);
  assert.equal(Matcher.match(u("https://www.google.com/"), [r]), null);
});

test("rule order — first match wins", () => {
  const a = rule({ id: "a", type: "domain", patterns: ["mail.google.com"], container: "A" });
  const b = rule({ id: "b", type: "domain", patterns: ["*.google.com"], container: "B" });
  assert.equal(Matcher.match(u("https://mail.google.com/"), [a, b]).container, "A");
  assert.equal(Matcher.match(u("https://drive.google.com/"), [a, b]).container, "B");
});

test("disabled rule skipped", () => {
  const a = rule({ id: "a", type: "domain", patterns: ["mail.google.com"], container: "A", enabled: false });
  const b = rule({ id: "b", type: "domain", patterns: ["*.google.com"], container: "B" });
  assert.equal(Matcher.match(u("https://mail.google.com/"), [a, b]).container, "B");
});

test("blank pattern lines are ignored", () => {
  const r = rule({ type: "domain", patterns: ["", "  ", "example.com"] });
  assert.equal(Matcher.match(u("https://example.com/"), [r]), r);
});

test("rule with no usable pattern never matches", () => {
  const r = rule({ type: "domain", patterns: ["", "  "] });
  assert.equal(Matcher.match(u("https://example.com/"), [r]), null);
});

// --- isValidPattern --------------------------------------------------------

test("isValidPattern: regex syntax", () => {
  assert.equal(Matcher.isValidPattern("regex", "^abc$"), true);
  assert.equal(Matcher.isValidPattern("regex", "[bad"), false);
});

test("isValidPattern: domain & path always valid", () => {
  assert.equal(Matcher.isValidPattern("domain", "anything"), true);
  assert.equal(Matcher.isValidPattern("path", "x*"), true);
});

test("isValidPattern: empty is valid (treated as not-yet-filled)", () => {
  assert.equal(Matcher.isValidPattern("regex", ""), true);
});

// --- validate --------------------------------------------------------------

test("validate: empty patterns rejected", () => {
  assert.notEqual(Matcher.validate(rule({ patterns: [] })), null);
});

test("validate: empty container rejected", () => {
  assert.notEqual(Matcher.validate(rule({ patterns: ["x.com"], container: "" })), null);
});

test("validate: bad regex rejected", () => {
  assert.notEqual(Matcher.validate(rule({ type: "regex", patterns: ["[bad"] })), null);
});

test("validate: well-formed rule passes", () => {
  assert.equal(Matcher.validate(rule({ patterns: ["x.com"], container: "Work" })), null);
});
