// ==============================
// TypeLess — Content script
// ==============================
// Injected on all pages. Tracks focused inputs, pastes templates,
// and listens for slash-command expansion (e.g. /pass + space).
// ==============================

(function () {
  "use strict";

  // TL comes from common.js (loaded before this script)
  const t = (k, s) => (self.TL ? TL.t(k, s) : k);

  // --- State ---
  let lastFocusedElement = null;
  let templateCache = null;
  let cacheReady = false;

  // --- Load templates into cache (for slash commands) ---
  // Initial load — slash command handler sync olarak okuyabilsin diye
  // Promise chain ile background'da; cacheReady guard cache hazır olmadan
  // gelen ilk slash command'leri sessizce skip eder.
  TL.getTemplates().then((t) => {
    templateCache = t || [];
    cacheReady = true;
  }).catch((err) => {
    console.error("[TypeLess] Initial cache load failed:", err);
    templateCache = [];
    cacheReady = true;
  });

  // Storage değişikliği → cache'i tazele
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.templates) {
      templateCache = changes.templates.newValue || [];
    }
  });

  // Sync getter — slash handler'ın await'siz template lookup yapabilmesi için
  function getCachedTemplatesSync() {
    return cacheReady ? templateCache : [];
  }

  // --- Track last focused editable element ---
  document.addEventListener(
    "focusin",
    (e) => {
      const el = e.target;
      if (el && isEditable(el)) {
        lastFocusedElement = el;
      }
    },
    true
  );

  function isEditable(el) {
    if (!el) return false;
    if (el.tagName === "TEXTAREA") return true;
    if (el.tagName === "INPUT") {
      const type = (el.type || "text").toLowerCase();
      // password tipini bilinçli olarak hariç tutuyoruz:
      // - Gizlilik: kullanıcı login formunda kazara /shortcut yazarsa
      //   şablon password input'una expand olmamalı
      // - AMO inceleme prensibi: extension password input'una müdahale etmemeli
      return ["text", "search", "email", "url", "tel", ""].includes(type);
    }
    return el.isContentEditable === true;
  }

  // Use native setter so React/Vue/Angular frameworks detect the change
  function setNativeValue(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
  }

  // --- Paste strategies ---
  function pasteIntoElement(el, text) {
    if (!el) return false;

    // 1. Plain textarea / input
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      const newValue = el.value.slice(0, start) + text + el.value.slice(end);

      setNativeValue(el, newValue);

      const newPos = start + text.length;
      el.setSelectionRange?.(newPos, newPos);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    // 2. ContentEditable (TinyMCE, CKEditor, Quill, etc.)
    if (el.isContentEditable) {
      el.focus();
      const htmlText = TL.escapeHtml(text).replace(/\n/g, "<br>");
      try {
        // execCommand is deprecated but still the most compatible for rich editors
        const ok = document.execCommand("insertHTML", false, htmlText);
        if (ok) {
          el.dispatchEvent(new Event("input", { bubbles: true }));
          return true;
        }
      } catch (_) {}
      // Fallback: manipulate Selection API
      const sel = window.getSelection();
      if (sel?.rangeCount) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(text));
        range.collapse(false);
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }

    return false;
  }

  // --- Placeholder form (rendered in Shadow DOM for isolation) ---
  function showPlaceholderForm(placeholders, templateName) {
    return new Promise((resolve) => {
      const host = document.createElement("div");
      host.style.cssText = "position:fixed;inset:0;z-index:2147483647;";
      const shadow = host.attachShadow({ mode: "closed" });

      // Styles (text-only, no HTML injection)
      const style = document.createElement("style");
      style.textContent = `
        :host {
          all: initial;
          color-scheme: light;
        }
        * { box-sizing: border-box; }
        .backdrop {
          position:fixed;inset:0;background:rgba(0,0,0,0.55);
          display:flex;align-items:center;justify-content:center;
          font-family:system-ui,-apple-system,sans-serif;
          color-scheme: light;
        }
        .modal {
          background:#ffffff;color:#111827;
          padding:24px;border-radius:10px;
          min-width:380px;max-width:500px;
          box-shadow:0 20px 50px rgba(0,0,0,0.3);
        }
        h3 { margin:0 0 18px;font-size:16px;color:#111827;font-weight:600; }
        .template-name { margin:-12px 0 16px;font-size:13px;color:#6b7280;font-weight:500; }
        label { display:block;margin-bottom:12px;font-size:13px;color:#374151; }
        label span { display:block;margin-bottom:5px;font-weight:600;color:#374151; }
        input {
          width:100%;padding:9px 11px;
          border:1px solid #d1d5db;border-radius:6px;
          font-size:14px;font-family:inherit;
          background:#ffffff;color:#111827;
          transition: border-color .15s, box-shadow .15s;
        }
        input:focus {
          outline:none;
          border-color:#4f46e5;
          box-shadow:0 0 0 3px rgba(79,70,229,0.15);
        }
        .actions { display:flex;gap:8px;justify-content:flex-end;margin-top:18px; }
        button {
          padding:9px 18px;border-radius:6px;cursor:pointer;
          font-size:14px;font-family:inherit;font-weight:500;
          transition: all .15s;
        }
        .cancel {
          border:1px solid #d1d5db;
          background:#ffffff;color:#374151;
        }
        .cancel:hover { background:#f9fafb;border-color:#9ca3af; }
        .submit {
          border:none;
          background:#4f46e5;color:#ffffff;
        }
        .submit:hover { background:#4338ca; }
        .submit:focus-visible, .cancel:focus-visible {
          outline:2px solid #4f46e5;outline-offset:2px;
        }
      `;
      shadow.appendChild(style);

      const backdrop = document.createElement("div");
      backdrop.className = "backdrop";

      const modal = document.createElement("div");
      modal.className = "modal";
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-labelledby", "h");

      const heading = document.createElement("h3");
      heading.id = "h";
      heading.textContent = t("formHeading");
      modal.appendChild(heading);

      if (templateName) {
        const nameEl = document.createElement("div");
        nameEl.className = "template-name";
        nameEl.textContent = templateName;
        modal.appendChild(nameEl);
      }

      const form = document.createElement("form");

      const inputs = [];
      for (const p of placeholders) {
        const labelEl = document.createElement("label");
        const spanEl = document.createElement("span");
        spanEl.textContent = p;
        const inputEl = document.createElement("input");
        inputEl.dataset.ph = p;
        labelEl.appendChild(spanEl);
        labelEl.appendChild(inputEl);
        form.appendChild(labelEl);
        inputs.push(inputEl);
      }

      const actions = document.createElement("div");
      actions.className = "actions";
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "cancel";
      cancelBtn.textContent = t("formCancel");
      const submitBtn = document.createElement("button");
      submitBtn.type = "submit";
      submitBtn.className = "submit";
      submitBtn.textContent = t("formPaste");
      actions.appendChild(cancelBtn);
      actions.appendChild(submitBtn);
      form.appendChild(actions);

      modal.appendChild(form);
      backdrop.appendChild(modal);
      shadow.appendChild(backdrop);

      document.body.appendChild(host);

      inputs[0]?.focus();

      const cleanup = () => host.remove();

      cancelBtn.addEventListener("click", () => {
        cleanup();
        resolve(null);
      });

      shadow.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          cleanup();
          resolve(null);
        }
      });

      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const values = {};
        inputs.forEach((inp) => {
          values[inp.dataset.ph] = inp.value;
        });
        cleanup();
        resolve(values);
      });
    });
  }

  // --- Main paste flow ---
  async function handlePaste(template) {
    const target =
      (document.activeElement && isEditable(document.activeElement))
        ? document.activeElement
        : lastFocusedElement;

    if (!target) {
      showToast(t("needFocus"));
      return;
    }

    const placeholders = TL.extractPlaceholders(template.body);

    if (placeholders.length === 0) {
      pasteIntoElement(target, template.body);
      return;
    }

    const values = await showPlaceholderForm(placeholders, template.name);
    if (!values) return;
    const filled = TL.fillTemplate(template.body, values);
    target.focus();
    // Small delay for focus event to settle
    setTimeout(() => pasteIntoElement(target, filled), 30);
  }

  // --- Custom toast notification (replaces alert) ---
  function showToast(message) {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;top:20px;right:20px;z-index:2147483647;";
    const shadow = host.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      .toast {
        font-family: system-ui, -apple-system, sans-serif;
        background: #1f2937;
        color: white;
        padding: 12px 18px;
        border-radius: 8px;
        font-size: 14px;
        box-shadow: 0 10px 25px rgba(0,0,0,0.25);
        max-width: 340px;
        animation: slideIn .2s ease-out, fadeOut .3s ease-in 3s forwards;
        border-left: 3px solid #4f46e5;
      }
      @keyframes slideIn {
        from { transform: translateX(20px); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      @keyframes fadeOut {
        to { opacity: 0; transform: translateX(20px); }
      }
    `;
    shadow.appendChild(style);

    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    shadow.appendChild(toast);

    document.body.appendChild(host);
    setTimeout(() => host.remove(), 3500);
  }

  // --- Message listener (from popup / background) ---
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "PASTE_TEMPLATE" && msg.template) {
      handlePaste(msg.template);
      sendResponse({ ok: true });
    }
    return true;
  });

  // --- Slash command expansion ---
  // Stratejij: keydown'da trigger tuşlarını (space/enter/tab) yakala.
  // keydown'da e.target.value cursor'dan öncesini dogru yansitmiyor bazi durumlarda,
  // o yuzden input'un guncel icerigini alirken selectionStart'i da dikkate aliyoruz.
  async function handleSlashCommand(el, triggerEvent) {
    if (!el || !isEditable(el)) return false;

    let textBeforeCursor = "";
    let replaceInfo = null;

    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const pos = el.selectionStart ?? 0;
      textBeforeCursor = el.value.slice(0, pos);
      const m = /\/([\w]+)$/.exec(textBeforeCursor);
      if (!m) return false;
      replaceInfo = { type: "input", start: pos - m[0].length, end: pos, shortcut: m[1] };
    } else if (el.isContentEditable) {
      const sel = window.getSelection();
      if (!sel?.rangeCount) return false;
      const range = sel.getRangeAt(0);
      if (range.startContainer.nodeType !== Node.TEXT_NODE) return false;
      textBeforeCursor = range.startContainer.textContent.slice(0, range.startOffset);
      const m = /\/([\w]+)$/.exec(textBeforeCursor);
      if (!m) return false;
      replaceInfo = {
        type: "editable",
        container: range.startContainer,
        start: range.startOffset - m[0].length,
        end: range.startOffset,
        shortcut: m[1]
      };
    } else {
      return false;
    }

    // SYNC template lookup — preventDefault'un await'ten önce çağrılması için kritik.
    // Async getTemplates() çağırırsak browser default action (space karakteri yazma)
    // await resolve olana kadar gerçekleşir → flicker. Cache her zaman son state'i tutar.
    const templates = getCachedTemplatesSync();
    const template = templates.find(
      (tpl) => tpl.shortcut && tpl.shortcut.toLowerCase() === replaceInfo.shortcut.toLowerCase()
    );
    if (!template) return false;

    // preventDefault HEMEN — await'ten önce
    triggerEvent.preventDefault();
    triggerEvent.stopPropagation();

    // /kisayol'u sil
    if (replaceInfo.type === "input") {
      const before = el.value.slice(0, replaceInfo.start);
      const after = el.value.slice(replaceInfo.end);
      setNativeValue(el, before + after);
      el.setSelectionRange?.(replaceInfo.start, replaceInfo.start);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      const c = replaceInfo.container;
      c.textContent = c.textContent.slice(0, replaceInfo.start) + c.textContent.slice(replaceInfo.end);
      const sel = window.getSelection();
      const range = document.createRange();
      range.setStart(c, replaceInfo.start);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }

    handlePaste(template);
    return true;
  }

  // Tek listener — capture phase her event'i en üstte yakalar.
  // Eskiden document + window'da iki ayrı capture-phase listener kayıtlıydı;
  // async handler içinde stopPropagation gecikiyordu ve aynı event iki kez
  // işlenebiliyordu. slashBusy guard reentrancy'i de engelliyor.
  let slashBusy = false;
  const slashHandler = async (e) => {
    if (e.isComposing) return;
    if (e.key !== " " && e.key !== "Enter" && e.key !== "Tab") return;
    if (slashBusy) return;
    if (!isEditable(e.target)) return;

    slashBusy = true;
    try {
      await handleSlashCommand(e.target, e);
    } catch (err) {
      console.error("[TypeLess] Slash handler error:", err);
    } finally {
      slashBusy = false;
    }
  };

  document.addEventListener("keydown", slashHandler, { capture: true, passive: false });

  // Debug helper — Edge'de çalışmıyorsa konsolda self.TLDebug() çağırarak test edilebilir
  self.TLDebug = async () => {
    const templates = await TL.getTemplates();
    console.log("[TypeLess] Templates:", templates);
    console.log("[TypeLess] Cache:", templateCache);
    console.log("[TypeLess] Last focused:", lastFocusedElement);
    console.log("[TypeLess] Active element:", document.activeElement);
    return { templates, cache: templateCache, lastFocused: lastFocusedElement };
  };

})();
