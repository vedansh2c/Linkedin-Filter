#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p dist
rm -f dist/linkedin-word-filter-1.0.0.zip
zip -q dist/linkedin-word-filter-1.0.0.zip \
  manifest.json filter-core.js content.js content.css popup.html popup.css popup.js icons/icon.svg
printf '%s\n' "Created dist/linkedin-word-filter-1.0.0.zip"
