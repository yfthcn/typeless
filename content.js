// @ts-check
// ==============================
// TypeLess — Content script
// ==============================
// Injected on all pages/frames. Tracks focused inputs, pastes templates
// (plain-text, framework-safe), resolves dynamic variables + placeholder
// forms, and powers slash-command expansion and the slash autocomplete.
// ==============================

(function () {
  "use strict";

  // Per-frame double-load guard. The executeScript fallback in
  // common.js#pasteToTab re-injects this file; without this guard the IIFE
  // would re-run and register a second keydown/onMessage listener, causing
  // double pastes. (Plan step 2)
  if (self.__TL_CONTENT_LOADED__) return;
  self.__TL_CONTENT_LOADED__ = true;

  // Inert in tiny/invisible subframes (ad/tracking iframes) to cut the
  // all_frames cost — they never hold a real editor. (Plan step 9)
  if (self !== self.top) {
    const w = self.innerWidth, h = self.innerHeight;
    if ((w > 0 && w < 60) || (h > 0 && h < 60)) return;
  }

  const t = (k, s) => (self.TL ? TL.t(k, s) : k);

  // --- State ---
  let lastFocusedElement = null;
  let templateCache = null; // null = not loaded yet (lazy)
  let cacheLoading = null;  // in-flight promise (coalesces concurrent loads)
  let onChangedBound = false;

  // --- Lazy template cache (plan steps 8/9) ---
  // No eager load. ensureCache() fires on first editable focus and before a
  // paste; the storage.onChanged listener is only wired once we've loaded.
  function ensureCache() {
    if (templateCache) return Promise.resolve(templateCache);
    if (cacheLoading) return cacheLoading;
    cacheLoading = TL.getTemplates()
      .then((list) => {
        templateCache = list || [];
        bindOnChanged();
        return templateCache;
      })
      .catch((err) => {
        console.error("[TypeLess] Cache load failed:", err);
        templateCache = [];
        return templateCache;
      })
      .finally(() => { cacheLoading = null; });
    return cacheLoading;
  }

  function bindOnChanged() {
    if (onChangedBound) return;
    onChangedBound = true;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.templates) {
        const next = /** @type {any[]} */ (changes.templates.newValue || []);
        templateCache = next.slice().sort((a, b) => a.order - b.order);
      }
    });
  }

  function getCachedTemplatesSync() {
    return templateCache || [];
  }

  // --- Track last focused editable element + warm the cache ---
  document.addEventListener(
    "focusin",
    (e) => {
      const el = e.target;
      if (el && isEditable(el)) {
        lastFocusedElement = el;
        ensureCache();
      }
    },
    true
  );

  function isEditable(el) {
    if (!el) return false;
    if (el.tagName === "TEXTAREA") return true;
    if (el.tagName === "INPUT") {
      const type = (el.type || "text").toLowerCase();
      // password intentionally excluded (privacy + AMO review principle).
      return ["text", "search", "email", "url", "tel", ""].includes(type);
    }
    return el.isContentEditable === true;
  }

  // Native setter so React/Vue/Angular detect the change.
  function setNativeValue(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
  }

  const CURSOR = TL.CURSOR_TOKEN;
  const stripCursor = (s) => s.split(CURSOR).join("");

  // ============================================================
  // Paste — plain-text, undo-preserving (plan step 3)
  // ============================================================
  function pasteIntoElement(el, text) {
    if (!el) return false;

    // 1. Plain textarea / input
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      const newValue = el.value.slice(0, start) + stripCursor(text) + el.value.slice(end);
      setNativeValue(el, newValue);
      placeCaretInInput(el, start, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    // 2. ContentEditable (TinyMCE, CKEditor, Quill, ProseMirror, Gmail…)
    if (el.isContentEditable) {
      el.focus();
      const markerIdx = text.indexOf(CURSOR);
      const plain = stripCursor(text);
      // execCommand("insertText") — plain text, preserves the editor's own
      // undo stack and model far better than insertHTML; no HTML injection.
      let ok = false;
      try { ok = document.execCommand("insertText", false, plain); } catch (_) {}
      if (!ok) {
        const sel = window.getSelection();
        if (sel?.rangeCount) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          range.insertNode(document.createTextNode(plain));
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        }
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (markerIdx >= 0) moveCaretBackEditable(plain.length - markerIdx);
      return true;
    }
    return false;
  }

  // After inserting into an input/textarea, honour a {{cursor}} marker;
  // otherwise place caret at end of inserted text.
  function placeCaretInInput(el, start, insertedWithMarker) {
    const markerIdx = insertedWithMarker.indexOf(CURSOR);
    const pos = markerIdx >= 0 ? start + markerIdx : start + stripCursor(insertedWithMarker).length;
    el.setSelectionRange?.(pos, pos);
  }

  function moveCaretBackEditable(steps) {
    const sel = window.getSelection();
    if (!sel || steps <= 0) return;
    for (let i = 0; i < steps; i++) sel.modify?.("move", "backward", "character");
  }

  // ============================================================
  // Shared in-page theme (modal, toast, autocomplete, form) — dark aware
  // (plan steps 10/13). One CSS string, prefers-color-scheme.
  // ============================================================
  const THEME_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .tl-backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,0.55);
      display: flex; align-items: center; justify-content: center;
      font-family: system-ui, -apple-system, sans-serif;
    }
    .tl-modal {
      background: #ffffff; color: #111827;
      padding: 24px; border-radius: 10px;
      min-width: 380px; max-width: 520px; width: 92%;
      box-shadow: 0 20px 50px rgba(0,0,0,0.3);
      max-height: 85vh; overflow-y: auto;
    }
    .tl-modal h3 { margin: 0 0 6px; font-size: 16px; font-weight: 600; }
    .tl-tname { margin: 0 0 16px; font-size: 13px; color: #6b7280; font-weight: 500; }
    label { display: block; margin-bottom: 12px; font-size: 13px; color: #374151; }
    label span.lbl { display: block; margin-bottom: 5px; font-weight: 600; }
    input, select, textarea {
      width: 100%; padding: 9px 11px;
      border: 1px solid #d1d5db; border-radius: 6px;
      font-size: 14px; font-family: inherit;
      background: #ffffff; color: #111827;
    }
    textarea { min-height: 70px; resize: vertical; }
    input:focus, select:focus, textarea:focus {
      outline: none; border-color: #4f46e5;
      box-shadow: 0 0 0 3px rgba(79,70,229,0.15);
    }
    .tl-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 18px; }
    button {
      padding: 9px 18px; border-radius: 6px; cursor: pointer;
      font-size: 14px; font-family: inherit; font-weight: 500;
    }
    .tl-cancel { border: 1px solid #d1d5db; background: #ffffff; color: #374151; }
    .tl-submit { border: none; background: #4f46e5; color: #ffffff; }
    .tl-submit:hover { background: #4338ca; }
    .tl-submit:focus-visible, .tl-cancel:focus-visible { outline: 2px solid #4f46e5; outline-offset: 2px; }
    .tl-toast {
      font-family: system-ui, -apple-system, sans-serif;
      background: #1f2937; color: #fff; padding: 12px 18px;
      border-radius: 8px; font-size: 14px; max-width: 340px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.25); border-left: 3px solid #4f46e5;
      animation: tlIn .2s ease-out, tlOut .3s ease-in 3s forwards;
    }
    @keyframes tlIn { from { transform: translateX(20px); opacity: 0; } to { transform: none; opacity: 1; } }
    @keyframes tlOut { to { opacity: 0; transform: translateX(20px); } }
    .tl-ac {
      position: fixed; z-index: 2147483647; min-width: 220px; max-width: 360px;
      background: #fff; color: #111827; border: 1px solid #e5e7eb; border-radius: 8px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.18); overflow: hidden;
      font-family: system-ui, -apple-system, sans-serif; font-size: 13px;
    }
    .tl-ac-item { display: flex; justify-content: space-between; gap: 12px; padding: 8px 12px; cursor: pointer; }
    .tl-ac-item .nm { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tl-ac-item .sc { color: #6b7280; font-family: ui-monospace, monospace; }
    .tl-ac-item.active { background: #eef2ff; }
    @media (prefers-color-scheme: dark) {
      .tl-modal { background: #1f2937; color: #f3f4f6; box-shadow: 0 20px 50px rgba(0,0,0,0.6); }
      .tl-modal h3 { color: #f9fafb; }
      .tl-tname { color: #9ca3af; }
      label { color: #d1d5db; }
      input, select, textarea { background: #111827; color: #f3f4f6; border-color: #374151; }
      .tl-cancel { background: #374151; color: #e5e7eb; border-color: #4b5563; }
      .tl-ac { background: #1f2937; color: #f3f4f6; border-color: #374151; }
      .tl-ac-item .sc { color: #9ca3af; }
      .tl-ac-item.active { background: #312e81; }
    }
  `;

  function makeShadowHost(positionCss) {
    const host = document.createElement("div");
    host.style.cssText = positionCss;
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = THEME_CSS;
    shadow.appendChild(style);
    return { host, shadow };
  }

  // ============================================================
  // Placeholder form (Shadow DOM, dark-aware) — smart fields (plan step 11)
  // ============================================================
  function showPlaceholderForm(fields, templateName, lastValues) {
    return new Promise((resolve) => {
      const { host, shadow } = makeShadowHost("position:fixed;inset:0;z-index:2147483647;");
      const backdrop = document.createElement("div");
      backdrop.className = "tl-backdrop";

      const modal = document.createElement("div");
      modal.className = "tl-modal";
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-labelledby", "tl-h");

      const heading = document.createElement("h3");
      heading.id = "tl-h";
      heading.textContent = t("formHeading");
      modal.appendChild(heading);

      if (templateName) {
        const nameEl = document.createElement("div");
        nameEl.className = "tl-tname";
        nameEl.textContent = templateName;
        modal.appendChild(nameEl);
      }

      const form = document.createElement("form");
      const controls = [];

      for (const f of fields) {
        const labelEl = document.createElement("label");
        const spanEl = document.createElement("span");
        spanEl.className = "lbl";
        spanEl.textContent = f.label || f.name;
        labelEl.appendChild(spanEl);

        const remembered = (f.remember && lastValues && lastValues[f.name]) || "";
        let control;
        if (f.type === "dropdown" && f.options.length) {
          control = document.createElement("select");
          for (const opt of f.options) {
            const o = document.createElement("option");
            o.value = opt; o.textContent = opt;
            control.appendChild(o);
          }
          control.value = remembered || f.def || f.options[0];
        } else if (f.type === "multiline") {
          control = document.createElement("textarea");
          control.value = remembered || f.def || "";
        } else {
          control = document.createElement("input");
          control.type = f.type === "date" ? "date" : "text";
          control.value = remembered || f.def || "";
        }
        control.dataset.ph = f.name;
        control.dataset.remember = f.remember ? "1" : "";
        labelEl.appendChild(control);
        form.appendChild(labelEl);
        controls.push(control);
      }

      const actions = document.createElement("div");
      actions.className = "tl-actions";
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button"; cancelBtn.className = "tl-cancel";
      cancelBtn.textContent = t("formCancel");
      const submitBtn = document.createElement("button");
      submitBtn.type = "submit"; submitBtn.className = "tl-submit";
      submitBtn.textContent = t("formPaste");
      actions.appendChild(cancelBtn);
      actions.appendChild(submitBtn);
      form.appendChild(actions);

      modal.appendChild(form);
      backdrop.appendChild(modal);
      shadow.appendChild(backdrop);
      document.body.appendChild(host);
      controls[0]?.focus();

      const cleanup = () => host.remove();
      cancelBtn.addEventListener("click", () => { cleanup(); resolve(null); });
      shadow.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { cleanup(); resolve(null); }
      });
      backdrop.addEventListener("mousedown", (e) => {
        if (e.target === backdrop) { cleanup(); resolve(null); }
      });
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const values = {};
        const remember = {};
        controls.forEach((c) => {
          values[c.dataset.ph] = c.value;
          if (c.dataset.remember) remember[c.dataset.ph] = c.value;
        });
        cleanup();
        resolve({ values, remember });
      });
    });
  }

  // --- Toast ---
  function showToast(message) {
    const { host, shadow } = makeShadowHost("position:fixed;top:20px;right:20px;z-index:2147483647;");
    const toast = document.createElement("div");
    toast.className = "tl-toast";
    toast.textContent = message;
    shadow.appendChild(toast);
    document.body.appendChild(host);
    setTimeout(() => host.remove(), 3500);
  }

  // ============================================================
  // Main paste flow — dynamic vars → fields → fill → insert → caret
  // ============================================================
  async function handlePaste(template) {
    const target =
      (document.activeElement && isEditable(document.activeElement))
        ? document.activeElement
        : lastFocusedElement;

    if (!target) { showToast(t("needFocus")); return; }

    const isHtml = template.format === "html";
    const withVars = TL.applyDynamicVars(template.body);
    const fields = TL.parseFields(withVars);

    let filled = withVars;
    let formShown = false;
    if (fields.length > 0) {
      const lastValues = await getLastValues(template.id);
      const result = await showPlaceholderForm(fields, template.name, lastValues);
      if (!result) return;
      // For HTML, every user-supplied value is HTML-escaped BEFORE substitution.
      filled = TL.fillTemplate(withVars, result.values, { escape: isHtml });
      if (Object.keys(result.remember).length) saveLastValues(template.id, result.remember);
      formShown = true;
    }

    const doPaste = isHtml
      ? () => pasteHtmlIntoElement(target, TL.sanitizeHtml(filled)) // sanitize is ALWAYS the last pass
      : () => pasteIntoElement(target, filled);

    target.focus();
    if (formShown) setTimeout(doPaste, 30); // let focus settle after the modal closes
    else doPaste();
  }

  // --- Rich (HTML) paste: contentEditable gets sanitized HTML; input/textarea degrade ---
  function pasteHtmlIntoElement(el, safeHtml) {
    if (!el) return false;
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      return pasteIntoElement(el, TL.htmlToPlainText(safeHtml));
    }
    if (el.isContentEditable) {
      el.focus();
      const hasCursor = safeHtml.indexOf(CURSOR) >= 0;
      let ok = false;
      try { ok = document.execCommand("insertHTML", false, safeHtml); } catch (_) {}
      if (!ok) {
        const sel = window.getSelection();
        if (sel?.rangeCount) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          const frag = range.createContextualFragment(safeHtml); // already sanitized
          range.insertNode(frag);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
      if (hasCursor) placeCaretAtSentinel(el);
      return true;
    }
    return false;
  }

  // Locate the {{cursor}} sentinel that we inserted as a text char, place the
  // caret there and remove it. Falls back silently to end-of-insertion.
  function placeCaretAtSentinel(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      const idx = node.nodeValue.indexOf(CURSOR);
      if (idx < 0) continue;
      node.nodeValue = node.nodeValue.slice(0, idx) + node.nodeValue.slice(idx + CURSOR.length);
      const sel = window.getSelection();
      const range = document.createRange();
      range.setStart(node, idx);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
  }

  // --- Remember-last value storage (non-secret fields only) ---
  async function getLastValues(templateId) {
    if (!templateId) return {};
    try {
      const { lastValues = {} } = await chrome.storage.local.get("lastValues");
      return lastValues[templateId] || {};
    } catch (_) { return {}; }
  }
  async function saveLastValues(templateId, values) {
    if (!templateId) return;
    try {
      const { lastValues = {} } = await chrome.storage.local.get("lastValues");
      lastValues[templateId] = { ...(lastValues[templateId] || {}), ...values };
      await chrome.storage.local.set({ lastValues });
    } catch (_) {}
  }

  // --- Message listener (from popup / background) ---
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "PASTE_TEMPLATE" && msg.template) {
      ensureCache().finally(() => handlePaste(msg.template));
      sendResponse({ ok: true });
    }
    return true;
  });

  // ============================================================
  // Slash command expansion (exact match on space/enter/tab) — step 1/3
  // ============================================================
  function getSlashContext(el) {
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const pos = el.selectionStart ?? 0;
      const before = el.value.slice(0, pos);
      const m = TL.slashRegex().exec(before);
      if (!m) return null;
      return { type: "input", start: pos - m[0].length, end: pos, shortcut: m[1] };
    }
    if (el.isContentEditable) {
      const sel = window.getSelection();
      if (!sel?.rangeCount) return null;
      const range = sel.getRangeAt(0);
      if (range.startContainer.nodeType !== Node.TEXT_NODE) return null;
      const before = range.startContainer.textContent.slice(0, range.startOffset);
      const m = TL.slashRegex().exec(before);
      if (!m) return null;
      return {
        type: "editable", container: range.startContainer,
        start: range.startOffset - m[0].length, end: range.startOffset, shortcut: m[1],
      };
    }
    return null;
  }

  function deleteSlashToken(el, info) {
    if (info.type === "input") {
      const before = el.value.slice(0, info.start);
      const after = el.value.slice(info.end);
      setNativeValue(el, before + after);
      el.setSelectionRange?.(info.start, info.start);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      // Range-based delete keeps the rich editor's DOM consistent. (Plan step 3)
      const range = document.createRange();
      range.setStart(info.container, info.start);
      range.setEnd(info.container, info.end);
      range.deleteContents();
      const sel = window.getSelection();
      const collapsed = document.createRange();
      collapsed.setStart(info.container, info.start);
      collapsed.collapse(true);
      sel.removeAllRanges();
      sel.addRange(collapsed);
    }
  }

  async function handleSlashCommand(el, triggerEvent) {
    if (!el || !isEditable(el)) return false;
    const info = getSlashContext(el);
    if (!info) return false;

    const templates = getCachedTemplatesSync();
    const template = templates.find(
      (tpl) => tpl.shortcut && tpl.shortcut.toLowerCase() === info.shortcut.toLowerCase()
    );
    if (!template) return false;

    triggerEvent.preventDefault();
    triggerEvent.stopPropagation();
    deleteSlashToken(el, info);
    closeAutocomplete();
    handlePaste(template);
    return true;
  }

  let slashBusy = false;
  const slashHandler = async (e) => {
    if (e.isComposing) return;

    // Autocomplete keyboard control takes priority when open.
    if (acOpen && acHandleKey(e)) return;

    if (e.key !== " " && e.key !== "Enter" && e.key !== "Tab") return;
    if (slashBusy) return;
    if (!isEditable(e.target)) return;

    slashBusy = true;
    try {
      await ensureCache();
      await handleSlashCommand(e.target, e);
    } catch (err) {
      console.error("[TypeLess] Slash handler error:", err);
    } finally {
      slashBusy = false;
    }
  };
  document.addEventListener("keydown", slashHandler, { capture: true, passive: false });

  // ============================================================
  // Slash autocomplete dropdown (plan step 17) — caret-anchored, fuzzy
  // ============================================================
  let acHost = null, acShadow = null, acList = null;
  let acItems = [], acIndex = 0, acOpen = false, acTarget = null, acInfo = null;
  let acRaf = 0;

  function closeAutocomplete() {
    if (acHost) { acHost.remove(); acHost = null; acShadow = null; acList = null; }
    acOpen = false; acItems = []; acIndex = 0; acTarget = null; acInfo = null;
  }

  function caretRect(el) {
    try {
      if (el.isContentEditable) {
        const sel = window.getSelection();
        if (sel?.rangeCount) {
          const r = sel.getRangeAt(0).getClientRects()[0];
          if (r) return { left: r.left, bottom: r.bottom };
        }
      }
    } catch (_) {}
    const r = el.getBoundingClientRect();
    return { left: r.left + 6, bottom: r.top + Math.min(r.height, 28) };
  }

  function renderAutocomplete(matches, el, info) {
    if (!acHost) {
      const h = makeShadowHost("position:fixed;top:0;left:0;z-index:2147483647;");
      acHost = h.host; acShadow = h.shadow;
      acList = document.createElement("div");
      acList.className = "tl-ac";
      acShadow.appendChild(acList);
      document.body.appendChild(acHost);
    }
    acList.replaceChildren();
    acItems = matches;
    acIndex = 0;
    matches.forEach((tpl, i) => {
      const item = document.createElement("div");
      item.className = "tl-ac-item" + (i === 0 ? " active" : "");
      const nm = document.createElement("span");
      nm.className = "nm"; nm.textContent = tpl.name || tpl.shortcut || "";
      const sc = document.createElement("span");
      sc.className = "sc"; sc.textContent = tpl.shortcut ? "/" + tpl.shortcut : "";
      item.append(nm, sc);
      item.addEventListener("mousedown", (e) => { e.preventDefault(); acAccept(i); });
      acList.appendChild(item);
    });
    const rect = caretRect(el);
    acList.style.left = Math.round(rect.left) + "px";
    acList.style.top = Math.round(rect.bottom + 4) + "px";
    acOpen = true; acTarget = el; acInfo = info;
  }

  function acHighlight() {
    const nodes = acList?.querySelectorAll(".tl-ac-item") || [];
    nodes.forEach((n, i) => n.classList.toggle("active", i === acIndex));
  }

  function acHandleKey(e) {
    if (!acItems.length) return false;
    if (e.key === "ArrowDown") { acIndex = (acIndex + 1) % acItems.length; acHighlight(); e.preventDefault(); return true; }
    if (e.key === "ArrowUp") { acIndex = (acIndex - 1 + acItems.length) % acItems.length; acHighlight(); e.preventDefault(); return true; }
    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); e.stopPropagation(); acAccept(acIndex); return true; }
    if (e.key === "Escape") { closeAutocomplete(); e.preventDefault(); return true; }
    return false; // space/other keys fall through to slash expansion
  }

  function acAccept(i) {
    const tpl = acItems[i];
    const el = acTarget, info = acInfo;
    closeAutocomplete();
    if (!tpl || !el || !info) return;
    deleteSlashToken(el, getSlashContext(el) || info);
    handlePaste(tpl);
  }

  // input event drives the live dropdown (rAF-debounced).
  document.addEventListener("input", (e) => {
    const el = e.target;
    if (!isEditable(el)) { closeAutocomplete(); return; }
    if (acRaf) cancelAnimationFrame(acRaf);
    acRaf = requestAnimationFrame(() => {
      const info = getSlashContext(el);
      if (!info || info.shortcut.length < 1) { closeAutocomplete(); return; }
      ensureCache().then((templates) => {
        const matches = TL.fuzzySearch(info.shortcut, templates, 8);
        if (!matches.length) { closeAutocomplete(); return; }
        renderAutocomplete(matches, el, info);
      });
    });
  }, true);

  document.addEventListener("focusout", () => closeAutocomplete(), true);
  document.addEventListener("mousedown", (e) => {
    if (acHost && e.target !== acHost) closeAutocomplete();
  }, true);

  // Debug helper (isolated world; pages cannot reach it).
  self.TLDebug = async () => {
    const templates = await TL.getTemplates();
    console.log("[TypeLess] Templates:", templates, "Cache:", templateCache);
    return { templates, cache: templateCache, lastFocused: lastFocusedElement };
  };
})();
