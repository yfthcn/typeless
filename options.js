// @ts-check
// ==============================
// TypeLess — Options page
// ==============================

(async function () {
  "use strict";

  // --- State ---
  let templates = [];
  let selectedIds = new Set();      // id-based (survives reorder/delete) — plan step 17
  let pendingImport = null;          // validated templates awaiting confirm
  let pendingConflicts = [];         // incoming shortcuts that collide (lowercased)
  let pendingSource = null;          // "textblaze" | "magical" | null
  let userLang = "auto";
  let lastWriteSig = "";             // fingerprint of our last write (echo detection)
  let lastFocusedBody = null;        // for variable insertion
  let searchTerm = "";

  // Cheap fingerprint of a template list — only OUR own storage echo matches it,
  // so a concurrent write from another context (other tab/backup/migration) is
  // applied instead of being swallowed.
  const sig = (list) => (Array.isArray(list) ? list : []).map((t) => t.id + ":" + (t.body || "").length).join("|");

  userLang = await TL.getLang();
  await TL.loadLocale(userLang);

  const $ = (id) => /** @type {any} */ (document.getElementById(id));
  const refs = {
    pageTitle: $("page-title"), title: $("title"), subtitle: $("subtitle"),
    hintsTitle: $("hints-title"), hintPlaceholder: $("hint-placeholder"),
    hintShortcut: $("hint-shortcut"), hintSlash: $("hint-slash"),
    btnAdd: $("add"), btnExportAll: $("export-all"), btnExportClip: $("export-clip"),
    btnImport: $("import-btn"), btnBackups: $("backups-btn"), importFile: $("import-file"),
    status: $("status"), langSelect: $("lang-select"),
    search: $("search"), varBtn: $("var-btn"), varList: $("var-list"),
    backupsPanel: $("backups-panel"), backupsTitle: $("backups-title"), backupsList: $("backups-list"),
    selectionBar: $("selection-bar"), selectionCount: $("selection-count"),
    btnExportSelected: $("export-selected"), btnDeselectAll: $("deselect-all"),
    templates: $("templates"),
    importModal: $("import-modal"), importModalTitle: $("import-modal-title"),
    importPreview: $("import-preview"), importSource: $("import-source"),
    importMergeLabel: $("import-merge-label"), importReplaceLabel: $("import-replace-label"),
    importCancel: $("import-cancel"), importConfirm: $("import-confirm"),
    conflictNote: $("conflict-note"), conflictText: $("conflict-text"),
    conflictKeepboth: $("conflict-keepboth"), conflictOverwrite: $("conflict-overwrite"), conflictSkip: $("conflict-skip"),
    footerMadeBy: $("footer-made-by"), footerGithub: $("footer-github"),
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
    refs.btnExportClip.textContent = TL.t("btnExportClip");
    refs.btnImport.textContent = TL.t("btnImport");
    refs.btnBackups.textContent = TL.t("btnBackups");
    refs.btnExportSelected.textContent = TL.t("btnExportSelected");
    refs.btnDeselectAll.textContent = TL.t("btnDeselectAll");
    refs.importModalTitle.textContent = TL.t("btnImport");
    refs.importMergeLabel.textContent = TL.t("importMerge");
    refs.importReplaceLabel.textContent = TL.t("importReplace");
    refs.importCancel.textContent = TL.t("importCancel");
    refs.importConfirm.textContent = TL.t("btnImport");
    refs.conflictKeepboth.textContent = TL.t("conflictKeepboth");
    refs.conflictOverwrite.textContent = TL.t("conflictOverwrite");
    refs.conflictSkip.textContent = TL.t("conflictSkip");
    refs.backupsTitle.textContent = TL.t("backupsTitle");
    refs.langSelect.value = userLang;
    refs.search.placeholder = TL.t("searchPlaceholder");
    refs.varBtn.textContent = TL.t("varInsert");
    refs.footerMadeBy.textContent = TL.t("madeBy") + " ";
    refs.footerGithub.textContent = TL.t("viewOnGithub");
    buildVarMenu();
  }

  // --- Status indicator ---
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

  // --- Persistence ---
  const save = TL.debounce(async () => {
    try {
      await TL.setTemplates(templates);
      lastWriteSig = sig(templates);
      showStatus(TL.t("statusSaved"));
    } catch (err) {
      console.error("[TypeLess] Save failed:", err);
      showStatus(TL.t("statusError"));
    }
  }, 400);

  async function saveNow() {
    await TL.setTemplates(templates);
    templates = await TL.getTemplates(); // re-read to pick up stamped ids/order
    lastWriteSig = sig(templates);
    showStatus(TL.t("statusSaved"));
  }

  // --- Selection bar ---
  function updateSelectionBar() {
    const count = selectedIds.size;
    if (count > 0) {
      refs.selectionBar.classList.add("visible");
      refs.selectionCount.textContent = TL.t("selectedCount", [String(count)]);
    } else {
      refs.selectionBar.classList.remove("visible");
    }
  }

  // --- Visible templates (search filter) ---
  function visibleTemplates() {
    return searchTerm ? TL.searchTemplates(searchTerm, templates) : templates;
  }

  // --- Build one card (DOM API, CSP-safe) ---
  function buildTemplateCard(tpl, i, total) {
    const card = document.createElement("div");
    card.className = "template" + (selectedIds.has(tpl.id) ? " selected" : "");
    card.dataset.idx = String(i);
    card.dataset.id = tpl.id;
    // NOTE: the card itself is NOT draggable — a draggable container blocks
    // mouse text-selection/caret placement inside the rich-text editor. Only
    // the drag handle is draggable (standard drag-handle pattern).

    const header = document.createElement("div");
    header.className = "template-header";

    const handle = document.createElement("span");
    handle.className = "drag-handle";
    handle.textContent = "⠿";
    handle.title = TL.t("dragHint");
    handle.draggable = true;
    header.appendChild(handle);

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.select = tpl.id;
    checkbox.checked = selectedIds.has(tpl.id);
    checkbox.setAttribute("aria-label", `Select ${tpl.name || i + 1}`);
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

    // Name + Shortcut row
    const row = document.createElement("div");
    row.className = "row";
    row.appendChild(labeledInput(TL.t("labelName"), "name", i, tpl.name || "", 200));
    row.appendChild(labeledInput(TL.t("labelShortcut"), "shortcut", i, tpl.shortcut || "", 50));
    card.appendChild(row);

    // Tags
    const tagsWrap = document.createElement("div");
    tagsWrap.className = "tags-wrap";
    const tagsLabel = document.createElement("label");
    tagsLabel.textContent = TL.t("labelTags");
    const tagsInput = document.createElement("input");
    tagsInput.className = "tag-input";
    tagsInput.dataset.field = "tags";
    tagsInput.dataset.idx = String(i);
    tagsInput.placeholder = TL.t("tagsPlaceholder");
    tagsInput.value = (tpl.tags || []).join(", ");
    tagsWrap.appendChild(tagsLabel);
    tagsWrap.appendChild(tagsInput);
    card.appendChild(tagsWrap);

    // Body (plain textarea or rich-text editor) + field-builder panel
    card.appendChild(buildBodySection(tpl, i));

    // Actions
    const actions = document.createElement("div");
    actions.className = "actions";
    actions.appendChild(actionBtn("up", i, TL.t("btnUp"), i === 0));
    actions.appendChild(actionBtn("down", i, TL.t("btnDown"), i === total - 1));
    const delBtn = actionBtn("delete", i, TL.t("btnDelete"), false);
    delBtn.classList.add("danger");
    actions.appendChild(delBtn);
    card.appendChild(actions);

    return card;
  }

  function labeledInput(labelText, field, idx, value, maxLen) {
    const wrap = document.createElement("div");
    const label = document.createElement("label");
    label.textContent = labelText;
    const input = document.createElement("input");
    input.dataset.field = field;
    input.dataset.idx = String(idx);
    input.value = value;
    input.maxLength = maxLen;
    wrap.appendChild(label);
    wrap.appendChild(input);
    return wrap;
  }

  function actionBtn(action, idx, text, disabled) {
    const btn = document.createElement("button");
    btn.dataset.action = action;
    btn.dataset.idx = String(idx);
    btn.disabled = disabled;
    btn.textContent = text;
    return btn;
  }

  // Sanitize + clamp the rich editor's content into the in-memory body and
  // refresh the char-count. Re-sanitizing a clamped slice repairs a mid-tag cut
  // so the in-memory body (used for exports) is always well-formed. Used by the
  // editor input, the toolbar commands and the insert-variable menu.
  function storeRichBody(i, editor) {
    let b = TL.sanitizeHtml(editor.innerHTML);
    if (b.length > TL.LIMITS.MAX_BODY) b = TL.sanitizeHtml(b.slice(0, TL.LIMITS.MAX_BODY));
    templates[i].body = b;
    const card = editor.closest(".template");
    const count = card && card.querySelector(".char-count");
    if (count) count.textContent = b.length + " / " + TL.LIMITS.MAX_BODY;
    save();
  }

  // ============================================================
  // Body section: plain/rich toggle, rich-text editor, field-builder
  // ============================================================
  function buildBodySection(tpl, i) {
    const wrap = document.createElement("div");
    const isHtml = tpl.format === "html";

    // Head: label + plain/rich toggle + fields toggle
    const head = document.createElement("div");
    head.className = "body-head";
    const bodyLabel = document.createElement("label");
    bodyLabel.textContent = TL.t("labelBody");
    head.appendChild(bodyLabel);

    const fieldsBtn = document.createElement("button");
    fieldsBtn.type = "button";
    fieldsBtn.className = "fields-toggle";
    fieldsBtn.textContent = "{ } " + TL.t("fieldsToggle");
    fieldsBtn.setAttribute("aria-expanded", "false");
    head.appendChild(fieldsBtn);

    const toggle = document.createElement("div");
    toggle.className = "fmt-toggle";
    const plainBtn = document.createElement("button");
    plainBtn.type = "button";
    plainBtn.textContent = TL.t("formatPlain");
    plainBtn.className = isHtml ? "" : "active";
    const richBtn = document.createElement("button");
    richBtn.type = "button";
    richBtn.textContent = TL.t("formatRich");
    richBtn.className = isHtml ? "active" : "";
    toggle.append(plainBtn, richBtn);
    head.appendChild(toggle);
    wrap.appendChild(head);

    plainBtn.addEventListener("click", () => setFormat(i, "text"));
    richBtn.addEventListener("click", () => setFormat(i, "html"));

    // Editor surface
    if (isHtml) {
      wrap.appendChild(buildRichToolbar(i));
      const editor = document.createElement("div");
      editor.className = "rich-editor";
      editor.contentEditable = "true";
      editor.setAttribute("role", "textbox");
      editor.setAttribute("aria-multiline", "true");
      editor.setAttribute("aria-label", TL.t("labelBody"));
      editor.dataset.idx = String(i);
      editor.dataset.richEditor = "1";
      // Make Enter produce <p> (allowed) rather than a bare <div> (which the
      // sanitizer unwraps, losing the line break).
      try { document.execCommand("defaultParagraphSeparator", false, "p"); } catch (_) {}
      // Body is stored sanitized; re-sanitize and insert as DOM nodes (no innerHTML).
      editor.replaceChildren(TL.htmlToFragment(TL.sanitizeHtml(tpl.body || "")));
      editor.addEventListener("focus", () => { lastFocusedBody = editor; });
      editor.addEventListener("input", () => storeRichBody(i, editor));
      // Paste into the editor: sanitize clipboard HTML before it lands.
      editor.addEventListener("paste", (e) => {
        e.preventDefault();
        const html = e.clipboardData.getData("text/html");
        const text = e.clipboardData.getData("text/plain");
        const safe = html ? TL.sanitizeHtml(html) : TL.escapeHtml(text).replace(/\n/g, "<br>");
        document.execCommand("insertHTML", false, safe);
      });
      wrap.appendChild(editor);
    } else {
      const bodyArea = document.createElement("textarea");
      bodyArea.dataset.field = "body";
      bodyArea.dataset.idx = String(i);
      bodyArea.maxLength = TL.LIMITS.MAX_BODY;
      bodyArea.value = tpl.body || "";
      bodyArea.addEventListener("focus", () => { lastFocusedBody = bodyArea; });
      bodyArea.addEventListener("input", () => {
        count.textContent = bodyArea.value.length + " / " + TL.LIMITS.MAX_BODY;
      });
      wrap.appendChild(bodyArea);
    }

    const count = document.createElement("div");
    count.className = "char-count";
    count.textContent = (tpl.body || "").length + " / " + TL.LIMITS.MAX_BODY;
    wrap.appendChild(count);

    // Field-builder panel (collapsible)
    const panel = document.createElement("div");
    panel.className = "fields-panel";
    panel.dataset.idx = String(i);
    wrap.appendChild(panel);
    fieldsBtn.addEventListener("click", () => {
      const open = panel.classList.toggle("open");
      fieldsBtn.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) renderFieldsPanel(panel, i);
    });

    return wrap;
  }

  function buildRichToolbar(i) {
    const bar = document.createElement("div");
    bar.className = "rt-toolbar";
    const cmds = [
      { cmd: "bold", label: "B", key: "tbBold", style: "font-weight:700" },
      { cmd: "italic", label: "I", key: "tbItalic", style: "font-style:italic" },
      { cmd: "underline", label: "U", key: "tbUnderline", style: "text-decoration:underline" },
      { cmd: "insertUnorderedList", label: "☰", key: "tbList", style: "" },
      { cmd: "createLink", label: "🔗", key: "tbLink", style: "" },
    ];
    for (const c of cmds) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = c.label;
      if (c.style) btn.style.cssText = c.style;
      btn.title = TL.t(c.key);
      btn.setAttribute("aria-label", TL.t(c.key));
      btn.addEventListener("mousedown", (e) => e.preventDefault()); // keep editor selection
      btn.addEventListener("click", () => {
        if (c.cmd === "createLink") {
          const url = prompt(TL.t("linkPrompt"), "https://");
          if (!url) return;
          const safe = TL.sanitizeHtml('<a href="' + TL.escapeHtml(url) + '">x</a>');
          if (!safe.includes("href")) return; // rejected unsafe scheme
          document.execCommand("createLink", false, url);
        } else {
          document.execCommand(c.cmd, false);
        }
        // Persist after the command mutates the focused editor.
        const editor = bar.parentElement.querySelector('[data-rich-editor]');
        if (editor) storeRichBody(i, editor);
      });
      bar.appendChild(btn);
    }
    return bar;
  }

  // Switch a template between plain and rich; convert content safely.
  async function setFormat(i, fmt) {
    if (!templates[i]) return;
    const cur = templates[i].format === "html" ? "html" : "text";
    if ((fmt === "html" ? "html" : "text") === cur) return;
    if (fmt === "text") {
      if (!confirm(TL.t("confirmToPlain"))) return;
      await TL.pushBackup();
      templates[i].body = TL.htmlToPlainText(templates[i].body || "");
      delete templates[i].format;
    } else {
      templates[i].format = "html";
      // Existing plain text is valid HTML content; escape it so '<' etc. survive.
      templates[i].body = TL.sanitizeHtml(TL.escapeHtml(templates[i].body || "").replace(/\n/g, "<br>"));
    }
    await saveNow();
    render();
  }

  // --- Field-builder panel ---
  function renderFieldsPanel(panel, i) {
    panel.replaceChildren();
    const fields = TL.parseFields(templates[i].body || "");
    if (fields.length === 0) {
      const empty = document.createElement("div");
      empty.className = "fields-empty";
      empty.textContent = TL.t("fieldsEmpty");
      panel.appendChild(empty);
    }
    for (const f of fields) panel.appendChild(buildFieldRow(f, i, panel));

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "small";
    addBtn.textContent = TL.t("fbAdd");
    addBtn.addEventListener("click", () => {
      const raw = prompt(TL.t("fbAddPrompt"), "");
      if (!raw) return;
      const name = raw.replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50);
      if (!name) return;
      appendToBody(i, "{{" + name + "}}");
      renderFieldsPanel(panel, i);
    });
    panel.appendChild(addBtn);
  }

  function buildFieldRow(field, i, panel) {
    const row = document.createElement("div");
    row.className = "field-row";

    const name = document.createElement("span");
    name.className = "fname";
    name.textContent = field.name;
    row.appendChild(name);

    const label = mkInput(field.label === field.name ? "" : field.label, TL.t("fbLabel"));
    const type = document.createElement("select");
    for (const [val, key] of [["text", "typeText"], ["multiline", "typeMultiline"], ["dropdown", "typeDropdown"], ["date", "typeDate"]]) {
      const o = document.createElement("option");
      o.value = val; o.textContent = TL.t(key);
      if (field.type === val) o.selected = true;
      type.appendChild(o);
    }
    const def = mkInput(field.def, TL.t("fbDefault"));
    const opts = mkInput((field.options || []).join(", "), TL.t("fbOptions"));
    opts.style.display = field.type === "dropdown" ? "" : "none";

    const remLabel = document.createElement("label");
    remLabel.className = "rem";
    const rem = document.createElement("input");
    rem.type = "checkbox";
    rem.checked = !!field.remember;
    if (TL.isSecretName(field.name)) { rem.disabled = true; rem.checked = false; rem.title = field.name; }
    remLabel.append(rem, document.createTextNode(TL.t("fbRemember")));

    row.append(label, type, def, opts, remLabel);

    const warn = document.createElement("div");
    warn.className = "field-warn";
    row.appendChild(warn);

    const apply = () => {
      opts.style.display = type.value === "dropdown" ? "" : "none";
      const hadMeta = /[|{}]/.test(label.value + def.value + opts.value) || /,/.test(label.value + def.value);
      const newField = {
        name: field.name,
        label: label.value || field.name,
        type: type.value,
        def: def.value,
        options: type.value === "dropdown" ? opts.value.split(",").map((s) => s.trim()).filter(Boolean) : [],
        remember: rem.checked,
      };
      warn.textContent = hadMeta ? TL.t("metacharWarn") : "";
      rewriteFieldToken(i, field.name, TL.buildFieldToken(newField));
    };
    label.addEventListener("input", apply);
    def.addEventListener("input", apply);
    opts.addEventListener("input", apply);
    type.addEventListener("change", apply);
    rem.addEventListener("change", apply);
    return row;
  }

  function mkInput(value, placeholder) {
    const el = document.createElement("input");
    el.type = "text";
    el.value = value || "";
    el.placeholder = placeholder;
    return el;
  }

  // Replace the {{name...}} token in the body with a freshly-built token.
  function rewriteFieldToken(i, name, newToken) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Global: a field can appear more than once in the body; keep every
    // occurrence in sync (parseFields dedups to one row but the token may repeat).
    const re = new RegExp("\\{\\{\\s*" + esc + "(\\|[^{}]*)?\\}\\}", "g");
    templates[i].body = (templates[i].body || "").replace(re, newToken);
    syncBodyControl(i);
    save();
  }

  function appendToBody(i, token) {
    const cur = templates[i].body || "";
    templates[i].body = cur + (cur && !cur.endsWith("\n") ? " " : "") + token;
    syncBodyControl(i);
    saveNow();
  }

  // Reflect a programmatic body change back into the visible editor/textarea.
  function syncBodyControl(i) {
    const card = refs.templates.querySelector('.template[data-idx="' + i + '"]');
    if (!card) return;
    const editor = card.querySelector('[data-rich-editor]');
    if (editor) { editor.replaceChildren(TL.htmlToFragment(TL.sanitizeHtml(templates[i].body || ""))); return; }
    const ta = card.querySelector('textarea[data-field="body"]');
    if (ta) ta.value = templates[i].body || "";
    const count = card.querySelector(".char-count");
    if (count) count.textContent = (templates[i].body || "").length + " / " + TL.LIMITS.MAX_BODY;
  }

  // --- Render ---
  function render() {
    const frag = document.createDocumentFragment();
    const list = visibleTemplates();
    if (list.length === 0 && searchTerm) {
      const empty = document.createElement("div");
      empty.className = "hint";
      empty.textContent = TL.t("searchNoResults");
      refs.templates.replaceChildren(empty);
      return;
    }
    // Cards are indexed by their position in the FULL templates array so
    // edits/reorder stay correct even while a search filter is active.
    list.forEach((tpl) => {
      const i = templates.indexOf(tpl);
      frag.appendChild(buildTemplateCard(tpl, i, templates.length));
    });
    refs.templates.replaceChildren(frag);
  }

  // --- Live text edits ---
  refs.templates.addEventListener("input", (e) => {
    const el = /** @type {any} */ (e.target);
    const field = el.dataset?.field;
    if (!field) return;
    const idx = Number(el.dataset.idx);
    if (!templates[idx]) return;

    let value = el.value;
    if (field === "shortcut") {
      value = value.replace(new RegExp(`[^${TL.SHORTCUT_CHARS}]`, "g"), "");
      if (value !== el.value) el.value = value;
      templates[idx].shortcut = value;
    } else if (field === "tags") {
      templates[idx].tags = TL.normalizeTags(value.split(","));
    } else {
      templates[idx][field] = value;
      if (field === "name") {
        const header = el.closest(".template").querySelector(".template-name-inline");
        if (header) header.textContent = value;
      }
    }
    save();
  });

  // --- Checkbox selection (id-based) ---
  refs.templates.addEventListener("change", (e) => {
    const el = /** @type {any} */ (e.target);
    if (el.matches('input[type="checkbox"][data-select]')) {
      const id = el.dataset.select;
      if (el.checked) selectedIds.add(id);
      else selectedIds.delete(id);
      el.closest(".template").classList.toggle("selected", el.checked);
      updateSelectionBar();
    }
  });

  // --- Action buttons ---
  refs.templates.addEventListener("click", async (e) => {
    const btn = /** @type {any} */ (e.target).closest("button[data-action]");
    if (!btn) return;
    const idx = Number(btn.dataset.idx);
    const action = btn.dataset.action;

    if (action === "delete") {
      if (!confirm(TL.t("confirmDelete"))) return;
      await TL.pushBackup(); // safety net before a destructive op
      const [removed] = templates.splice(idx, 1);
      if (removed) selectedIds.delete(removed.id);
    } else if (action === "up" && idx > 0) {
      [templates[idx - 1], templates[idx]] = [templates[idx], templates[idx - 1]];
    } else if (action === "down" && idx < templates.length - 1) {
      [templates[idx + 1], templates[idx]] = [templates[idx], templates[idx + 1]];
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

  // --- Drag-drop reorder (plan step 17) ---
  let dragId = null;
  refs.templates.addEventListener("dragstart", (e) => {
    // Drag is only initiated from the handle (the only draggable element).
    const el = /** @type {any} */ (e.target);
    if (!el.classList || !el.classList.contains("drag-handle")) { e.preventDefault(); return; }
    const card = el.closest(".template");
    if (!card) return;
    dragId = card.dataset.id;
    card.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    // Use the whole card as the drag image instead of the tiny handle.
    try { e.dataTransfer.setDragImage(card, 12, 12); } catch (_) {}
  });
  refs.templates.addEventListener("dragover", (e) => {
    e.preventDefault();
    const card = /** @type {any} */ (e.target).closest(".template");
    refs.templates.querySelectorAll(".drag-over").forEach((c) => c.classList.remove("drag-over"));
    if (card && card.dataset.id !== dragId) card.classList.add("drag-over");
  });
  refs.templates.addEventListener("drop", async (e) => {
    e.preventDefault();
    const card = /** @type {any} */ (e.target).closest(".template");
    if (!card || !dragId) return;
    const fromIdx = templates.findIndex((t) => t.id === dragId);
    const toIdx = templates.findIndex((t) => t.id === card.dataset.id);
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
    const [moved] = templates.splice(fromIdx, 1);
    templates.splice(toIdx, 0, moved);
    await saveNow();
    render();
  });
  refs.templates.addEventListener("dragend", () => {
    dragId = null;
    refs.templates.querySelectorAll(".dragging,.drag-over").forEach((c) => c.classList.remove("dragging", "drag-over"));
  });

  // --- Export helpers ---
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
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  // --- Top-level actions ---
  refs.btnAdd.addEventListener("click", async () => {
    if (templates.length >= TL.LIMITS.MAX_TEMPLATES) {
      showStatus(TL.t("capReached", [String(TL.LIMITS.MAX_TEMPLATES)]));
      return;
    }
    templates.push({ name: TL.t("defaultTpl1Name"), shortcut: "", body: "" });
    await saveNow();
    render();
    const cards = refs.templates.querySelectorAll(".template");
    cards[cards.length - 1]?.scrollIntoView({ behavior: "smooth", block: "end" });
  });

  refs.btnExportAll.addEventListener("click", () => {
    if (templates.length === 0) return;
    exportTemplates(templates, `typeless-templates-${stamp()}`);
  });

  refs.btnExportClip.addEventListener("click", async () => {
    if (templates.length === 0) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(templates, null, 2));
      showStatus(TL.t("clipCopied"));
    } catch (_) {
      showStatus(TL.t("statusError"));
    }
  });

  refs.btnExportSelected.addEventListener("click", () => {
    const selected = templates.filter((t) => selectedIds.has(t.id));
    if (selected.length === 0) return;
    exportTemplates(selected, `typeless-selected-${stamp()}`);
  });

  refs.btnDeselectAll.addEventListener("click", () => {
    selectedIds.clear();
    render();
    updateSelectionBar();
  });

  function stamp() {
    return new Date().toISOString().slice(0, 10);
  }

  // --- Search (debounced: full-text filter + full re-render per keystroke) ---
  refs.search.addEventListener("input", TL.debounce(() => {
    searchTerm = refs.search.value.trim();
    render();
  }, 150));

  // --- Variable insert menu ---
  const VARS = [
    { token: "{{cursor}}", key: "varCursor" },
    { token: "{{date}}", key: "varDate" },
    { token: "{{date+3d}}", key: "varDateOffset" },
    { token: "{{time}}", key: "varTime" },
    { token: "{{datetime}}", key: "varDatetime" },
    { token: "{{name|Label|text|default}}", key: "varField" },
  ];
  function buildVarMenu() {
    refs.varList.replaceChildren();
    for (const v of VARS) {
      const btn = document.createElement("button");
      btn.type = "button";
      const code = document.createElement("code");
      code.textContent = v.token;
      btn.appendChild(code);
      btn.appendChild(document.createTextNode(" — " + TL.t(v.key)));
      btn.addEventListener("click", () => { insertVariable(v.token); refs.varList.classList.remove("open"); });
      refs.varList.appendChild(btn);
    }
  }
  refs.varBtn.addEventListener("click", () => refs.varList.classList.toggle("open"));
  document.addEventListener("click", (e) => {
    if (!/** @type {any} */ (e.target).closest(".var-menu")) refs.varList.classList.remove("open");
  });
  function insertVariable(token) {
    const ta = lastFocusedBody;
    if (!ta) { showStatus(TL.t("varNeedField")); return; }
    const idx = Number(ta.dataset.idx);
    if (ta.dataset.richEditor) {
      ta.focus();
      document.execCommand("insertText", false, token);
      if (templates[idx]) storeRichBody(idx, ta);
      return;
    }
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? ta.value.length;
    ta.value = ta.value.slice(0, start) + token + ta.value.slice(end);
    if (templates[idx]) templates[idx].body = ta.value;
    ta.focus();
    const pos = start + token.length;
    ta.setSelectionRange(pos, pos);
    save();
  }

  // --- Backups panel ---
  refs.btnBackups.addEventListener("click", async () => {
    const open = refs.backupsPanel.classList.toggle("visible");
    if (open) await renderBackups();
  });

  async function renderBackups() {
    const backups = await TL.getBackups();
    refs.backupsList.replaceChildren();
    if (backups.length === 0) {
      const empty = document.createElement("div");
      empty.className = "backup-meta";
      empty.textContent = TL.t("backupEmpty");
      refs.backupsList.appendChild(empty);
      return;
    }
    for (const b of backups) {
      const item = document.createElement("div");
      item.className = "backup-item";
      const meta = document.createElement("span");
      meta.className = "backup-meta";
      meta.textContent = `${new Date(b.ts).toLocaleString()} · ${TL.t("backupCount", [String(b.count || (b.templates || []).length)])}`;
      const btn = document.createElement("button");
      btn.className = "small";
      btn.textContent = TL.t("backupRestore");
      btn.addEventListener("click", async () => {
        if (!confirm(TL.t("confirmRestore"))) return;
        await TL.pushBackup(); // snapshot current before overwriting
        await TL.restoreBackup(b.ts);
        templates = await TL.getTemplates();
        selectedIds.clear();
        render();
        updateSelectionBar();
        await renderBackups();
        showStatus(TL.t("backupRestored"));
      });
      item.append(meta, btn);
      refs.backupsList.appendChild(item);
    }
  }

  // ============================================================
  // Import flow — size guard, competitor auto-detect, conflicts
  // ============================================================
  refs.btnImport.addEventListener("click", () => refs.importFile.click());

  refs.importFile.addEventListener("change", async (e) => {
    const file = /** @type {any} */ (e.target).files?.[0];
    if (!file) return;
    try {
      if (file.size > TL.LIMITS.MAX_IMPORT_BYTES) {
        throw new Error(TL.t("importTooLarge", [String(Math.round(TL.LIMITS.MAX_IMPORT_BYTES / 1024 / 1024))]));
      }
      const text = await file.text();
      let parsed;
      try { parsed = JSON.parse(text); } catch { throw new Error(TL.t("importInvalid")); }

      // Competitor auto-detect (Text Blaze / Magical) → adapt, else native.
      const adapted = TL.detectAndAdapt(parsed);
      pendingSource = adapted ? adapted.source : null;
      const raw = adapted ? adapted.items : parsed;

      const summary = TL.validateTemplates(raw);
      if (summary.accepted.length === 0) throw new Error(TL.t("importInvalid"));
      pendingImport = summary.accepted;

      // Build preview text + summary
      let preview = TL.t("importPreview", [String(summary.accepted.length)]);
      if (summary.rejected || summary.truncated) {
        preview += " " + TL.t("importSummary", [String(summary.rejected), String(summary.truncated)]);
      }
      refs.importPreview.textContent = preview;

      refs.importSource.textContent = pendingSource
        ? TL.t("importSourceDetected", [pendingSource === "textblaze" ? "Text Blaze" : "Magical"])
        : "";

      // Conflicts (case-insensitive duplicate shortcuts vs existing)
      const existing = new Set(templates.map((t) => (t.shortcut || "").toLowerCase()).filter(Boolean));
      pendingConflicts = pendingImport
        .map((t) => (t.shortcut || "").toLowerCase())
        .filter((s) => s && existing.has(s));
      if (pendingConflicts.length) {
        refs.conflictText.textContent = TL.t("conflictText", [String(pendingConflicts.length)]);
        refs.conflictNote.classList.add("visible");
      } else {
        refs.conflictNote.classList.remove("visible");
      }

      refs.importModal.classList.add("visible");
    } catch (err) {
      alert(TL.t("importError", [err.message]));
    } finally {
      /** @type {any} */ (e.target).value = "";
    }
  });

  function closeImportModal() {
    refs.importModal.classList.remove("visible");
    refs.conflictNote.classList.remove("visible");
    pendingImport = null;
    pendingConflicts = [];
    pendingSource = null;
  }
  refs.importCancel.addEventListener("click", closeImportModal);
  refs.importModal.addEventListener("click", (e) => {
    if (e.target === refs.importModal) closeImportModal();
  });

  refs.importConfirm.addEventListener("click", async () => {
    if (!pendingImport) return;
    const mode = /** @type {any} */ (document.querySelector('input[name="import-mode"]:checked'))?.value;
    const conflictMode = /** @type {any} */ (document.querySelector('input[name="conflict-mode"]:checked'))?.value || "keepboth";
    const count = pendingImport.length;

    await TL.pushBackup(); // safety net before import

    if (mode === "replace") {
      templates = pendingImport.slice();
      selectedIds.clear();
    } else {
      templates = mergeImport(templates, pendingImport, conflictMode);
    }
    if (templates.length > TL.LIMITS.MAX_TEMPLATES) templates = templates.slice(0, TL.LIMITS.MAX_TEMPLATES);

    await saveNow();
    closeImportModal();
    render();
    updateSelectionBar();
    showStatus(TL.t("importSuccess", [String(count)]));
  });

  // Merge incoming into existing applying the chosen conflict strategy.
  function mergeImport(existing, incoming, conflictMode) {
    if (conflictMode === "keepboth") return existing.concat(incoming);
    const byShortcut = new Map();
    existing.forEach((t, i) => { if (t.shortcut) byShortcut.set(t.shortcut.toLowerCase(), i); });
    const result = existing.slice();
    for (const inc of incoming) {
      const key = (inc.shortcut || "").toLowerCase();
      if (key && byShortcut.has(key)) {
        if (conflictMode === "skip") continue;
        if (conflictMode === "overwrite") {
          const i = byShortcut.get(key);
          const next = { ...result[i], name: inc.name, body: inc.body, tags: inc.tags, fields: inc.fields };
          if (inc.format === "html") next.format = "html"; else delete next.format;
          result[i] = next;
          continue;
        }
      }
      result.push(inc);
    }
    return result;
  }

  // ESC closes modal
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && refs.importModal.classList.contains("visible")) closeImportModal();
  });

  // --- Language switcher ---
  refs.langSelect.addEventListener("change", async (e) => {
    userLang = /** @type {any} */ (e.target).value;
    await TL.setLang(userLang);
    await TL.loadLocale(userLang);
    applyUIStrings();
    render();
  });

  // --- React to external storage changes ---
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.templates) return;
    const next = /** @type {any[]} */ (changes.templates.newValue || []);
    if (sig(next) === lastWriteSig) return; // our own debounced-save echo — ignore
    templates = next.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    render();
    updateSelectionBar();
  });

  // --- Initial load ---
  applyUIStrings();
  templates = await TL.getTemplates();
  render();
})();
