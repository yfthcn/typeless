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
        const body = String(t.body ?? "").slice(0, TL.LIMITS.MAX_BODY);
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
   * @returns {{accepted:Array<{name:string,shortcut:string,body:string,tags?:string[],fields?:TLField[]}>, rejected:number, truncated:number}}
   */
  TL.validateTemplates = function (raw) {
    const items = Array.isArray(raw) ? raw : [raw];
    const accepted = [];
    let rejected = 0;
    let truncated = 0;

    for (const t of items) {
      if (!t || typeof t !== "object" || typeof t.body !== "string") { rejected++; continue; }
      let body = t.body;
      if (body.length > TL.LIMITS.MAX_BODY) { body = body.slice(0, TL.LIMITS.MAX_BODY); truncated++; }
      const tpl = {
        name: String(t.name ?? "Template").slice(0, TL.LIMITS.MAX_NAME),
        shortcut: TL.stripShortcut(t.shortcut ?? ""),
        body,
      };
      if (Array.isArray(t.tags)) tpl.tags = TL.normalizeTags(t.tags);
      if (Array.isArray(t.fields)) tpl.fields = TL.validateFields(t.fields);
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
   * @param {string} template
   * @param {Record<string,string>} values
   * @returns {string}
   */
  TL.fillTemplate = function (template, values) {
    return String(template).replace(/\{\{([^{}]+?)\}\}/g, (full, inner) => {
      const name = inner.split("|")[0].trim();
      if (values && Object.prototype.hasOwnProperty.call(values, name)) return values[name];
      return full;
    });
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
