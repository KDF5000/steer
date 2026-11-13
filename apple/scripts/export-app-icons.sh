#!/bin/bash
set -euo pipefail

apple_root="$(cd "$(dirname "$0")/.." && pwd)"
icon_master="$apple_root/Brand/steer-app-icon-master.png"

for platform in Phone Watch; do
  icon_set="$apple_root/$platform/Assets.xcassets/AppIcon.appiconset"
  mkdir -p "$icon_set"
  sips -s format png -z 1024 1024 "$icon_master" --out "$icon_set/AppIcon.png" >/dev/null
done
