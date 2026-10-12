#!/bin/sh
# Double-click launcher (macOS; also works from a Linux terminal). Needs Node.js; installs Electron on first run.
cd "$(dirname "$0")/app" || exit 1
[ -d node_modules ] || npm install
exec npm start
