#!/usr/bin/env bash
# Regenerate the PWA PNG icons from the committed SVG sources (FEAT-0028).
# Requires rsvg-convert (librsvg). One-off dev tool; not part of the build.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="$here/../public/icons"
mkdir -p "$out"

rsvg-convert -w 192 -h 192 "$here/icon.svg"          -o "$out/icon-192.png"
rsvg-convert -w 512 -h 512 "$here/icon.svg"          -o "$out/icon-512.png"
rsvg-convert -w 512 -h 512 "$here/icon-maskable.svg" -o "$out/icon-maskable-512.png"
rsvg-convert -w 180 -h 180 "$here/icon.svg"          -o "$out/apple-touch-icon.png"

echo "Generated icons in $out"
