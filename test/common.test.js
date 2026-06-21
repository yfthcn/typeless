// ==============================
// TypeLess — Unit tests (node:test, zero-dependency)
// Run: npm test   (or: node --test)
// Exercises only the pure helpers in common.js — nothing touches chrome.*
// ==============================
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const TL = require("../common.js");

// --- Shortcut char-class (plan step 1) ---
test("stripShortcut keeps the allowed class, drops the rest, trims hyphens", () => {
  assert.equal(TL.stripShortcut("my-temp"), "my-temp");
  assert.equal(TL.stripShortcut("şifre"), "ifre");        // Turkish stripped (ASCII class)
  assert.equal(TL.stripShortcut("a b!c@"), "abc");
  assert.equal(TL.stripShortcut("trail-"), "trail");       // trailing hyphen trimmed
});

test("slashRegex matches hyphenated shortcuts (the original bug)", () => {
  assert.ok(TL.slashRegex().test("hello /my-temp"));
  assert.equal(TL.slashRegex().exec("x /pass")[1], "pass");
  assert.equal(TL.slashRegex().exec("/a-b-c")[1], "a-b-c");
});

// --- Schema migration (plan step 7) ---
test("migrate v1 → v2 assigns stable ids, order and schemaVersion", () => {
  const v1 = { templates: [{ name: "A", body: "x" }, { name: "B", body: "y" }], uiLang: "tr" };
  const m = TL.migrate(v1);
  assert.equal(m.schemaVersion, 2);
  assert.equal(m.uiLang, "tr");                  // unknown/other keys preserved
  assert.equal(m.templates[0].order, 0);
  assert.ok(m.templates[0].id.startsWith("t_"));
  assert.equal(m.quickSlots.length, 3);
});

test("migrate is deterministic across contexts and idempotent", () => {
  const input = { templates: [{ name: "A", body: "x" }, { name: "B", body: "y" }] };
  const a = TL.migrate(input);
  const b = TL.migrate(input);
  assert.deepEqual(a.templates.map((t) => t.id), b.templates.map((t) => t.id));
  const again = TL.migrate(a);
  assert.deepEqual(again.templates.map((t) => t.id), a.templates.map((t) => t.id));
});

test("migrate disambiguates identical templates deterministically", () => {
  const m = TL.migrate({ templates: [{ name: "A", body: "x" }, { name: "A", body: "x" }] });
  assert.notEqual(m.templates[0].id, m.templates[1].id);
});

test("migrate tolerates garbage input", () => {
  assert.equal(TL.migrate(null).templates.length, 0);
  assert.equal(TL.migrate({ templates: "nope" }).templates.length, 0);
  assert.equal(TL.migrate([]).templates.length, 0);
});

// --- Dynamic variables (plan step 10) ---
test("applyDynamicVars resolves date/time/datetime with injected clock", () => {
  const d = new Date(2026, 5, 20, 9, 5); // Jun 20 2026, 09:05 (month is 0-based)
  assert.equal(TL.applyDynamicVars("{{date}}", d), "2026-06-20");
  assert.equal(TL.applyDynamicVars("{{time}}", d), "09:05");
  assert.equal(TL.applyDynamicVars("{{datetime}}", d), "2026-06-20 09:05");
});

test("applyDynamicVars supports +/- day/week/month/year offsets", () => {
  const d = new Date(2026, 5, 20, 9, 5);
  assert.equal(TL.applyDynamicVars("{{date+3d}}", d), "2026-06-23");
  assert.equal(TL.applyDynamicVars("{{date-1w}}", d), "2026-06-13");
  assert.equal(TL.applyDynamicVars("{{date+1m}}", d), "2026-07-20");
  assert.equal(TL.applyDynamicVars("{{date+1y}}", d), "2027-06-20");
});

test("applyDynamicVars converts {{cursor}} to the sentinel", () => {
  const out = TL.applyDynamicVars("a{{cursor}}b");
  assert.equal(out, "a" + TL.CURSOR_TOKEN + "b");
});

// --- Field parsing (plan step 11) ---
test("parseFields reads pipe syntax and skips dynamic + duplicate names", () => {
  const f = TL.parseFields("Hi {{name|Customer|text|Guest}} pri {{p|Pri|dropdown||low,high}} on {{date}} {{name}}");
  assert.equal(f.length, 2);
  assert.equal(f[0].label, "Customer");
  assert.equal(f[0].def, "Guest");
  assert.equal(f[1].type, "dropdown");
  assert.deepEqual(f[1].options, ["low", "high"]);
});

