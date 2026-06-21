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

// ============================================================
// Rich-text sanitizer (the trust boundary) — XSS corpus
// ============================================================
test("sanitizeHtml keeps the formatting allowlist", () => {
  assert.equal(TL.sanitizeHtml("<b>a</b><i>b</i><u>c</u><s>d</s>"), "<b>a</b><i>b</i><u>c</u><s>d</s>");
  assert.equal(TL.sanitizeHtml("<p>x</p><ul><li>a</li></ul>"), "<p>x</p><ul><li>a</li></ul>");
  assert.equal(TL.sanitizeHtml("line<br>break"), "line<br>break");
});

test("sanitizeHtml unwraps non-allowlisted formatting elements", () => {
  assert.equal(TL.sanitizeHtml("<div>x<span>y</span><font>z</font></div>"), "xyz");
  assert.equal(TL.sanitizeHtml("<h1>Title</h1>"), "Title");
});

test("sanitizeHtml removes dangerous elements with their subtree", () => {
  assert.equal(TL.sanitizeHtml("a<script>alert(1)</script>b"), "ab");
  assert.equal(TL.sanitizeHtml("a<style>* {}</style>b"), "ab");
  assert.equal(TL.sanitizeHtml("a<iframe src=x></iframe>b"), "ab");
  assert.equal(TL.sanitizeHtml("<object data=x></object>ok"), "ok");
});

test("sanitizeHtml: void kill-tags drop only themselves, keep trailing content", () => {
  // Regression: <base>/<meta>/<link>/<frame> are void; they must not swallow
  // everything after them in the DOM-free fallback.
  assert.equal(TL.sanitizeHtml("text<base href=x>more"), "textmore");
  assert.equal(TL.sanitizeHtml("a<meta charset=utf-8>b<link rel=x>c"), "abc");
  assert.equal(TL.sanitizeHtml("<b>x</b><base>after"), "<b>x</b>after");
});

test("sanitizeHtml drops all attributes including event handlers", () => {
  assert.equal(TL.sanitizeHtml('<b onclick="x" style="color:red" class="y" id="z">t</b>'), "<b>t</b>");
  assert.equal(TL.sanitizeHtml('<img src=x onerror=alert(1)>hi'), "hi");
});

test("sanitizeHtml neutralizes dangerous href schemes, keeps link text", () => {
  assert.equal(TL.sanitizeHtml('<a href="javascript:alert(1)">x</a>'), "<a>x</a>");
  assert.equal(TL.sanitizeHtml('<a href="data:text/html,<script>">x</a>'), "<a>x</a>");
  assert.equal(TL.sanitizeHtml('<a href="vbscript:msgbox">x</a>'), "<a>x</a>");
  assert.equal(TL.sanitizeHtml('<a href="//evil.com">x</a>'), "<a>x</a>"); // scheme-relative
  assert.equal(TL.sanitizeHtml('<a href="java\tscript:x">y</a>'), "<a>y</a>"); // tab-split
});

test("sanitizeHtml keeps safe hrefs and forces rel", () => {
  const s = TL.sanitizeHtml('<a href="https://example.com">x</a>');
  assert.ok(s.includes('href="https://example.com"'));
  assert.ok(s.includes('rel="noopener noreferrer nofollow"'));
  assert.ok(TL.sanitizeHtml('<a href="mailto:a@b.com">m</a>').includes('href="mailto:a@b.com"'));
});

test("fillTemplate escape:true blocks markup injection at the HTML sink", () => {
  const out = TL.fillTemplate("Hi {{n}}", { n: '<img src=x onerror=alert(1)>' }, { escape: true });
  assert.ok(!out.includes("<img"));
  assert.equal(out, "Hi &lt;img src=x onerror=alert(1)&gt;");
  // and the full pipeline (fill->sanitize) yields no executable markup —
  // the payload survives only as inert, escaped text (no real <img> tag).
  const sanitized = TL.sanitizeHtml(out);
  assert.ok(!sanitized.includes("<img"));
});

test("htmlToPlainText degrades formatting readably and keeps the cursor sentinel", () => {
  assert.equal(TL.htmlToPlainText("<p>Hi</p><ul><li>a</li><li>b</li></ul>"), "Hi\n- a\n- b");
  assert.equal(TL.htmlToPlainText('<a href="https://x.com">site</a>'), "site (https://x.com)");
  assert.equal(TL.htmlToPlainText("x<br>y"), "x\ny");
  const withCursor = "a" + TL.CURSOR_TOKEN + "b";
  assert.ok(TL.htmlToPlainText("<b>" + withCursor + "</b>").includes(TL.CURSOR_TOKEN));
});

// ============================================================
// Field-builder serializer (plan: body-rewrite)
// ============================================================
test("buildFieldToken emits the minimal canonical token", () => {
  assert.equal(TL.buildFieldToken({ name: "city", type: "text", label: "city", def: "", options: [], remember: false }), "{{city}}");
  assert.equal(
    TL.buildFieldToken({ name: "p", label: "Priority", type: "dropdown", def: "", options: ["low", "high"], remember: false }),
    "{{p|Priority|dropdown||low,high}}"
  );
  assert.ok(TL.buildFieldToken({ name: "email", label: "email", type: "text", def: "", options: [], remember: true }).endsWith("|remember}}"));
  assert.ok(!TL.buildFieldToken({ name: "password", type: "text", remember: true, label: "password", def: "", options: [] }).includes("remember"));
});

test("buildFieldToken strips pipe/brace/comma metacharacters from values", () => {
  const tok = TL.buildFieldToken({ name: "x", label: "a|b}c{", type: "text", def: "p,q", options: [], remember: false });
  // The label/default metachars are gone; only the canonical pipe separators remain.
  assert.ok(tok.includes("abc"), tok);
  assert.ok(!tok.includes("a|b"), tok);
  assert.ok(!tok.includes("}c{"), tok);
  assert.ok(tok.includes("pq") && !tok.includes("p,q"), tok);
  // re-parses cleanly (no broken field)
  assert.equal(TL.parseFields(tok).length, 1);
});

test("parseFields(buildFieldToken(f)) is a stable round-trip for every field shape", () => {
  const bodies = [
    "{{name}}",
    "{{name|Customer}}",
    "{{when|Date|date}}",
    "{{note|Note|multiline|hi}}",
    "{{p|Pri|dropdown|low|low,med,high}}",
    "{{email|Email|text||x|remember}}",
  ];
  for (const body of bodies) {
    const f = TL.parseFields(body)[0];
    const reparsed = TL.parseFields(TL.buildFieldToken(f))[0];
    assert.deepEqual(reparsed, f, body);
  }
});

// ============================================================
// format flag threading
// ============================================================
test("migrate preserves format:html and omits it for plain templates", () => {
  const m = TL.migrate({ templates: [{ name: "h", body: "<b>x</b>", format: "html" }, { name: "p", body: "plain" }] });
  assert.equal(m.templates[0].format, "html");
  assert.equal("format" in m.templates[1], false);
});

test("validateTemplates re-sanitizes an imported html body", () => {
  const v = TL.validateTemplates([{ name: "evil", body: "<b>ok</b><script>alert(1)</script>", format: "html" }]);
  assert.equal(v.accepted[0].format, "html");
  assert.equal(v.accepted[0].body, "<b>ok</b>");
  assert.ok(!v.accepted[0].body.includes("script"));
});
