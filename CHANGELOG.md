# Changelog

All notable changes to TypeLess will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed (independent code-review pass)
- Sanitizer DOM-free fallback: void kill-tags (`<base>`/`<meta>`/`<link>`/`<frame>`)
  no longer swallow trailing content.
- Import "overwrite" conflict mode now preserves/clears the `format` flag (was
  corrupting rich templates into plain on merge).
- Rich-editor body writes go through one `storeRichBody` helper that re-sanitizes
  a length-clamped slice (can't store mid-tag-truncated HTML) and keeps the
  char-count in sync across the editor, toolbar and insert-variable paths.
- Field-builder rewrites every occurrence of a repeated placeholder token.
- `storage.onChanged` uses a write-fingerprint instead of a one-shot suppress
  flag, so a concurrent write from another context is no longer swallowed;
  order-sort is NaN-safe.

### Changed
- content.js shares one constructable `CSSStyleSheet` (`adoptedStyleSheets`)
  across shadow hosts instead of injecting a `<style>` per host; options + popup
  search inputs are debounced.
- Added a static product page under `docs/` (GitHub Pages, EN/TR, comparison
  table) with a `pages.yml` deploy workflow, a user guide (`docs/USAGE.md`) and
  copy-paste store-listing copy (`docs/store-listing.md`). `docs/` is excluded
  from the packaged extension.

## [2.1.0] - 2026-06-21

Still 100% local, zero runtime dependencies, no new permissions, AMO
`data_collection_permissions.required = none` unchanged.

### Added
- **Rich-text templates.** A template can opt into formatted content
  (bold/italic/underline, links, bulleted lists) via a per-template plain↔rich
  toggle with a small toolbar in the options page. Rich templates paste
  **formatted** into rich editors (Gmail/CKEditor/Quill/ProseMirror/TinyMCE) and
  **degrade to clean plain text** in `<input>`/`<textarea>`.
- **Visual field-builder.** A collapsible *Fields* panel per template detects
  `{{placeholders}}` in the body and lets you set each field's label, type
  (text/multiline/dropdown/date), default, options and remember-last with form
  controls — writing the canonical pipe-syntax back into the body (which stays
  the single source of truth, so the paste path is unchanged).

### Security
- **`TL.sanitizeHtml` — one audited trust boundary.** Rich content is sanitized
  with a DOMParser-based allowlist rebuild (tags `b,strong,i,em,u,s,a,br,p,ul,ol,li`;
  every other element unwrapped or dropped-with-subtree; **all** attributes
  default-denied except a validated `href` on `<a>`; `javascript:`/`data:`/
  `vbscript:`/scheme-relative hrefs neutralised; `rel="noopener noreferrer nofollow"`
  forced). HTML is **re-sanitized on save, on import, and again at paste**.
- **Escape-on-fill.** Placeholder values in HTML templates are HTML-escaped
  before substitution and the whole result is sanitized last, so a malicious
  field value cannot inject markup at the one HTML sink.
- README "No innerHTML anywhere" reworded to reflect the single audited sanitizer.

### Changed
- `README.md` features + docs updated; `_locales` gained the rich-text and
  field-builder UI strings (EN/TR parity preserved). New `node:test` cases cover
  the sanitizer XSS corpus, escape-on-fill, `htmlToPlainText`, and the
  `buildFieldToken` round-trip.

## [2.0.0] - 2026-06-20

A large feature + maturity release. Everything stays **local — no server, no
network calls** — and the extension keeps shipping **zero runtime dependencies**.

### Fixed (P0 — independently shippable bugfixes)
- **Hyphenated / non-default shortcuts now expand via slash.** The slash matcher
  ignored `-` while the editor accepted it, so a `client-reply` shortcut could
  never be triggered by `/client-reply`. All three call sites (slash matcher,
  options live-strip, import validation) now derive from a single
  `TL.SHORTCUT_CHARS` constant.
- **No more double paste after content-script re-injection.** A per-frame
  `__TL_CONTENT_LOADED__` guard stops the `executeScript` fallback from
  registering a second set of listeners.
- **Rich-editor inserts preserve undo and caret.** ContentEditable paste now
  uses `insertText` (plain text, single-step undo) with a Selection-API
  fallback, and slash-token deletion uses a `Range` so CKEditor/Quill/ProseMirror
  models stay consistent.

### Added — features
- **Slash autocomplete** — typing `/` shows a caret-anchored, fuzzy-matched,
  dark-aware dropdown of templates (↑/↓ to move, Enter/Tab to accept, Esc to close).
- **Dynamic variables** (zero-permission, computed locally): `{{date}}`,
  `{{time}}`, `{{datetime}}`, date offsets like `{{date+3d}}` / `{{date-2w}}`,
  and `{{cursor}}` to position the caret after paste.
- **Smart placeholder fields** via pipe syntax
  `{{name|Label|type|default|opt1,opt2|remember}}` — text / multiline / dropdown /
  date inputs, defaults, and opt-in last-value recall (never for secret-looking
  field names like password/otp/cvv/token).
- **Tags + search** across name/shortcut/body/tags, in both the options page and
  the popup.
- **Dark mode** everywhere (options, popup, and the in-page modal/toast/
  autocomplete) via `prefers-color-scheme`.
- **Automatic local backups** — a 5-snapshot ring buffer written before
  destructive operations, with one-click restore from the options page.
- **Competitor import** — Text Blaze and Magical exports are auto-detected and
  converted to TypeLess templates (a pure client-side migration funnel).
- **Drag-and-drop reordering**, **copy-all-as-JSON to clipboard**, an
  **insert-variable helper** menu, and a **conflict resolver** on import
  (keep-both / overwrite / skip) with a rejected/truncated summary.

### Added — engineering
- **Schema v2** with stable, deterministic per-template `id`s and an explicit
  `order`, migrated forward idempotently (authoritative single write on
  install/update; migrate-on-read elsewhere).
- **Hardening caps**: max 500 templates, 20 000-char bodies, and a 2 MB import
  size guard checked before parsing.
- **Zero-dependency unit tests** (`node:test`) and **`// @ts-check`** across all
  five JS files (via `jsconfig.json` + ambient types).
- **CI** now runs unit tests, `tsc --noEmit`, and `web-ext lint` alongside the
  existing JSON/locale-parity checks.

### Cut / deferred (decided by review)
- **Unlimited custom keyboard shortcuts** — *cut*: MV3 commands are hard-capped
  and not runtime-registerable; the slash autocomplete covers the need.
- **`{{clipboard}}` variable** and **`storage.sync`** — *deferred*: both would
  introduce a permission or a network path that contradicts the "no network,
  nothing leaves your device" guarantee. Local backups + import/export cover the
  cross-device need.
- **Hierarchical folders**, a **visual field-builder UI**, and a **per-edit undo
  timeline** — *deferred to a later release*; flat tags, inline pipe syntax, and
  snapshot restore deliver most of the value now.

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