test("parseFields remember flag respects secret-name opt-out", () => {
  assert.equal(TL.parseFields("{{email|E|text||  |remember}}")[0].remember, true);
  assert.equal(TL.parseFields("{{password|P|text||  |remember}}")[0].remember, false);
});

test("fillTemplate substitutes values, ignoring pipe metadata", () => {
  assert.equal(TL.fillTemplate("Hi {{name|Customer|text}}", { name: "Bob" }), "Hi Bob");
  assert.equal(TL.fillTemplate("{{a}}-{{b}}", { a: "1", b: "2" }), "1-2");
});

// --- Import validation summary + caps (plan steps 6/7) ---
test("validateTemplates reports accepted/rejected/truncated", () => {
  const v = TL.validateTemplates([
    { name: "ok", body: "hello" },
    { name: "bad" },                       // no body → rejected
    { body: "z".repeat(TL.LIMITS.MAX_BODY + 100) }, // truncated
  ]);
  assert.equal(v.accepted.length, 2);
  assert.equal(v.rejected, 1);
  assert.equal(v.truncated, 1);
  assert.equal(v.accepted[1].body.length, TL.LIMITS.MAX_BODY);
});

test("validateTemplates caps at MAX_TEMPLATES", () => {
  const many = Array.from({ length: TL.LIMITS.MAX_TEMPLATES + 50 }, (_, i) => ({ body: "b" + i }));
  assert.equal(TL.validateTemplates(many).accepted.length, TL.LIMITS.MAX_TEMPLATES);
});

// --- Backup ring (plan step 14) ---
test("ringPush keeps newest first and caps length", () => {
  let r = [];
  for (let i = 1; i <= 7; i++) r = TL.ringPush(r, i, 5);
  assert.deepEqual(r, [7, 6, 5, 4, 3]);
});

// --- Competitor adapters (plan step 16) ---
test("adaptTextBlaze maps snippets and converts {formtext} tokens", () => {
  const r = TL.detectAndAdapt([{ shortcut: "/hi", snippet: "Hello {formtext: name=Customer}" }]);
  assert.equal(r.source, "textblaze");
  assert.equal(r.items[0].shortcut, "hi");
  assert.equal(r.items[0].body, "Hello {{Customer}}");
});

test("adaptMagical maps expansions and keeps {{tokens}}", () => {
  const r = TL.detectAndAdapt({ expansions: [{ trigger: "-sig", expansion: "Best, {{me}}" }] });
  assert.equal(r.source, "magical");
  assert.equal(r.items[0].shortcut, "sig");
  assert.equal(r.items[0].body, "Best, {{me}}");
});

test("detectAndAdapt returns null for native TypeLess JSON", () => {
  assert.equal(TL.detectAndAdapt([{ name: "x", body: "native" }]), null);
});

// --- Fuzzy + search (plan step 17) ---
test("fuzzyScore matches subsequences and rejects non-matches", () => {
  assert.ok(TL.fuzzyScore("pw", "password") >= 0);
  assert.ok(TL.fuzzyScore("pas", "password") > TL.fuzzyScore("swd", "password"));
  assert.equal(TL.fuzzyScore("zzz", "password"), -1);
});

test("fuzzySearch ranks shortcut matches and limits results", () => {
  const tpls = [
    { id: "1", shortcut: "pass", name: "Password" },
    { id: "2", shortcut: "info", name: "Info" },
    { id: "3", shortcut: "para", name: "Paragraph" },
  ];
  const r = TL.fuzzySearch("pa", tpls, 8);
  assert.ok(r.length >= 2);
  assert.ok(["pass", "para"].includes(r[0].shortcut));
});

test("searchTemplates does full-text over name/shortcut/body/tags", () => {
  const tpls = [
    { id: "1", name: "Greeting", shortcut: "hi", body: "Hello", tags: ["welcome"] },
    { id: "2", name: "Bye", shortcut: "bye", body: "Goodbye", tags: [] },
  ];
  assert.equal(TL.searchTemplates("welcome", tpls).length, 1);
  assert.equal(TL.searchTemplates("good", tpls)[0].id, "2");
  assert.equal(TL.searchTemplates("", tpls).length, 2);
});

test("isSecretName flags credential-like field names", () => {
  for (const n of ["password", "otp", "cvv", "api_key", "secret", "pin", "token"]) {
    assert.equal(TL.isSecretName(n), true, n);
  }
  assert.equal(TL.isSecretName("customer_name"), false);
});
