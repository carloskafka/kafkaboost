#!/bin/sh
# Creates a clickable launcher with the app icon on Linux (.desktop in the repo root and the applications menu).
# macOS: double-click KafkaBoost.command (a .command file cannot carry a custom icon without a signed .app bundle).
repo="$(cd "$(dirname "$0")/.." && pwd)"
chmod +x "$repo/KafkaBoost.command"
entry="[Desktop Entry]
Type=Application
Name=KafkaBoost
Comment=Optimize and monitor your PC
Exec=sh \"$repo/KafkaBoost.command\"
Icon=$repo/app/build/icon.png
Terminal=false
Categories=Utility;System;"
printf '%s\n' "$entry" > "$repo/KafkaBoost.desktop"
chmod +x "$repo/KafkaBoost.desktop"
mkdir -p "$HOME/.local/share/applications" && cp "$repo/KafkaBoost.desktop" "$HOME/.local/share/applications/kafkaboost.desktop"
echo "created $repo/KafkaBoost.desktop"
