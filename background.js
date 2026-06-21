// @ts-check
// ==============================
// TypeLess — Background
// ==============================
// Chrome/Edge: service_worker (MV3). Firefox: background.scripts
// (common.js is loaded first by the manifest).
// ==============================

// Load common.js in the service-worker context if not already present.
if (typeof self.TL === "undefined") {
  try {
    self.importScripts("common.js");
  } catch (e) {
    console.error("[TypeLess] Failed to load common.js:", e);
  }
}

// --- Keyboard shortcut handling: quick-slot paste resolves by order ---
chrome.commands.onCommand.addListener(async (command) => {
  const match = /^paste-template-(\d+)$/.exec(command);
  if (!match) return;

  const index = Number(match[1]) - 1;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  if (TL.isSystemUrl(tab.url)) return;

  const templates = await TL.getTemplates(); // order-sorted
  const template = templates[index];
  if (!template) return;

  try {
    await TL.pasteToTab(tab.id, template, 100);
  } catch (err) {
    console.warn("[TypeLess] Cannot paste on this page:", err.message);
  }
});

// --- Install / update: defaults on install, authoritative migrate on update ---
// This is the single writer for migration: it reads the whole store, migrates
// it to the current schema and writes once. Other contexts migrate-on-read
// without writing. (Plan step 7)
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === "install") {
    const existing = await TL.getTemplates();
    if (existing.length > 0) return;

    const lang = (chrome.i18n.getUILanguage?.() || "en").toLowerCase();
    const isTurkish = lang.startsWith("tr");
    await TL.loadLocale(isTurkish ? "tr" : "en");

    const defaults = [
      { name: TL.t("defaultTpl1Name"), shortcut: isTurkish ? "sifre" : "pass", body: TL.t("defaultTpl1Body") },
      { name: TL.t("defaultTpl2Name"), shortcut: isTurkish ? "bilgi" : "info", body: TL.t("defaultTpl2Body") },
      { name: TL.t("defaultTpl3Name"), shortcut: isTurkish ? "kapanis" : "close", body: TL.t("defaultTpl3Body") },
    ];
    await TL.setTemplates(defaults);
    return;
  }

  if (reason === "update") {
    try {
      const raw = await chrome.storage.local.get(null);
      if (raw.schemaVersion === TL.CURRENT_SCHEMA) return; // already migrated
      const migrated = TL.migrate(raw);
      await chrome.storage.local.set({
        templates: migrated.templates,
        quickSlots: migrated.quickSlots,
        schemaVersion: TL.CURRENT_SCHEMA,
      });
      console.info("[TypeLess] Migrated store to schema v" + TL.CURRENT_SCHEMA);
    } catch (err) {
      console.error("[TypeLess] Migration on update failed:", err);
    }
  }
});
