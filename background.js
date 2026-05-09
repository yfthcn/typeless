// ==============================
// TypeLess — Background
// ==============================
// Chrome/Edge: çalışır as service_worker (MV3)
// Firefox: çalışır as background scripts (common.js manifest tarafından önceden yüklenir)
// ==============================

// Eğer common.js zaten yüklenmişse (Firefox background.scripts) atla.
// Yoksa (Chrome service_worker) importScripts ile yükle.
if (typeof self.TL === "undefined") {
  try {
    self.importScripts("common.js");
  } catch (e) {
    console.error("[TypeLess] Failed to load common.js:", e);
  }
}

// --- Keyboard shortcut handling ---
chrome.commands.onCommand.addListener(async (command) => {
  const match = /^paste-template-(\d+)$/.exec(command);
  if (!match) return;

  const index = Number(match[1]) - 1;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  if (TL.isSystemUrl(tab.url)) return;

  const templates = await TL.getTemplates();
  const template = templates[index];
  if (!template) return;

  try {
    await TL.pasteToTab(tab.id, template, 100);
  } catch (err) {
    console.warn("[TypeLess] Cannot paste on this page:", err.message);
  }
});

// --- Default templates on first install ---
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== "install") return;

  const existing = await TL.getTemplates();
  if (existing.length > 0) return;

  // Use browser's UI language for defaults
  const lang = (chrome.i18n.getUILanguage?.() || "en").toLowerCase();
  const isTurkish = lang.startsWith("tr");

  await TL.loadLocale(isTurkish ? "tr" : "en");

  const defaults = [
    {
      name: TL.t("defaultTpl1Name"),
      shortcut: isTurkish ? "sifre" : "pass",
      body: TL.t("defaultTpl1Body")
    },
    {
      name: TL.t("defaultTpl2Name"),
      shortcut: isTurkish ? "bilgi" : "info",
      body: TL.t("defaultTpl2Body")
    },
    {
      name: TL.t("defaultTpl3Name"),
      shortcut: isTurkish ? "kapanis" : "close",
      body: TL.t("defaultTpl3Body")
    }
  ];

  await TL.setTemplates(defaults);
});
