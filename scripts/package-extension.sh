#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v sips >/dev/null 2>&1; then
  echo "Error: 'sips' is required (available on macOS)." >&2
  exit 1
fi

if ! command -v zip >/dev/null 2>&1; then
  echo "Error: 'zip' command is required." >&2
  exit 1
fi

if [[ ! -f "manifest.json" ]]; then
  echo "Error: manifest.json not found in project root." >&2
  exit 1
fi

python3 - <<'PY'
import json
import sys
from pathlib import Path

manifest_path = Path("manifest.json")
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

expected_icons = {
    "16": "icon-16x16.png",
    "48": "icon-48x48.png",
    "128": "icon-128x128.png",
}

errors = []
icons = manifest.get("icons", {})
for key, expected in expected_icons.items():
    if icons.get(key) != expected:
        errors.append(f"icons.{key} should be '{expected}'")

action_default_icon = manifest.get("action", {}).get("default_icon")
if action_default_icon != "icon-48x48.png":
    errors.append("action.default_icon should be 'icon-48x48.png'")

if errors:
    print("Error: manifest icon configuration is invalid:", file=sys.stderr)
    for error in errors:
        print(f"- {error}", file=sys.stderr)
    sys.exit(1)
PY

resize_if_needed() {
  local icon_path="$1"
  local expected_size="$2"
  local width
  local height

  width="$(sips -g pixelWidth "$icon_path" | awk '/pixelWidth/{print $2}')"
  height="$(sips -g pixelHeight "$icon_path" | awk '/pixelHeight/{print $2}')"

  if [[ "$width" != "$expected_size" || "$height" != "$expected_size" ]]; then
    echo "Resizing $icon_path from ${width}x${height} to ${expected_size}x${expected_size}"
    sips -z "$expected_size" "$expected_size" "$icon_path" >/dev/null
  fi
}

for size in 16 48 128; do
  icon_file="icon-${size}x${size}.png"
  if [[ ! -f "$icon_file" ]]; then
    echo "Error: required icon not found: $icon_file" >&2
    exit 1
  fi
  resize_if_needed "$icon_file" "$size"
done

VERSION="$(python3 - <<'PY'
import json
from pathlib import Path

manifest = json.loads(Path("manifest.json").read_text(encoding="utf-8"))
version = str(manifest.get("version", "")).strip()
if not version:
    raise SystemExit("Error: manifest version is missing")
print(version)
PY
)"

DIST_DIR="dist"
STAGING_DIR="$DIST_DIR/.package-staging"
ZIP_NAME="apex-class-coverage-viewer-v${VERSION}.zip"
ZIP_PATH="$DIST_DIR/$ZIP_NAME"

FILES_TO_PACKAGE=(
  "manifest.json"
  "popup.html"
  "popup.js"
  "styles.css"
  "icon-16x16.png"
  "icon-48x48.png"
  "icon-128x128.png"
)

mkdir -p "$DIST_DIR"
rm -rf "$STAGING_DIR"
rm -f "$ZIP_PATH"
mkdir -p "$STAGING_DIR"

for file in "${FILES_TO_PACKAGE[@]}"; do
  if [[ ! -f "$file" ]]; then
    echo "Error: required file missing: $file" >&2
    exit 1
  fi
  cp "$file" "$STAGING_DIR/"
done

(
  cd "$STAGING_DIR"
  zip -q -r "../$ZIP_NAME" .
)

rm -rf "$STAGING_DIR"
echo "Created package: $ZIP_PATH"
