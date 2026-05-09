// ==============================
// TypeLess — Options page
// ==============================

(async function () {
  "use strict";

  // --- State ---
  let templates = [];
  let selectedIndices = new Set();
  let pendingImport = null;
  let userLang = "auto";
  let suppressNextStorageEvent = false;

  // --- i18n load ---
  userLang = await TL.getLang();
  await TL.loadLocale(userLang);

  // --- DOM refs (cached) ---
  const $ = (id) => document.getElementById(id);
  const refs = {
    pageTitle: $("page-title"),
    title: $("title"),
    subtitle: $("subtitle"),
    hintsTitle: $("hints-title"),
    hintPlaceholder: $("hint-placeholder"),
    hintShortcut: $("hint-shortcut"),
    hintSlash: $("hint-slash"),
    btnAdd: $("add"),
    btnExportAll: $("export-all"),
    btnImport: $("import-btn"),
    importFile: $("import-file"),
    status: $("status"),
    langSelect: $("lang-select"),
    selectionBar: $("selection-bar"),
    selectionCount: $("selection-count"),
    btnExportSelected: $("export-selected"),
    btnDeselectAll: $("deselect-all"),
    templates: $("templates"),
    importModal: $("import-modal"),
    importModalTitle: $("import-modal-title"),
    importPreview: $("import-preview"),
    importMergeLabel: $("import-merge-label"),
    importReplaceLabel: $("import-replace-label"),
    importCancel: $("import-cancel"),
    importConfirm: $("import-confirm"),
    footerMadeBy: $("footer-made-by"),
    footerGithub: $("footer-github")
  };

  // --- Apply translations to static UI ---
  function applyUIStrings() {
    const title = TL.t("optionsTitle");
    refs.pageTitle.textContent = title;
    refs.title.textContent = title;
    refs.subtitle.textContent = TL.t("tagline");
    refs.hintsTitle.textContent = TL.t("hintsTitle");
    refs.hintPlaceholder.textContent = TL.t("hintPlaceholder");
    refs.hintShortcut.textContent = TL.t("hintShortcut");
    refs.hintSlash.textContent = TL.t("hintSlash");
    refs.btnAdd.textContent = TL.t("btnAdd");
    refs.btnExportAll.textContent = TL.t("btnExportAll");
    refs.btnImport.textContent = TL.t("btnImport");
    refs.btnExportSelected.textContent = TL.t("btnExportSelected");
    refs.btnDeselectAll.textContent = TL.t("btnDeselectAll");
    refs.importModalTitle.textContent = TL.t("btnImport");
    refs.importMergeLabel.textContent = TL.t("importMerge");
    refs.importReplaceLabel.textContent = TL.t("importReplace");
    refs.importCancel.textContent = TL.t("importCancel");
    refs.importConfirm.textContent = TL.t("btnImport");
    refs.langSelect.value = userLang;
    refs.footerMadeBy.textContent = TL.t("madeBy") + " ";
    refs.footerGithub.textContent = TL.t("viewOnGithub");
  }

  // --- Status indicator (debounced feedback) ---
  let statusTimer = null;
  function showStatus(msg) {
    refs.status.textContent = msg;
    refs.status.style.opacity = "1";
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      refs.status.style.opacity = "0";
      setTimeout(() => (refs.status.textContent = ""), 300);
    }, 2000);
  }

  // --- Persistence (debounced to batch rapid edits) ---
  const save = TL.debounce(async () => {
    suppressNextStorageEvent = true;
    try {
      await TL.setTemplates(templates);
      showStatus(TL.t("statusSaved"));
    } catch (err) {
      suppressNextStorageEvent = false;
      console.error("[TypeLess] Save failed:", err);
      showStatus(TL.t("statusError"));
    }
  }, 400);

  async function saveNow() {
    await TL.setTemplates(templates);
    showStatus(TL.t("statusSaved"));
  }

  // --- Selection bar update ---
  function updateSelectionBar() {
    const count = selectedIndices.size;
    if (count > 0) {
      refs.selectionBar.classList.add("visible");
      refs.selectionCount.textContent = TL.t("selectedCount", [String(count)]);
    } else {
      refs.selectionBar.classList.remove("visible");
    }
  }

  // --- Helper: build a single template card using DOM API (CSP-safe) ---
  function buildTemplateCard(tpl, i, total) {
    const card = document.createElement("div");
    card.className = "template" + (selectedIndices.has(i) ? " selected" : "");
    card.dataset.idx = String(i);

    // Header: checkbox + name + index/shortcut label + export button
    const header = document.createElement("div");
    header.className = "template-header";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.select = String(i);
    checkbox.checked = selectedIndices.has(i);
    checkbox.setAttribute("aria-label", `Select template ${i + 1}`);
    header.appendChild(checkbox);

    const nameSpan = document.createElement("span");
    nameSpan.className = "template-name-inline";
    nameSpan.textContent = tpl.name || "";
    header.appendChild(nameSpan);

    const indexSpan = document.createElement("span");
    indexSpan.className = "index-label";
    const indexText = TL.t("indexLabel", [String(i + 1)]);
    const shortcutText = i < 3 ? TL.t("shortcutLabel", [String(i + 1)]) : "";
    indexSpan.textContent = indexText + shortcutText;
    header.appendChild(indexSpan);

    const exportBtn = document.createElement("button");
    exportBtn.className = "small";
    exportBtn.dataset.action = "export-one";
    exportBtn.dataset.idx = String(i);
    exportBtn.title = TL.t("exportSingleTooltip");
    exportBtn.textContent = TL.t("btnExportOne");
    header.appendChild(exportBtn);

    card.appendChild(header);

    // Row 1: Name + Shortcut
    const row = document.createElement("div");
    row.className = "row";

    const nameWrap = document.createElement("div");
    const nameLabel = document.createElement("label");
    nameLabel.textContent = TL.t("labelName");
    const nameInput = document.createElement("input");
    nameInput.dataset.field = "name";
    nameInput.dataset.idx = String(i);
    nameInput.value = tpl.name || "";
    nameInput.maxLength = 200;
    nameWrap.appendChild(nameLabel);
    nameWrap.appendChild(nameInput);
    row.appendChild(nameWrap);

    const shortcutWrap = document.createElement("div");
    const shortcutLabel = document.createElement("label");
    shortcutLabel.textContent = TL.t("labelShortcut");
    const shortcutInput = document.createElement("input");
    shortcutInput.dataset.field = "shortcut";
    shortcutInput.dataset.idx = String(i);
    shortcutInput.value = tpl.shortcut || "";
    shortcutInput.maxLength = 50;
    shortcutWrap.appendChild(shortcutLabel);
    shortcutWrap.appendChild(shortcutInput);
    row.appendChild(shortcutWrap);

    card.appendChild(row);

    // Body textarea
    const bodyWrap = document.createElement("div");
    const bodyLabel = document.createElement("label");
    bodyLabel.textContent = TL.t("labelBody");
    const bodyArea = document.createElement("textarea");
    bodyArea.dataset.field = "body";
    bodyArea.dataset.idx = String(i);
    bodyArea.value = tpl.body || "";
    bodyWrap.appendChild(bodyLabel);
    bodyWrap.appendChild(bodyArea);
    card.appendChild(bodyWrap);

    // Actions: up / down / delete
    const actions = document.createElement("div");
    actions.className = "actions";

    const upBtn = document.createElement("button");
    upBtn.dataset.action = "up";
    upBtn.dataset.idx = String(i);
    upBtn.disabled = i === 0;
    upBtn.textContent = TL.t("btnUp");
    actions.appendChild(upBtn);

    const downBtn = document.createElement("button");
    downBtn.dataset.action = "down";
    downBtn.dataset.idx = String(i);
    downBtn.disabled = i === total - 1;
    downBtn.textContent = TL.t("btnDown");
    actions.appendChild(downBtn);

    const delBtn = document.createElement("button");
    delBtn.className = "danger";
    delBtn.dataset.action = "delete";
    delBtn.dataset.idx = String(i);
    delBtn.textContent = TL.t("btnDelete");
    actions.appendChild(delBtn);

    card.appendChild(actions);

    return card;
  }

  // --- Render templates (uses DocumentFragment + event delegation) ---
  function render() {
    const frag = document.createDocumentFragment();
    templates.forEach((tpl, i) => {
      frag.appendChild(buildTemplateCard(tpl, i, templates.length));
    });
    refs.templates.replaceChildren(frag);
  }

  // --- Event delegation for all template interactions ---

  // Text inputs: live update + debounced save
  refs.templates.addEventListener("input", (e) => {
    const el = e.target;
    const field = el.dataset?.field;
    if (!field) return;
    const idx = Number(el.dataset.idx);
    if (!templates[idx]) return;

    // Shortcut: strip invalid chars live
    let value = el.value;
    if (field === "shortcut") {
      value = value.replace(/[^\w-]/g, "");
      if (value !== el.value) el.value = value;
    }
    templates[idx][field] = value;

    // Live sync the name display in header
    if (field === "name") {
      const header = el.closest(".template").querySelector(".template-name-inline");
      if (header) header.textContent = value;
    }

    save();
  });

  // Checkbox selection
  refs.templates.addEventListener("change", (e) => {
    const el = e.target;
    if (el.matches('input[type="checkbox"][data-select]')) {
      const idx = Number(el.dataset.select);
      if (el.checked) selectedIndices.add(idx);
      else selectedIndices.delete(idx);
      el.closest(".template").classList.toggle("selected", el.checked);
      updateSelectionBar();
    }
  });

  // Action buttons (up/down/delete/export-one)
  refs.templates.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;

    const idx = Number(btn.dataset.idx);
    const action = btn.dataset.action;

    if (action === "delete") {
      if (!confirm(TL.t("confirmDelete"))) return;
      templates.splice(idx, 1);
      // Shift selection indices
      const next = new Set();
      selectedIndices.forEach((i) => {
        if (i === idx) return;
        next.add(i > idx ? i - 1 : i);
      });
      selectedIndices = next;
    } else if (action === "up" && idx > 0) {
      [templates[idx - 1], templates[idx]] = [templates[idx], templates[idx - 1]];
      // Keep selection in sync
      swapSelection(idx - 1, idx);
    } else if (action === "down" && idx < templates.length - 1) {
      [templates[idx + 1], templates[idx]] = [templates[idx], templates[idx + 1]];
      swapSelection(idx, idx + 1);
    } else if (action === "export-one") {
      const tpl = templates[idx];
      exportTemplates([tpl], TL.sanitizeFilename(tpl.name));
      return;
    } else {
      return;
    }

    await saveNow();
    render();
    updateSelectionBar();
  });

  function swapSelection(a, b) {
    const hasA = selectedIndices.has(a);
    const hasB = selectedIndices.has(b);
    selectedIndices.delete(a);
    selectedIndices.delete(b);
    if (hasA) selectedIndices.add(b);
    if (hasB) selectedIndices.add(a);
  }

  // --- Export helper ---
  function exportTemplates(items, filename) {
    const json = JSON.stringify(items, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoke after click completes
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  // --- Top-level actions ---
  refs.btnAdd.addEventListener("click", async () => {
    templates.push({
      name: TL.t("defaultTpl1Name"),
      shortcut: "",
      body: ""
    });
    await saveNow();
    render();
    // Scroll to newly added
    const cards = refs.templates.querySelectorAll(".template");
    cards.at(-1)?.scrollIntoView({ behavior: "smooth", block: "end" });
  });

  refs.btnExportAll.addEventListener("click", () => {
    if (templates.length === 0) return;
    const stamp = new Date().toISOString().slice(0, 10);
    exportTemplates(templates, `typeless-templates-${stamp}`);
  });

  refs.btnExportSelected.addEventListener("click", () => {
    const indices = [...selectedIndices].sort((a, b) => a - b);
    if (indices.length === 0) return;
    const selected = indices.map((i) => templates[i]);
    const stamp = new Date().toISOString().slice(0, 10);
    exportTemplates(selected, `typeless-selected-${stamp}`);
  });

  refs.btnDeselectAll.addEventListener("click", () => {
    selectedIndices.clear();
    render();
    updateSelectionBar();
  });

  // --- Import flow ---
  refs.btnImport.addEventListener("click", () => {
    refs.importFile.click();
  });

  refs.importFile.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error(TL.t("importInvalid"));
      }

      const valid = TL.validateTemplates(parsed);
      if (valid.length === 0) throw new Error(TL.t("importInvalid"));

      pendingImport = valid;
      refs.importPreview.textContent = TL.t("importPreview", [String(valid.length)]);
      refs.importModal.classList.add("visible");
    } catch (err) {
      alert(TL.t("importError", [err.message]));
    } finally {
      // Reset so same file can be re-selected
      e.target.value = "";
    }
  });

  function closeImportModal() {
    refs.importModal.classList.remove("visible");
    pendingImport = null;
  }

  refs.importCancel.addEventListener("click", closeImportModal);

  refs.importModal.addEventListener("click", (e) => {
    if (e.target === refs.importModal) closeImportModal();
  });

  refs.importConfirm.addEventListener("click", async () => {
    if (!pendingImport) return;
    const mode = document.querySelector('input[name="import-mode"]:checked')?.value;
    const count = pendingImport.length;

    if (mode === "replace") {
      templates = pendingImport;
      selectedIndices.clear();
    } else {
      templates = templates.concat(pendingImport);
    }

    await saveNow();
    closeImportModal();
    render();
    updateSelectionBar();
    showStatus(TL.t("importSuccess", [String(count)]));
  });

  // ESC closes modal
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && refs.importModal.classList.contains("visible")) {
      closeImportModal();
    }
  });

  // --- Language switcher ---
  refs.langSelect.addEventListener("change", async (e) => {
    userLang = e.target.value;
    await TL.setLang(userLang);
    await TL.loadLocale(userLang);
    applyUIStrings();
    render();
  });

  // --- React to storage changes from other contexts ---
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.templates) {
      if (suppressNextStorageEvent) {
        suppressNextStorageEvent = false;
      } else {
        templates = changes.templates.newValue || [];
        render();
        updateSelectionBar();
      }
    }
  });

  // --- Initial load ---
  applyUIStrings();
  templates = await TL.getTemplates();
  render();
})();
