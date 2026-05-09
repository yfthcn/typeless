#!/usr/bin/env python3
"""
TypeLess build helper.
Creates two zip packages:
  - typeless-chrome.zip  (Chrome / Edge / Brave — uses service_worker)
  - typeless-firefox.zip (Firefox 140+ — uses background.scripts)

Run from the project root:
  python3 build.py
"""
import fnmatch
import json
import os
import shutil
import sys
import zipfile
from pathlib import Path

# Force UTF-8 stdout on Windows so the ✓ status glyph below doesn't crash
# on terminals using cp1252 (Python 3.14 default behavior).
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).parent.resolve()
DIST = ROOT / "dist"

# Hardcoded directory/file exclusions
EXCLUDES = {
    ".git", ".gitignore", "dist", "build.py",
    "node_modules", ".DS_Store", "Thumbs.db",
    "typeless.zip", "typeless.xpi",
}

# Glob patterns for excluded files (e.g. internal dev/audit notes).
# INCLUDE_ALWAYS below takes precedence over these patterns.
EXCLUDE_PATTERNS = [
    "*-bug-*.md",
    "*-fix-*.md",
    "STEP*_*.md",
    "ANALYSIS_*.md",
]

# Files always included even if matching an exclude pattern (whitelist).
INCLUDE_ALWAYS = {"README.md", "CHANGELOG.md", "CONTRIBUTING.md", "LICENSE"}

def load_manifest():
    with open(ROOT / "manifest.json", encoding="utf-8") as f:
        return json.load(f)

def write_manifest(path, manifest):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

def files_to_include():
    """Yield relative paths of files to include in the package."""
    for root, dirs, files in os.walk(ROOT):
        # Prune excluded directories early
        dirs[:] = [d for d in dirs if d not in EXCLUDES and not d.startswith('.')]
        for fname in files:
            if fname in EXCLUDES or fname.startswith('.'):
                continue
            # Apply glob exclusions (with whitelist override)
            if fname not in INCLUDE_ALWAYS and any(
                fnmatch.fnmatch(fname, pat) for pat in EXCLUDE_PATTERNS
            ):
                continue
            full = Path(root) / fname
            rel = full.relative_to(ROOT)
            # Skip the manifest — we'll inject the browser-specific one
            if str(rel) == "manifest.json":
                continue
            yield rel

def build_package(kind, transform_manifest):
    DIST.mkdir(exist_ok=True)
    zip_path = DIST / f"typeless-{kind}.zip"

    manifest = load_manifest()
    manifest = transform_manifest(manifest)

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        # Write customized manifest first (at root)
        z.writestr("manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False))
        # Then all other files
        for rel in files_to_include():
            z.write(ROOT / rel, str(rel))

    print(f"  ✓ {zip_path.relative_to(ROOT)}  ({zip_path.stat().st_size // 1024} KB)")
    return zip_path

def chrome_manifest(m):
    """Chrome/Edge: MV3 standard. Uses service_worker.
    Removes Firefox-specific fields to avoid 'unrecognized key' warnings."""
    m.pop("browser_specific_settings", None)
    m["background"] = {"service_worker": "background.js"}
    return m

def firefox_manifest(m):
    """Firefox 140+: Uses background.scripts with explicit common.js load.
    Drops Chrome-only service_worker to avoid AMO warning.
    strict_min_version is the source manifest's source of truth (140.0)."""
    m["background"] = {"scripts": ["common.js", "background.js"]}
    # Ensure browser_specific_settings exists and is Firefox 140+ compatible
    bss = m.setdefault("browser_specific_settings", {})
    gecko = bss.setdefault("gecko", {})
    gecko["id"] = "typeless@kaktusdev.net"
    gecko["data_collection_permissions"] = {"required": ["none"]}
    # Also set Android minimum (Firefox for Android 142+ supports data_collection_permissions)
    gecko_android = bss.setdefault("gecko_android", {})
    gecko_android["strict_min_version"] = "142.0"
    return m

def main():
    if DIST.exists():
        shutil.rmtree(DIST)
    print("Building TypeLess packages...\n")
    build_package("chrome", chrome_manifest)
    build_package("firefox", firefox_manifest)
    print(f"\nDone. Output in {DIST.relative_to(ROOT)}/")

if __name__ == "__main__":
    main()
