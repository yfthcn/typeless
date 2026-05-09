# Changelog

All notable changes to TypeLess will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-05-09

### Added
- New i18n key `popupSystemPage` for system-page paste error messages (en, tr).
- Shared helpers `TL.isSystemUrl(url)` and `TL.pasteToTab(tabId, template)` in `common.js` to consolidate URL filtering and paste-with-fallback logic.
- `setNativeValue(el, value)` helper in `content.js` for DRY native-setter pattern.
- Build script (`build.py`) now filters dev/internal `.md` files from store packages via glob patterns (`*-bug-*.md`, `*-fix-*.md`, `STEP*_*.md`, `ANALYSIS_*.md`), with `README.md` / `CHANGELOG.md` / `CONTRIBUTING.md` / `LICENSE` whitelisted.
- Build script forces UTF-8 stdout on Windows to avoid cp1252 encoding errors.
- `CONTRIBUTING.md`, `CHANGELOG.md`, `.github/` templates and CI workflow.
- Placeholder modal now shows the template name beneath the title for clearer context when filling fields.

### Changed
- `showPlaceholderForm()` API simplified: removed redundant `onSubmit` callback parameter; now Promise-only (`resolve(values)` on submit, `resolve(null)` on cancel/escape).
- `popup.js` and `background.js` now delegate URL filtering and paste fallback to shared helpers in `common.js` (~25 lines removed across both).
- `background.js` URL filter now also blocks Web Store URLs (Chrome Web Store, Edge Add-ons, Firefox AMO) — previously only the URL scheme was checked. Paste shortcut on store pages now silently no-ops instead of throwing.

### Fixed
- Popup error message on system pages was hardcoded Turkish; now uses `popupSystemPage` i18n key (English users no longer see Turkish text).
- Removed startup `console.log` in `content.js` that fired on every page load (and every iframe with `all_frames: true`), causing console noise on every visited page.

### Removed
- Unused public API `TL.escapeAttr` (never called anywhere).
- Unused public API `TL.getActiveLang` (never called; module-private `activeLang` retained for `TL.t` lookup).

## [1.0.8] - 2026-04-17

This is the initial release in this repository (the v1.0.8 git tag points to the
first commit). Earlier 1.0.x versions exist as published store releases but have
no commit history here.

### Notable in 1.0.8
- Firefox AMO support (`browser_specific_settings.gecko` with `id`, `strict_min_version: "140.0"`, `data_collection_permissions: { required: ["none"] }`).
- Dual-build pipeline: `build.py` produces browser-specific Chrome (`service_worker`) and Firefox (`background.scripts`) packages from a single source manifest.
- Removed all `innerHTML` usage in favor of native DOM APIs (`createElement` / `textContent`) for store-review compliance and XSS-surface reduction.
- Bilingual UI (English / Turkish) via `chrome.i18n` + custom locale loader in `common.js`.
- Three paste mechanisms: keyboard shortcuts (`Ctrl+Shift+1..3`), popup menu, slash commands (`/shortcut + space`).
- Placeholder system: `{{variable_name}}` opens a Shadow-DOM-isolated form to collect values before paste.

## [Earlier versions]

For changes in 1.0.x releases prior to 1.0.8, see the GitHub Releases page —
no commit history exists in this repository for those versions.

[Unreleased]: https://github.com/yfthcn/typeless/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/yfthcn/typeless/releases/tag/v1.1.0
[1.0.8]: https://github.com/yfthcn/typeless/releases/tag/v1.0.8