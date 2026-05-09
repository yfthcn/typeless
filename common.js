// ==============================
// TypeLess — Common utilities
// ==============================
// i18n, escaping, validation and storage helpers shared by
// popup.js, options.js and content.js (via injected loader).
// Designed to work in both service worker and page contexts.
// ==============================

(function (global) {
  "use strict";

  // --- Browser polyfill ---
  // Chrome/Edge use `chrome.*`, Firefox uses `browser.*`. Alias both ways.
  if (typeof global.browser === "undefined" && typeof global.chrome !== "undefined") {
    global.browser = global.chrome;
  } else if (typeof global.chrome === "undefined" && typeof global.browser !== "undefined") {
    global.chrome = global.browser;
  }

  const TL = {};

  // --- i18n ---
  let uiStrings = {};
  let activeLang = "en";

  /**
   * Load localized strings. Falls back to chrome.i18n if custom locale fails.
   * @param {string} langPref - "auto" | "en" | "tr"
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
      for (const [k, v] of Object.entries(data)) {
        uiStrings[k] = v.message;
      }
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

  // --- Escaping ---
  const HTML_ESC_MAP = {
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  };
  TL.escapeHtml = (str) => String(str ?? "").replace(/[&<>"']/g, (c) => HTML_ESC_MAP[c]);

  TL.sanitizeFilename = (name) => {
    const cleaned = String(name ?? "")
      .replace(/[^\p{L}\p{N}_\- ]+/gu, "_")
      .replace(/\s+/g, "_")
      .slice(0, 50);
    return cleaned || "template";
  };

  // --- Storage wrappers ---
  TL.getTemplates = async function () {
    const { templates = [] } = await chrome.storage.local.get("templates");
    return Array.isArray(templates) ? templates : [];
  };

  TL.setTemplates = (templates) => chrome.storage.local.set({ templates });

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
        files: ["common.js", "content.js"]
      });
      await new Promise(r => setTimeout(r, injectDelayMs));
      await chrome.tabs.sendMessage(tabId, msg);
    }
  };

  // --- Validation ---
  /**
   * Validate and normalize an array of imported templates.
   * Rejects items missing a `body` field.
   * @param {unknown} raw
   * @returns {Array<{name:string, shortcut:string, body:string}>}
   */
  TL.validateTemplates = function (raw) {
    const items = Array.isArray(raw) ? raw : [raw];
    return items
      .filter((t) => t && typeof t === "object" && typeof t.body === "string")
      .map((t) => ({
        name: String(t.name ?? "Template").slice(0, 200),
        shortcut: String(t.shortcut ?? "").slice(0, 50).replace(/[^\w-]/g, ""),
        body: String(t.body)
      }));
  };

  // --- Debounce ---
  TL.debounce = function (fn, delay = 300) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  };

  // --- Placeholder extraction ---
  TL.extractPlaceholders = function (text) {
    const set = new Set();
    const re = /\{\{([^}]+)\}\}/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      set.add(m[1].trim());
    }
    return [...set];
  };

  /**
   * Fill {{placeholders}} with values from an object.
   * @param {string} template
   * @param {Record<string,string>} values
   * @returns {string}
   */
  TL.fillTemplate = function (template, values) {
    return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, key) => {
      return values[key.trim()] ?? `{{${key.trim()}}}`;
    });
  };

  // Expose
  global.TL = TL;
})(typeof self !== "undefined" ? self : this);
