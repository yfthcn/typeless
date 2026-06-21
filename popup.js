// @ts-check
// ==============================
// TypeLess — Popup
// ==============================

(async function () {
  "use strict";

  const lang = await TL.getLang();
  await TL.loadLocale(lang);

  // --- Static UI strings ---
  document.getElementById("heading").textContent = TL.t("popupHeading");
  document.getElementById("tagline").textContent = TL.t("tagline");
  document.getElementById("options-link").textContent = TL.t("popupEditLink");
  document.getElementById("shortcut-hint").textContent = TL.t("popupShortcutHint");
  const searchEl = /** @type {HTMLInputElement} */ (document.getElementById("search"));
  searchEl.placeholder = TL.t("searchPlaceholder");

  const listEl = document.getElementById("list");
  let allTemplates = [];

  function renderList(filter = "") {
    const templates = filter ? TL.searchTemplates(filter, allTemplates) : allTemplates;
    listEl.replaceChildren();

    if (allTemplates.length === 0) {
      const div = document.createElement("div");
      div.className = "empty";
      div.textContent = TL.t("popupEmpty");
      listEl.appendChild(div);
      return;
    }
    if (templates.length === 0) {
      const div = document.createElement("div");
      div.className = "empty";
      div.textContent = TL.t("searchNoResults");
      listEl.appendChild(div);
      return;
    }

    const frag = document.createDocumentFragment();
    templates.forEach((tpl) => {
      const item = document.createElement("div");
      item.className = "template-item";
      item.role = "listitem";
      item.tabIndex = 0;
      item.dataset.id = tpl.id;

      const name = document.createElement("span");
      name.className = "template-name";
      name.textContent = tpl.name;

      const badge = document.createElement("span");
      badge.className = "template-shortcut";
      const slotIdx = allTemplates.indexOf(tpl);
      badge.textContent = tpl.shortcut
        ? "/" + tpl.shortcut
        : (slotIdx >= 0 && slotIdx < 3 ? `Ctrl+Shift+${slotIdx + 1}` : "");

      item.append(name, badge);
      frag.appendChild(item);
    });
    listEl.appendChild(frag);
  }

  // --- Event delegation: click + Enter/Space ---
  listEl.addEventListener("click", (e) => {
    const item = /** @type {any} */ (e.target).closest(".template-item");
    if (item) pasteTemplateById(item.dataset.id);
  });
  listEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      const item = /** @type {any} */ (e.target).closest(".template-item");
      if (!item) return;
      e.preventDefault();
      pasteTemplateById(item.dataset.id);
    }
  });

  // --- Search (debounced) ---
  searchEl.addEventListener("input", TL.debounce(() => renderList(searchEl.value), 120));
  searchEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const first = /** @type {any} */ (listEl.querySelector(".template-item"));
      if (first) { e.preventDefault(); pasteTemplateById(first.dataset.id); }
    }
  });

  async function pasteTemplateById(id) {
    const tpl = allTemplates.find((x) => x.id === id);
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

  function showPopupError(msg) {
    let errEl = document.getElementById("popup-error");
    if (!errEl) {
      errEl = document.createElement("div");
      errEl.id = "popup-error";
      const footer = document.querySelector(".footer");
      if (footer) document.body.insertBefore(errEl, footer);
      else document.body.appendChild(errEl);
    }
    errEl.textContent = msg;
  }

  document.getElementById("options-link").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  allTemplates = await TL.getTemplates();
  renderList();
  searchEl.focus();
})();
