# Marketing assets

Drop the product-page and store screenshots here. The page (`docs/index.html`)
and the store listings reference these filenames.

| File | What to show | Spec |
|---|---|---|
| `hero.gif` | One smooth end-to-end demo (type `/`, pick a template, fill a placeholder, pasted) | < 3 MB, looping, ~1280×720 |
| `shot-autocomplete.png` | The `/` slash autocomplete dropdown | 1280×800 |
| `shot-placeholder.png` | The placeholder fill-in form | 1280×800 |
| `shot-options.png` | Options page: template list + drag reorder | 1280×800 |
| `shot-import.png` | Import-from-Text-Blaze dialog | 1280×800 |
| `shot-richtext.png` | A rich-text template pasting bold/link into CKEditor or Gmail | 1280×800 |
| `shot-fieldbuilder.png` | The visual field-builder panel | 1280×800 |

Provide **light and dark** variants where it makes sense (suffix `-dark`).

## Free tools to capture / frame
- **Record:** ScreenToGif (Windows) · Peek / Kooha (Linux) · macOS `⌘⇧5`
- **Hero MP4 → GIF:** OBS Studio + GIMP / Photopea
- **Browser-window frame:** screely.com · shots.so · Pixelied (free tier)
- **Record on (honest, no trademark issues):** the official CKEditor / Quill /
  ProseMirror / TinyMCE online demo editors, a GitHub issue textarea, a free
  Gmail account, a free ServiceNow Developer Instance.

---

## Shot scenarios (exact recipes)

Before each shot: set the browser zoom to ~110–125% for crisp text, hide
bookmarks/other extensions, and prepare 3–4 realistic templates (e.g. "Password
reset", "Ticket resolved", "Meeting follow-up") so lists look real, not empty.
Capture each shot in **light and dark** OS themes where noted.

### `hero.gif` — the 8-second money shot
1. Open the CKEditor demo (`https://ckeditor.com/ckeditor-5/demo/`) or a Gmail compose window.
2. Click into the editor. Type `/` then `re` — the **autocomplete dropdown** appears.
3. Press `Enter` to choose "Ticket resolved" (a template with `{{customer_name}}` and `{{date}}`).
4. The placeholder form pops up — type a name, then click **Paste**.
5. Show the formatted text landing with the date filled in and the caret at `{{cursor}}`.
- Keep it one continuous take, < 3 MB, looping. Trim dead frames.

### `shot-autocomplete.png`
- In a textarea, type `/r`. Capture the dropdown showing 3–4 fuzzy matches with
  the first item highlighted. Frame just the field + dropdown.

### `shot-placeholder.png`
- Trigger a template with 2–3 mixed fields (a text input, a **dropdown**, a date).
  Capture the fill-in modal with the dropdown open to show field types.

### `shot-options.png`
- Open the options page with 4–5 templates. Hover the **⠿** handle on one card
  (cursor = grab) mid-drag, with the drop-target card showing the dashed outline.
  Show the search box and tags. **Dark variant recommended.**

### `shot-import.png`
- Click **Import**, choose a Text Blaze export JSON. Capture the import dialog
  showing "Text Blaze format detected" + the merge/replace + conflict options.

### `shot-richtext.png`
- A template in **Rich** mode: show the toolbar (B / I / U / link / list) above
  the editor with some bold text + a link, OR the result pasted into the
  CKEditor/Gmail editor as real formatting. The "before (editor) → after (Gmail)"
  split is great if you can fit it.

### `shot-fieldbuilder.png`
- Open a template's **Fields** panel. Capture the rows: a token name, label input,
  type select (open, showing text/multiline/dropdown/date), default, and the
  remember checkbox (show one **disabled** on a `password` field for the privacy story).

> Filenames must match the table above so the product page and store listings pick
> them up. Optimise PNGs (TinyPNG/Squoosh) before committing.
