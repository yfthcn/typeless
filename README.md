<div align="center">

<img src="icons/icon128.png" width="96" height="96" alt="TypeLess logo" />

# TypeLess

**Type less. Paste more.**

_Daha az yaz. Daha çok yapıştır._

A lightweight, cross-browser extension for pasting ready-made templates into ServiceNow, Zendesk, Jira, Gmail, or any web form — with keyboard shortcuts, slash commands, and placeholder forms.

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![License: GPL v3](https://img.shields.io/badge/License-GPL_v3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Browsers](https://img.shields.io/badge/browsers-Chrome%20%7C%20Edge%20%7C%20Firefox-success)](#installation)

[Installation](#installation) · [Usage](#usage) · [Türkçe](#türkçe) · [Privacy](#privacy)

</div>

---

## Features

- ⚡ **Three ways to paste** — keyboard shortcuts, popup menu, slash commands (`/shortcut + space`)
- 📝 **Placeholders** — use `{{variable_name}}` and a form pops up to fill them in
- 🌐 **Cross-browser** — Chrome 88+, Edge 88+, Firefox 140+, Brave, Opera, Vivaldi
- 🇬🇧🇹🇷 **Bilingual** — auto-detects English or Turkish from your browser
- 🔐 **Private by design** — no network calls, no analytics, no tracking
- 📤 **Import / Export** — share templates as JSON (single, selected, or batch)
- 🎨 **Universal editor support** — `<textarea>`, `<input>`, and rich editors (TinyMCE, CKEditor, Quill)
- ⌨️ **IME-safe** — won't interfere with Turkish, Japanese, Chinese, or Korean input methods
- 🔒 **No innerHTML anywhere** — all DOM built via native API for maximum security

## Installation

Two packages are built from one source. Pick the one for your browser.

### Chrome / Edge / Brave / Opera / Vivaldi

1. Download `typeless-chrome.zip` from [Releases](https://github.com/yfthcn/typeless/releases)
2. Extract to a **permanent location** (e.g., `Documents/typeless`)
3. Open `chrome://extensions` (or `edge://extensions`)
4. Enable **Developer mode**
5. Click **Load unpacked** and select the extracted folder
6. Pin the extension: 🧩 → pin "TypeLess"

### Firefox 140+

**Option A — From AMO (once approved):**

Install directly from [addons.mozilla.org](https://addons.mozilla.org/firefox/addon/typeless/).

**Option B — Temporary install (testing):**

1. Download `typeless-firefox.zip` from [Releases](https://github.com/yfthcn/typeless/releases)
2. Extract
3. Open `about:debugging#/runtime/this-firefox`
4. Click **Load Temporary Add-on** and select `manifest.json`

> Temporary add-ons reload when Firefox restarts.

## Usage

### Paste a template

| Method | How |
|---|---|
| **Keyboard shortcut** | `Ctrl+Shift+1`, `2`, or `3` — pastes the first three templates |
| **Popup menu** | Click the TypeLess icon, or press `Ctrl+Shift+T` |
| **Slash command** | Type `/yourcommand` + space in any text field |

### Placeholders

Put `{{variable_name}}` anywhere in a template body:

```
Hi {{customer_name}},

Your ticket {{ticket_no}} has been resolved.

Best regards.
```

When pasting, a form pops up asking for `customer_name` and `ticket_no`.

### Managing templates

Click the icon → **⚙ Edit Templates**:

- ➕ Add, rename, or delete templates
- ↕️ Reorder (first three get keyboard shortcuts automatically)
- ☑️ Select multiple templates and export as one JSON file
- 📥 Import templates — merge or replace
- 🌍 Switch language (Auto / English / Türkçe)

## Privacy

TypeLess is designed to be private by default:

- **No network requests** — the extension never calls any server
- **No analytics, no telemetry, no tracking**
- **Local storage only** — templates live in `chrome.storage.local`, never synced without your action
- **No third-party dependencies** — no bundled libraries, no CDNs, no remote code

Verify this yourself: every source file is plain JavaScript. Search for `fetch(`, `XMLHttpRequest`, or `sendBeacon` — you won't find any external URL anywhere in the codebase.

## Permissions Explained

| Permission | Why it's needed |
|---|---|
| `storage` | To save your templates locally |
| `activeTab` | To send the paste command to the page you clicked from |
| `scripting` | To inject the content script if it isn't present yet |
| `<all_urls>` | So templates can be pasted on any site you visit |

## Development

```bash
# Clone
git clone https://github.com/yfthcn/typeless.git
cd typeless

# Build packages for distribution
python3 build.py
# Creates dist/typeless-chrome.zip and dist/typeless-firefox.zip

# Load in Chrome/Edge directly (no build needed for dev):
# - Open chrome://extensions
# - Enable Developer mode
# - Load unpacked → select the project folder

# Load in Firefox directly:
# - Open about:debugging#/runtime/this-firefox
# - Load Temporary Add-on → select manifest.json
```

### Project structure

```
typeless/
├── manifest.json            # MV3 manifest (Chrome variant; Firefox gets transformed by build.py)
├── build.py                 # Creates Chrome and Firefox packages from single source
├── common.js                # Shared: i18n, escape, storage, validation
├── background.js            # Service worker (Chrome) / background script (Firefox)
├── content.js               # Injected into pages — paste logic & slash detection
├── popup.html / popup.js    # Template picker popup
├── options.html / .js       # Settings page — CRUD, import/export
├── icons/                   # 16/48/128px extension icons
└── _locales/
    ├── en/messages.json     # English strings
    └── tr/messages.json     # Turkish strings
```

### Why two packages?

Chrome MV3 requires `background.service_worker`. Firefox MV3 prefers `background.scripts` and doesn't fully support `service_worker` yet. A single manifest would trigger warnings in one browser or the other. `build.py` produces browser-specific manifests from one source, keeping the code identical.

### Adding a new language

1. Create `_locales/<code>/messages.json`, copy from `_locales/en/messages.json`
2. Translate each `"message"` field
3. Add an option in `options.html` language switcher

## Contributing

PRs welcome. Please keep changes focused — one feature per PR. The codebase is intentionally small and framework-free; let's keep it that way.

## License

GPL-3.0 — see [LICENSE](LICENSE).

---

## Türkçe

### TypeLess Nedir?

ServiceNow, Zendesk, Jira, Gmail veya herhangi bir web formuna hazır şablonları hızlıca yapıştırmanı sağlayan, hafif ve çapraz tarayıcı uyumlu bir tarayıcı uzantısı. Klavye kısayolları, slash komutları ve placeholder formları ile.

### Kurulum

**Chrome / Edge:**
1. `typeless-chrome.zip`'i [Releases](https://github.com/yfthcn/typeless/releases) sayfasından indir
2. Kalıcı bir klasöre çıkar
3. `chrome://extensions` (veya `edge://extensions`) adresini aç
4. **Geliştirici modu**nu etkinleştir
5. **Paketlenmemiş öğe yükle** → klasörü seç

**Firefox 140+:**

- AMO onayından sonra [addons.mozilla.org](https://addons.mozilla.org/firefox/addon/typeless/) üzerinden doğrudan kurulabilir.
- Geçici kurulum için: `about:debugging#/runtime/this-firefox` → **Geçici Eklenti Yükle** → `manifest.json`'ı seç.

### Kullanım

- **Klavye:** `Ctrl+Shift+1/2/3` ilk üç şablonu yapıştırır. `Ctrl+Shift+T` menüyü açar.
- **Menü:** Simgeye tıkla, listeden seç.
- **Slash komutu:** Herhangi bir alanda `/kısayol` + boşluk yaz.
- **Placeholder'lar:** Şablon içinde `{{değişken_adı}}` yazarsan yapıştırırken form açılır.

### Gizlilik

Hiçbir veri tarayıcı dışına çıkmaz. Dış ağ isteği yok, analitik yok, izleme yok.

---

Made with ☕ by [kaktusdev.net](https://kaktusdev.net) · [GitHub @yfthcn](https://github.com/yfthcn)
