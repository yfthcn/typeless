// @ts-check
// ==============================
// TypeLess — Common utilities
// ==============================
// i18n, escaping, validation, storage, schema migration, dynamic
// variables, placeholder parsing, backups, competitor adapters and
// the fuzzy scorer — shared by popup.js, options.js, content.js and
// background.js. Designed to run in service worker, page and Node
// (unit-test) contexts. Zero runtime dependencies.
// ==============================

/**
 * @typedef {Object} TLField
 * @property {string} name      Placeholder key, e.g. "customer_name"
 * @property {string} label     Human label shown in the form
 * @property {"text"|"multiline"|"dropdown"|"date"} type
 * @property {string} def       Default value
 * @property {string[]} options Dropdown options (type === "dropdown")
 * @property {boolean} remember Pre-fill with the last value used
 */

/**
 * @typedef {Object} TLTemplate
 * @property {string} id        Stable, deterministic id
 * @property {number} order     Position (decoupled from array index)
 * @property {string} name
 * @property {string} shortcut
 * @property {string} body
 * @property {string[]} [tags]
 * @property {TLField[]} [fields]
 * @property {"text"|"html"} [format]  Absent === "text" (plain). "html" => body holds sanitized HTML.
 */

(function (/** @type {any} */ global) {
  "use strict";

  // No-clobber guard: if TypeLess is already loaded in this context
  // (e.g. content-script re-injection via the executeScript fallback),
  // keep the existing TL — including its live cache — and bail out so we
  // never re-register listeners or wipe state. (Plan step 2)
  if (global.TL) return;

  // --- Browser polyfill: Chrome/Edge use chrome.*, Firefox uses browser.* ---
  if (typeof global.browser === "undefined" && typeof global.chrome !== "undefined") {
    global.browser = global.chrome;
  } else if (typeof global.chrome === "undefined" && typeof global.browser !== "undefined") {
    global.chrome = global.browser;
  }

  const TL = {};

  // --- Limits / hardening caps (plan step 7) ---
  TL.LIMITS = Object.freeze({
    MAX_TEMPLATES: 500,
    MAX_NAME: 200,
    MAX_SHORTCUT: 50,
    MAX_BODY: 20000,
    MAX_TAGS: 20,
    MAX_TAG_LEN: 30,
    MAX_FIELDS: 30,
    MAX_OPTIONS: 50,
    MAX_BACKUPS: 5,
    MAX_IMPORT_BYTES: 2 * 1024 * 1024, // 2 MB
  });

  // --- Schema version ---
  TL.CURRENT_SCHEMA = 2;

  // ============================================================
  // i18n
  // ============================================================
  let uiStrings = {};
  let activeLang = "en";

  /**
   * Load localized strings. Falls back to chrome.i18n if custom locale fails.
   * @param {string} [langPref] - "auto" | "en" | "tr"
   */
  TL.loadLocale = async function (langPref = "auto") {
    activeLang = langPref;
    if (activeLang === "auto") {
      const browserLang = (chrome.i18n.getUILanguage?.() || "en").toLowerCase();
      activeLang = browserLang.startsWith("tr") ? "tr" : "en";
    }
    try {
      const url = chrome.runtime.getURL(`_locales/${activeLang}/messages.json`);
      const res = await fetch(url);
      const data = await res.json();
      uiStrings = {};
      for (const [k, v] of Object.entries(data)) uiStrings[k] = v.message;
    } catch (err) {
      console.warn("[TypeLess] Locale load failed, using fallback:", err);
      uiStrings = {};
    }
  };

  /**
   * Get translated message. Supports $PLACEHOLDER$ substitution.
   * @param {string} key
   * @param {Array<string>|string} [subs]
   * @returns {string}
   */
  TL.t = function (key, subs) {
    let msg = uiStrings[key];
    if (!msg) {
      try { msg = chrome.i18n.getMessage(key, subs); } catch (_) {}
    }
    if (!msg) return key;
    if (subs != null) {
      const arr = Array.isArray(subs) ? [...subs] : [String(subs)];
      msg = msg.replace(/\$(\w+)\$/g, () => arr.shift() ?? "");
    }
    return msg;
  };

  // ============================================================
  // Escaping
  // ============================================================
  const HTML_ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  TL.escapeHtml = (str) => String(str ?? "").replace(/[&<>"']/g, (c) => HTML_ESC_MAP[c]);

  TL.sanitizeFilename = (name) => {
    const cleaned = String(name ?? "")
      .replace(/[^\p{L}\p{N}_\- ]+/gu, "_")
      .replace(/\s+/g, "_")
      .slice(0, 50);
    return cleaned || "template";
  };

  // ============================================================
  // Rich-text sanitizer (the ONE sanctioned HTML insertion path).
  // This is the entire trust boundary for rich templates. Everything
  // outside this function builds UI with createElement + textContent.
  // Authoritative path: DOMParser (inert) -> allowlist tree rebuild.
  // A guarded, DOM-free fallback runs ONLY under node:test so the suite
  // can assert identical security outcomes; production always has a DOM.
  // ============================================================
  TL.ALLOWED_TAGS = Object.freeze(new Set(
    ["b", "strong", "i", "em", "u", "s", "a", "br", "p", "ul", "ol", "li"]
  ));
  // Removed together with their entire subtree (content discarded).
  TL.KILL_TAGS = Object.freeze(new Set(
    ["script", "style", "iframe", "object", "embed", "link", "meta", "base",
     "form", "svg", "math", "template", "noscript", "title", "head", "frame", "frameset"]
  ));
  // Void / never-closed kill-tags: drop the tag but do NOT enter "skip subtree"
  // state — they have no subtree, and otherwise everything after a
  // <base>/<meta>/<link>/<frame> would be swallowed in the DOM-free fallback.
  const VOID_KILL = new Set(["link", "meta", "base", "frame"]);
  const SAFE_PROTOCOLS = ["http:", "https:", "mailto:", "tel:"];

  /** Decode the handful of entities we care about (for the DOM-free fallback). */
  function decodeEntities(s) {
    return String(s)
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
      .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"').replace(/&apos;/gi, "'").replace(/&#39;/g, "'")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&"); // last, so &amp;lt; -> &lt; (literal)
  }
  function safeCodePoint(n) {
    try { return (n > 0 && n <= 0x10ffff) ? String.fromCodePoint(n) : ""; } catch (_) { return ""; }
  }

  /** Validate an href; returns a safe value or null. Rejects scheme-relative. */
  function cleanHref(href) {
    if (!href) return null;
    // Strip control chars + ALL whitespace so "java\tscript:" === "javascript:".
    const s = decodeEntities(String(href)).replace(/[\u0000-\u0020\u007F]/g, "");
    if (!s || s.startsWith("//")) return null; // scheme-relative -> reject
    if (typeof document !== "undefined") {
      try {
        const a = document.createElement("a");
        a.href = s;
        return SAFE_PROTOCOLS.includes(a.protocol.toLowerCase()) ? s : null;
      } catch (_) { /* fall through */ }
    }
    return /^(https?:|mailto:|tel:)/i.test(s) ? s : null;
  }

  function renderOpenTag(tag, href) {
    if (tag === "br") return "<br>";
    if (tag === "a") {
      const safe = cleanHref(href);
      return safe
        ? `<a href="${TL.escapeHtml(safe)}" rel="noopener noreferrer nofollow">`
        : "<a>";
    }
    return `<${tag}>`;
  }

  // --- Authoritative DOM path ---
  function sanitizeWithDom(dirty) {
    const doc = new DOMParser().parseFromString(dirty, "text/html");
    const out = [];
    walkDom(doc.body, out);
    return out.join("");
  }
  function walkDom(node, out) {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) { out.push(TL.escapeHtml(child.nodeValue)); continue; }
      if (child.nodeType !== 1) continue; // comments / others dropped
      const tag = child.tagName.toLowerCase();
      if (TL.KILL_TAGS.has(tag)) continue;            // drop subtree
      if (!TL.ALLOWED_TAGS.has(tag)) { walkDom(child, out); continue; } // unwrap
      if (tag === "br") { out.push("<br>"); continue; }
      out.push(renderOpenTag(tag, child.getAttribute && child.getAttribute("href")));
      walkDom(child, out);
      out.push(`</${tag}>`);
    }
  }

  // --- DOM-free fallback (node:test only) ---
  function sanitizeFallback(dirty) {
    const out = [];
    const stack = [];
    let kill = 0;
    const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>])*)>|([^<]+)/g;
    let m;
    while ((m = re.exec(dirty)) !== null) {
      if (m[4] != null) { if (!kill) out.push(TL.escapeHtml(decodeEntities(m[4]))); continue; }
      if (m[2] === undefined) continue; // comment
      const closing = m[1] === "/";
      const tag = m[2].toLowerCase();
      if (TL.KILL_TAGS.has(tag)) {
        const selfClose = /\/\s*$/.test(m[3] || "");
        if (closing) { if (kill) kill--; }
        else if (!VOID_KILL.has(tag) && !selfClose) kill++;
        continue;
      }
      if (kill) continue;
      if (!TL.ALLOWED_TAGS.has(tag)) continue; // unwrap
      if (tag === "br") { if (!closing) out.push("<br>"); continue; }
      if (closing) {
        const idx = stack.lastIndexOf(tag);
        if (idx >= 0) { for (let k = stack.length - 1; k >= idx; k--) out.push(`</${stack[k]}>`); stack.length = idx; }
      } else {
        let href = null;
        if (tag === "a") {
          const hm = /href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[3] || "");
          if (hm) href = hm[2] ?? hm[3] ?? hm[4];
        }
        out.push(renderOpenTag(tag, href));
        stack.push(tag);
      }
    }
    for (let k = stack.length - 1; k >= 0; k--) out.push(`</${stack[k]}>`);
    return out.join("");
  }

  /**
   * Sanitize untrusted HTML down to a tiny formatting allowlist.
   * @param {string} dirty
   * @returns {string} safe HTML
   */
  TL.sanitizeHtml = function (dirty) {
    const src = String(dirty ?? "");
    if (!src) return "";
    return typeof DOMParser !== "undefined" ? sanitizeWithDom(src) : sanitizeFallback(src);
  };

  /**
   * Parse an ALREADY-sanitized HTML string into a DocumentFragment of nodes via
   * DOMParser (inert) + importNode — instead of innerHTML / createContextualFragment.
   * Functionally identical, but uses no linter-flagged DOM-write sink, so the
   * AMO / web-ext validator stays clean. ONLY ever call this on sanitizeHtml output.
   * @param {string} safeHtml
   * @returns {DocumentFragment}
   */
  TL.htmlToFragment = function (safeHtml) {
    const frag = document.createDocumentFragment();
    const doc = new DOMParser().parseFromString(String(safeHtml ?? ""), "text/html");
    for (const node of Array.from(doc.body.childNodes)) {
      frag.appendChild(document.importNode(node, true));
    }
    return frag;
  };

  /** Strip every remaining tag (used by htmlToPlainText). */
  const stripTags = (s) => String(s).replace(/<\/?[a-zA-Z][^>]*>/g, "");

  /**
   * Convert (sanitized) HTML to readable plain text for input/textarea targets.
   * Preserves the {{cursor}} sentinel so caret placement still works.
   * @param {string} html
   * @returns {string}
   */
  TL.htmlToPlainText = function (html) {
    let s = String(html ?? "");
    s = s.replace(/<br\s*\/?>/gi, "\n");
    s = s.replace(/<li[^>]*>/gi, "- ");
    s = s.replace(/<\/(p|div|li|ul|ol|h[1-6])>/gi, "\n");
    s = s.replace(
      /<a\b[^>]*href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi,
      (_m, _q, h1, h2, h3, text) => {
        const href = (h1 ?? h2 ?? h3 ?? "").trim();
        const t = stripTags(text).trim();
        return href && href !== t ? `${t} (${href})` : t;
      }
    );
    s = stripTags(s);
    s = decodeEntities(s);
    s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
    return s.replace(/^\n+|\s+$/g, "");
  };

  // ============================================================
  // Shortcut char-class — single source of truth (plan step 1)
  // ASCII A-Z a-z 0-9 _ - : the only real bug was the missing hyphen,
  // and stored data is already ASCII-stripped, so Unicode would force a
  // needless migration. content.js (slash), options.js (live-strip) and
  // validateTemplates all derive from this one constant.
  // ============================================================
  TL.SHORTCUT_CHARS = "A-Za-z0-9_-";

  /** Strip a shortcut down to the allowed char-class; trim trailing hyphens. */
  TL.stripShortcut = (s) =>
    String(s ?? "")
      .replace(new RegExp(`[^${TL.SHORTCUT_CHARS}]`, "g"), "")
      .replace(/-+$/, "")
      .slice(0, TL.LIMITS.MAX_SHORTCUT);

  /** Fresh regex per call (avoids shared lastIndex). Matches a trailing /shortcut. */
  TL.slashRegex = () => new RegExp(`\\/([${TL.SHORTCUT_CHARS}]+)$`);

  // ============================================================
  // Deterministic id + schema migration (plan step 7)
  // ============================================================
  /** FNV-1a 32-bit hash → 8 hex chars. Deterministic across contexts. */
  TL.hashId = function (str) {
    let h = 0x811c9dc5;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return ("00000000" + (h >>> 0).toString(16)).slice(-8);
  };

  /** Deterministic id from name+body (NOT random — concurrent migrations converge). */
  TL.makeId = (tpl) => "t_" + TL.hashId(String(tpl?.name ?? "") + " " + String(tpl?.body ?? ""));

  /**
   * Forward-only, pure, idempotent migration of a raw storage object to schema v2.
   * Never drops unknown keys; assigns stable ids + order to legacy templates.
   * @param {any} store
   * @returns {{schemaVersion:number, templates:TLTemplate[], quickSlots:(string|null)[], [k:string]:any}}
   */
  TL.migrate = function (store) {
    const s = (store && typeof store === "object" && !Array.isArray(store)) ? store : {};
    const rawTemplates = Array.isArray(s.templates) ? s.templates : [];
    const out = { ...s };
    const seen = new Set();

    out.templates = rawTemplates.map((t, i) => {
      const base = (t && typeof t === "object") ? t : {};
      const name = String(base.name ?? "").slice(0, TL.LIMITS.MAX_NAME);
      const body = String(base.body ?? "");
      let id = (typeof base.id === "string" && base.id) ? base.id : TL.makeId({ name, body });
      while (seen.has(id)) id += "x"; // deterministic collision disambiguation
      seen.add(id);

      /** @type {TLTemplate} */
      const tpl = {
        id,
        order: (typeof base.order === "number") ? base.order : i,
        name,
        shortcut: TL.stripShortcut(base.shortcut),
        body,
      };
      if (Array.isArray(base.tags)) tpl.tags = TL.normalizeTags(base.tags);
      if (Array.isArray(base.fields)) tpl.fields = TL.validateFields(base.fields);
      if (base.format === "html") tpl.format = "html"; // storage already sanitized; copy hint
      return tpl;
    });

    if (!Array.isArray(out.quickSlots)) {
      const ordered = [...out.templates].sort((a, b) => a.order - b.order);
      out.quickSlots = [0, 1, 2].map((i) => ordered[i]?.id ?? null);
    }
    out.schemaVersion = TL.CURRENT_SCHEMA;
    return out;
  };

  TL.normalizeTags = (tags) =>
    (Array.isArray(tags) ? tags : [])
      .map((x) => String(x ?? "").trim().slice(0, TL.LIMITS.MAX_TAG_LEN))
      .filter(Boolean)
      .slice(0, TL.LIMITS.MAX_TAGS);

  // ============================================================
  // Storage wrappers
  // ============================================================

  /** Read templates, migrate-on-read (no write), order-sorted. */
  TL.getTemplates = async function () {
    const { templates = [] } = await chrome.storage.local.get("templates");
    const migrated = TL.migrate({ templates });
    return migrated.templates.sort((a, b) => a.order - b.order);
  };

  /** Persist templates: re-stamp order by array index, ensure ids + caps. */
  TL.setTemplates = function (templates) {
    const norm = (Array.isArray(templates) ? templates : [])
      .slice(0, TL.LIMITS.MAX_TEMPLATES)
      .map((t, i) => {
        const name = String(t.name ?? "").slice(0, TL.LIMITS.MAX_NAME);
        // HTML templates are re-sanitized on write so storage NEVER holds dirty HTML.
        const isHtml = t.format === "html";
        const body = (isHtml ? TL.sanitizeHtml(String(t.body ?? "")) : String(t.body ?? "")).slice(0, TL.LIMITS.MAX_BODY);
        /** @type {TLTemplate} */
        const tpl = {
          id: (typeof t.id === "string" && t.id) ? t.id : TL.makeId({ name, body }),
          order: i,
          name,
          shortcut: TL.stripShortcut(t.shortcut),
          body,
        };
        if (Array.isArray(t.tags)) tpl.tags = TL.normalizeTags(t.tags);
        if (Array.isArray(t.fields)) tpl.fields = TL.validateFields(t.fields);
        if (isHtml) tpl.format = "html";
        return tpl;
      });
    return chrome.storage.local.set({ templates: norm, schemaVersion: TL.CURRENT_SCHEMA });
  };

  TL.getLang = async function () {
    const { uiLang = "auto" } = await chrome.storage.local.get("uiLang");
    return uiLang;
  };
  TL.setLang = (lang) => chrome.storage.local.set({ uiLang: lang });

  // --- Tab paste helpers (shared by popup + background) ---
  TL.isSystemUrl = (url) => {
    if (!url) return true;
    if (/^(chrome|edge|brave|opera|about|moz-extension|chrome-extension):/i.test(url)) return true;
    return url.includes("chrome.google.com/webstore")
        || url.includes("microsoftedge.microsoft.com/addons")
        || url.includes("addons.mozilla.org");
  };

  TL.pasteToTab = async (tabId, template, injectDelayMs = 150) => {
    const msg = { type: "PASTE_TEMPLATE", template };
    try {
      await chrome.tabs.sendMessage(tabId, msg);
    } catch {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ["common.js", "content.js"],
      });
      await new Promise((r) => setTimeout(r, injectDelayMs));
      await chrome.tabs.sendMessage(tabId, msg);
    }
  };

  // ============================================================
  // Field validation + import validation summary (plan steps 6, 11)
  // ============================================================
  const FIELD_TYPES = ["text", "multiline", "dropdown", "date"];

  /** @param {any} fields @returns {TLField[]} */
  TL.validateFields = function (fields) {
    return (Array.isArray(fields) ? fields : [])
      .filter((f) => f && typeof f === "object" && typeof f.name === "string" && f.name.trim())
      .slice(0, TL.LIMITS.MAX_FIELDS)
      .map((f) => {
        const type = FIELD_TYPES.includes(String(f.type)) ? String(f.type) : "text";
        /** @type {TLField} */
        const out = {
          name: String(f.name).trim().slice(0, TL.LIMITS.MAX_NAME),
          label: String(f.label ?? f.name).slice(0, TL.LIMITS.MAX_NAME),
          type: /** @type {any} */ (type),
          def: String(f.def ?? "").slice(0, TL.LIMITS.MAX_BODY),
          options: Array.isArray(f.options)
            ? f.options.map((o) => String(o).slice(0, TL.LIMITS.MAX_NAME)).slice(0, TL.LIMITS.MAX_OPTIONS)
            : [],
          remember: f.remember === true && !TL.isSecretName(f.name),
        };
        return out;
      });
  };

  /**
   * Validate + normalize imported templates, returning a summary so the UI
   * can report what was accepted / rejected / truncated.
   * @param {unknown} raw
   * @returns {{accepted:Array<{name:string,shortcut:string,body:string,tags?:string[],fields?:TLField[],format?:"text"|"html"}>, rejected:number, truncated:number}}
   */
  TL.validateTemplates = function (raw) {
    const items = Array.isArray(raw) ? raw : [raw];
    const accepted = [];
    let rejected = 0;
    let truncated = 0;

    for (const t of items) {
      if (!t || typeof t !== "object" || typeof t.body !== "string") { rejected++; continue; }
      const isHtml = t.format === "html";
      // Imported HTML is sanitized here — never trust an external file's markup.
      let body = isHtml ? TL.sanitizeHtml(t.body) : t.body;
      if (body.length > TL.LIMITS.MAX_BODY) { body = body.slice(0, TL.LIMITS.MAX_BODY); truncated++; }
      const tpl = {
        name: String(t.name ?? "Template").slice(0, TL.LIMITS.MAX_NAME),
        shortcut: TL.stripShortcut(t.shortcut ?? ""),
        body,
      };
      if (Array.isArray(t.tags)) tpl.tags = TL.normalizeTags(t.tags);
      if (Array.isArray(t.fields)) tpl.fields = TL.validateFields(t.fields);
      if (isHtml) tpl.format = "html";
      accepted.push(tpl);
      if (accepted.length >= TL.LIMITS.MAX_TEMPLATES) break;
    }
    return { accepted, rejected, truncated };
  };

  // ============================================================
  // Debounce
  // ============================================================
  TL.debounce = function (fn, delay = 300) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  };

  // ============================================================
  // Dynamic variables (plan step 10) — zero permissions, pure
  // {{date}} {{time}} {{datetime}} {{date+3d}} {{date-2w}} {{cursor}}
  // ============================================================
  TL.CURSOR_TOKEN = ""; // private-use sentinel; stripped after paste

  TL.pad2 = (n) => String(n).padStart(2, "0");
  TL.formatDate = (d) => `${d.getFullYear()}-${TL.pad2(d.getMonth() + 1)}-${TL.pad2(d.getDate())}`;
  TL.formatTime = (d) => `${TL.pad2(d.getHours())}:${TL.pad2(d.getMinutes())}`;

  /**
   * Resolve date/time/cursor variables. `now` injectable for deterministic tests.
   * @param {string} text
   * @param {Date} [now]
   * @returns {string}
   */
  TL.applyDynamicVars = function (text, now) {
    const base = now instanceof Date ? now : new Date();
    let out = String(text).replace(
      /\{\{\s*(date|time|datetime)(?:\s*([+-])\s*(\d+)\s*([dwmy]))?\s*\}\}/gi,
      (_m, kind, sign, num, unit) => {
        const d = new Date(base.getTime());
        if (sign && num && unit) {
          const n = parseInt(num, 10) * (sign === "-" ? -1 : 1);
          if (unit === "d") d.setDate(d.getDate() + n);
          else if (unit === "w") d.setDate(d.getDate() + n * 7);
          else if (unit === "m") d.setMonth(d.getMonth() + n);
          else if (unit === "y") d.setFullYear(d.getFullYear() + n);
        }
        const k = kind.toLowerCase();
        if (k === "time") return TL.formatTime(d);
        if (k === "datetime") return `${TL.formatDate(d)} ${TL.formatTime(d)}`;
        return TL.formatDate(d);
      }
    );
    out = out.replace(/\{\{\s*cursor\s*\}\}/gi, TL.CURSOR_TOKEN);
    return out;
  };

  // Names treated as dynamic — never prompted as form fields.
  const DYNAMIC_RE = /^(date|time|datetime|cursor)([+-]\d+[dwmy])?$/i;

  // ============================================================
  // Placeholder field parsing (plan step 11)
  // Pipe syntax: {{name|label|type|default|opt1,opt2,opt3}}
  // ============================================================
  /**
   * Parse form fields from a template body (after dynamic vars resolved).
   * @param {string} text
   * @returns {TLField[]}
   */
  TL.parseFields = function (text) {
    const re = /\{\{([^{}]+)\}\}/g;
    const seen = new Set();
    /** @type {TLField[]} */
    const out = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      const parts = m[1].split("|").map((s) => s.trim());
      const name = parts[0];
      if (!name || DYNAMIC_RE.test(name) || seen.has(name)) continue;
      seen.add(name);
      let type = (parts[2] || "text").toLowerCase();
      if (!FIELD_TYPES.includes(type)) type = "text";
      const options = (type === "dropdown" && parts[4])
        ? parts[4].split(",").map((s) => s.trim()).filter(Boolean).slice(0, TL.LIMITS.MAX_OPTIONS)
        : [];
      // 6th pipe token "remember" opts the field into last-value recall
      // (never for secret-looking field names).
      const remember = /^remember$/i.test(parts[5] || "") && !TL.isSecretName(name);
      out.push({
        name,
        label: parts[1] || name,
        type: /** @type {any} */ (type),
        def: parts[3] || "",
        options,
        remember,
      });
    }
    return out;
  };

  /** Legacy helper: just the field names. */
  TL.extractPlaceholders = (text) => TL.parseFields(text).map((f) => f.name);

  /**
   * Fill {{placeholders}} (supporting pipe syntax) with values.
   * For HTML templates pass {escape:true} so every user value is HTML-escaped
   * BEFORE substitution — this is what keeps a malicious value (e.g. an
   * `<img onerror>`) from injecting markup at the one HTML insertion sink.
   * @param {string} template
   * @param {Record<string,string>} values
   * @param {{escape?:boolean}} [opts]
   * @returns {string}
   */
  TL.fillTemplate = function (template, values, opts) {
    const escape = !!(opts && opts.escape);
    return String(template).replace(/\{\{([^{}]+?)\}\}/g, (full, inner) => {
      const name = inner.split("|")[0].trim();
      if (values && Object.prototype.hasOwnProperty.call(values, name)) {
        return escape ? TL.escapeHtml(values[name]) : values[name];
      }
      return full;
    });
  };

  /**
   * Serialize a field back to its minimal canonical pipe-token — the exact
   * inverse of parseFields. Strips pipe/brace/comma from label/default/options
   * (a stray pipe would shift the field's meaning). Used by the field-builder.
   * @param {TLField} field
   * @returns {string}
   */
  TL.buildFieldToken = function (field) {
    const f = /** @type {any} */ (field || {});
    const clean = (v) => String(v ?? "").replace(/[|{}]/g, "").trim();
    const cleanNoComma = (v) => clean(v).replace(/,/g, "");
    const name = cleanNoComma(f.name);
    const label = cleanNoComma(f.label) === name ? "" : cleanNoComma(f.label);
    const type = ["multiline", "dropdown", "date"].includes(f.type) ? f.type : "";
    const def = cleanNoComma(f.def);
    const options = (f.type === "dropdown" && Array.isArray(f.options))
      ? f.options.map(cleanNoComma).filter(Boolean).join(",") : "";
    const remember = (f.remember && !TL.isSecretName(name)) ? "remember" : "";
    const parts = [name, label, type, def, options, remember];
    while (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
    return "{{" + parts.join("|") + "}}";
  };

  // --- Secret field detection (remember-last opt-out) ---
  const SECRET_RE = /(pass|passwd|password|otp|cvv|secret|token|pin|api[_-]?key)/i;
  TL.isSecretName = (name) => SECRET_RE.test(String(name ?? ""));

  // ============================================================
  // Backups — ring buffer (plan step 14)
  // ============================================================
  /** Pure ring-push: newest first, capped. */
  TL.ringPush = (arr, item, max) => [item, ...(Array.isArray(arr) ? arr : [])].slice(0, max);

  TL.pushBackup = async function () {
    const { templates = [], backups = [] } = await chrome.storage.local.get(["templates", "backups"]);
    if (!Array.isArray(templates) || templates.length === 0) return;
    const snap = { ts: Date.now(), schemaVersion: TL.CURRENT_SCHEMA, count: templates.length, templates };
    const next = TL.ringPush(backups, snap, TL.LIMITS.MAX_BACKUPS);
    await chrome.storage.local.set({ backups: next });
  };

  TL.getBackups = async () => {
    const { backups = [] } = await chrome.storage.local.get("backups");
    return Array.isArray(backups) ? backups : [];
  };

  TL.restoreBackup = async function (ts) {
    const backups = await TL.getBackups();
    const b = backups.find((x) => x.ts === ts);
    if (!b) return false;
    const migrated = TL.migrate({ templates: b.templates });
    await TL.setTemplates(migrated.templates);
    return true;
  };

  // ============================================================
  // Competitor import adapters (plan step 16) — pure, fixture-tested.
  // Best-effort: convert vendor tokens to {{placeholders}}, else keep literal.
  // ============================================================

  /** Convert Text Blaze {formtext: name=foo} / {time}/{date} tokens → {{...}}. */
  TL.tbTokensToPlaceholders = function (text) {
    let s = String(text ?? "");
    s = s.replace(/\{form(?:text|paragraph|menu|date)\s*:\s*([^}]*)\}/gi, (_m, inner) => {
      const nameMatch = /name\s*=\s*([^;]+)/i.exec(inner);
      const nm = (nameMatch ? nameMatch[1] : "field").trim().replace(/[^\w\- ]+/g, "").trim() || "field";
      return `{{${nm}}}`;
    });
    s = s.replace(/\{time[^}]*\}/gi, "{{time}}").replace(/\{date[^}]*\}/gi, "{{date}}");
    return s;
  };

  /** @returns {Array<{name:string,shortcut:string,body:string}>|null} */
  TL.adaptTextBlaze = function (parsed) {
    const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.snippets) ? parsed.snippets : null);
    if (!list) return null;
    const out = [];
    for (const s of list) {
      if (!s || typeof s !== "object") continue;
      const body = s.snippet ?? s.text ?? s.content ?? s.body;
      if (typeof body !== "string") continue;
      out.push({
        name: String(s.name ?? s.label ?? s.shortcut ?? "Text Blaze").slice(0, TL.LIMITS.MAX_NAME),
        shortcut: TL.stripShortcut(String(s.shortcut ?? s.trigger ?? "").replace(/^\//, "")),
        body: TL.tbTokensToPlaceholders(body),
      });
    }
    return out.length ? out : null;
  };

  /** @returns {Array<{name:string,shortcut:string,body:string}>|null} */
  TL.adaptMagical = function (parsed) {
    const list = Array.isArray(parsed) ? parsed
      : (Array.isArray(parsed?.expansions) ? parsed.expansions
        : (Array.isArray(parsed?.shortcuts) ? parsed.shortcuts : null));
    if (!list) return null;
    const out = [];
    for (const s of list) {
      if (!s || typeof s !== "object") continue;
      const body = s.expansion ?? s.text ?? s.value ?? s.body;
      if (typeof body !== "string") continue;
      out.push({
        name: String(s.label ?? s.name ?? s.trigger ?? "Magical").slice(0, TL.LIMITS.MAX_NAME),
        shortcut: TL.stripShortcut(String(s.trigger ?? s.shortcut ?? "").replace(/^[/-]/, "")),
        body: String(body), // Magical uses {{label}} tokens already
      });
    }
    return out.length ? out : null;
  };

  /**
   * Detect a foreign export shape and adapt it; returns { source, items } or null
   * (null = treat as native TypeLess JSON).
   * @param {any} parsed
   * @returns {{source:string, items:Array}|null}
   */
  TL.detectAndAdapt = function (parsed) {
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    const looksNative = arr.some((x) => x && typeof x === "object" && typeof x.body === "string");
    if (looksNative) return null;

    const tb = TL.adaptTextBlaze(parsed);
    if (tb) return { source: "textblaze", items: tb };
    const mg = TL.adaptMagical(parsed);
    if (mg) return { source: "magical", items: mg };
    return null;
  };

  // ============================================================
  // Fuzzy scorer (plan step 17) — subsequence match with bonuses
  // ============================================================
  /** @returns {number} higher = better, -1 = no subsequence match */
  TL.fuzzyScore = function (query, target) {
    const q = String(query ?? "").toLowerCase();
    const t = String(target ?? "").toLowerCase();
    if (!q) return 0;
    let qi = 0, score = 0, prev = -2;
    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
      if (t[ti] === q[qi]) {
        score += ti === prev + 1 ? 3 : 1; // consecutive bonus
        if (ti === 0) score += 4;          // start-of-string bonus
        prev = ti;
        qi++;
      }
    }
    return qi === q.length ? score : -1;
  };

  /**
   * Rank templates by fuzzy match over shortcut (weighted) then name.
   * @param {string} query
   * @param {any[]} templates
   * @param {number} [limit]
   */
  TL.fuzzySearch = function (query, templates, limit = 8) {
    if (!query) return templates.slice(0, limit);
    const scored = [];
    for (const t of templates) {
      const sc = Math.max(TL.fuzzyScore(query, t.shortcut || "") + 2, TL.fuzzyScore(query, t.name || ""));
      if (sc >= 0) scored.push({ t, s: sc });
    }
    scored.sort((a, b) => b.s - a.s);
    return scored.slice(0, limit).map((x) => x.t);
  };

  /**
   * Full-text search over name/shortcut/body/tags (for options + popup).
   * @param {string} query
   * @param {any[]} templates
   */
  TL.searchTemplates = function (query, templates) {
    const q = String(query ?? "").trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((t) => {
      const hay = [t.name, t.shortcut, t.body, ...(t.tags || [])].join("\n").toLowerCase();
      return hay.includes(q);
    });
  };

  // Expose
  global.TL = TL;
  // Node (unit tests) — pure functions don't touch chrome.
  if (typeof module !== "undefined" && module.exports) module.exports = TL;
})(typeof self !== "undefined" ? self : (typeof globalThis !== "undefined" ? globalThis : this));
