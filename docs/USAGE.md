# TypeLess — User Guide

Everything you can do with TypeLess. (Türkçe hızlı başlangıç en altta.)

- [Pasting a template](#pasting-a-template)
- [Placeholders](#placeholders)
- [Dynamic variables](#dynamic-variables)
- [Smart fields & the field-builder](#smart-fields--the-field-builder)
- [Rich-text templates](#rich-text-templates)
- [Organising: tags & search](#organising-tags--search)
- [Backups, import & export](#backups-import--export)
- [Importing from Text Blaze / Magical](#importing-from-text-blaze--magical)
- [Settings](#settings)
- [Türkçe hızlı başlangıç](#türkçe-hızlı-başlangıç)

---

## Pasting a template

Focus any text field on any page, then use one of four methods:

| Method | How |
|---|---|
| **Keyboard shortcut** | `Ctrl+Shift+1`, `2`, `3` → your first three templates |
| **Popup menu** | Click the TypeLess toolbar icon (or `Ctrl+Shift+T`), then click a template |
| **Slash command** | Type `/yourshortcut` then a space/Enter/Tab |
| **Slash autocomplete** | Type `/` then a letter — a dropdown of fuzzy matches appears; `↑`/`↓` to move, `Enter`/`Tab` to paste, `Esc` to dismiss |

> Shortcuts may contain letters, numbers, `_` and `-` (e.g. `/client-reply`).

---

## Placeholders

Put `{{name}}` anywhere in a template body. When you paste, a small form asks
for each one:

```
Hi {{customer_name}},

Your ticket {{ticket_no}} has been resolved.
```

Pasting prompts for `customer_name` and `ticket_no`, then fills them in.

---

## Dynamic variables

These resolve automatically at paste time — locally, with no permissions:

| Variable | Result |
|---|---|
| `{{date}}` | Today, `YYYY-MM-DD` |
| `{{date+3d}}` / `{{date-2w}}` | Offset by **d**ays, **w**eeks, **m**onths, **y**ears |
| `{{time}}` | `HH:MM` |
| `{{datetime}}` | `YYYY-MM-DD HH:MM` |
| `{{cursor}}` | Where the caret lands after pasting |

Example: `Follow up by {{date+3d}}. {{cursor}}`

---

## Smart fields & the field-builder

A placeholder can be more than a text box. Full pipe syntax:

```
{{name|Label|type|default|opt1,opt2,opt3|remember}}
```

- **type** — `text` (default), `multiline`, `dropdown`, `date`
- **default** — pre-filled value
- **options** — comma-separated (for `dropdown`)
- **remember** — pre-fills with the last value you used (ignored for secret-ish
  names like `password`, `otp`, `cvv`, `token`)

Example: `{{priority|Priority|dropdown|Normal|Low,Normal,High}}`

**You don't have to memorise this.** In the options page, open a template's
**Fields** panel: it lists every `{{placeholder}}` and lets you set its label,
type, default, options and remember toggle with form controls — writing the
syntax back into the body for you. Use **+ Add field** to insert a new one, or
the **Insert variable ▾** menu to drop a dynamic variable at the cursor.

---

## Rich-text templates

By default a template is plain text. Switch a template to **Rich text** (toggle
above the body) to format it:

- Toolbar: **Bold**, *Italic*, Underline, Link, Bulleted list.
- Pastes **formatted** into rich editors (Gmail, CKEditor, Quill, ProseMirror,
  TinyMCE).
- **Degrades to clean plain text** automatically in `<input>`/`<textarea>`.

For safety, rich content is always passed through a strict sanitizer: only basic
formatting tags survive, scripts/styles/handlers are removed, and unsafe link
schemes (`javascript:` etc.) are stripped. This is also why typing raw `<b>`
tags into a **plain** template shows them literally — that's the safety
guarantee, not a bug. Use Rich mode + the toolbar to format.

---

## Organising: tags & search

- Add comma-separated **tags** to any template.
- The **search** box (options page and popup) filters by name, shortcut, body
  and tags.
- Reorder by dragging the **⠿** handle, or with the up/down buttons. The first
  three templates get the `Ctrl+Shift+1/2/3` hotkeys.

---

## Backups, import & export

- **Automatic local backups:** a rolling set of the last 5 snapshots is saved
  before any destructive action. Open **⟲ Backups** to restore one.
- **Export:** download all / selected / a single template as JSON, or **Copy
  JSON** to the clipboard.
- **Import:** choose a JSON file. Merge (with a conflict resolver:
  keep-both / overwrite / skip) or replace. A backup is taken first.

Nothing is uploaded anywhere — sharing a template means handing someone the JSON.

---

## Importing from Text Blaze / Magical

Export your snippets from Text Blaze or Magical as JSON, then use **Import** —
TypeLess auto-detects the format and converts them into templates (vendor
placeholder tokens become `{{placeholders}}` where possible). Everything is
sanitized and validated on the way in.

---

## Settings

- **Language:** Auto / English / Türkçe (top-right of the options page).
- **Dark mode:** follows your operating system theme automatically.
- **Keyboard shortcuts:** the popup and the three paste hotkeys are configured
  in your browser's extension-shortcuts page (`about:addons` →  Manage Extension
  Shortcuts in Firefox; `chrome://extensions/shortcuts` in Chrome).

---

## Türkçe hızlı başlangıç

1. Bir metin alanına tıkla.
2. `/kısayol` yaz + boşluk, ya da `/` yazıp listeden seç, ya da `Ctrl+Shift+1`.
3. Gövdeye `{{ad}}` koyarsan yapıştırırken form açılır.
4. Dinamik: `{{date}}`, `{{date+3d}}`, `{{time}}`, `{{cursor}}`.
5. **Zengin metin** için şablonu Zengin moda al, araç çubuğunu kullan.
6. **Alanlar** panelinden yer tutucuları görsel olarak ayarla.
7. **⟲ Yedekler** ile geri yükle; **İçe aktar** ile Text Blaze/Magical'dan getir.

Hiçbir veri tarayıcı dışına çıkmaz.
