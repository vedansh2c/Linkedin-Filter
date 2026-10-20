#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p dist
version="$(node -p "require('./manifest.json').version")"
rm -f "dist/linkedin-word-filter-$version.zip"
zip -q "dist/linkedin-word-filter-$version.zip" \
  manifest.json filter-core.js content.js content.css popup.html popup.css popup.js icons/icon.svg
printf '%s\n' "Created dist/linkedin-word-filter-$version.zip"
