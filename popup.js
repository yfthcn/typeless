// ==============================
// TypeLess — Popup
// ==============================

(async function () {
  "use strict";

  const lang = await TL.getLang();
  await TL.loadLocale(lang);

  // --- Apply static UI strings ---
  document.getElementById("heading").textContent = TL.t("popupHeading");
  document.getElementById("tagline").textContent = TL.t("tagline");
  document.getElementById("options-link").textContent = TL.t("popupEditLink");
  document.getElementById("shortcut-hint").textContent = TL.t("popupShortcutHint");

  // --- Render template list ---
  const listEl = document.getElementById("list");

  async function renderList() {
    const templates = await TL.getTemplates();
    listEl.replaceChildren();

    if (templates.length === 0) {
      const div = document.createElement("div");
      div.className = "empty";
      div.textContent = TL.t("popupEmpty");
      listEl.appendChild(div);
      return;
    }

    const frag = document.createDocumentFragment();
    templates.forEach((tpl, i) => {
      const item = document.createElement("div");
      item.className = "template-item";
      item.role = "listitem";
      item.tabIndex = 0;
      item.dataset.idx = String(i);

      const name = document.createElement("span");
      name.className = "template-name";
      name.textContent = tpl.name;

      const badge = document.createElement("span");
      badge.className = "template-shortcut";
      badge.textContent = tpl.shortcut
        ? "/" + tpl.shortcut
        : (i < 3 ? `Ctrl+Shift+${i + 1}` : "");

      item.append(name, badge);
      frag.appendChild(item);
    });
    listEl.appendChild(frag);
  }

  // --- Event delegation: click + Enter/Space for keyboard nav ---
  listEl.addEventListener("click", (e) => {
    const item = e.target.closest(".template-item");
    if (!item) return;
    const idx = Number(item.dataset.idx);
    pasteTemplateByIndex(idx);
  });

  listEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      const item = e.target.closest(".template-item");
      if (!item) return;
      e.preventDefault();
      pasteTemplateByIndex(Number(item.dataset.idx));
    }
  });

  async function pasteTemplateByIndex(idx) {
    const templates = await TL.getTemplates();
    const tpl = templates[idx];
    if (!tpl) return;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    if (TL.isSystemUrl(tab.url)) {
      showPopupError(TL.t("popupSystemPage"));
      return;
    }

    try {
      await TL.pasteToTab(tab.id, tpl, 200);
      window.close();
    } catch (err) {
      showPopupError(TL.t("popupNoAccess") + " (" + err.message + ")");
    }
  }

  // Popup içi hata gösterimi (alert yerine)
  function showPopupError(msg) {
    let errEl = document.getElementById("popup-error");
    if (!errEl) {
      errEl = document.createElement("div");
      errEl.id = "popup-error";
      errEl.style.cssText = "background:#fef2f2;border:1px solid #fca5a5;color:#991b1b;padding:10px 12px;border-radius:6px;font-size:12px;margin-top:10px;line-height:1.4";
      const footer = document.querySelector(".footer");
      if (footer) {
        document.body.insertBefore(errEl, footer);
      } else {
        document.body.appendChild(errEl);
      }
    }
    errEl.textContent = msg;
  }

  // --- Options link ---
  document.getElementById("options-link").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  await renderList();
})();
