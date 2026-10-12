'use strict';
// "Start with the OS". Windows uses a scheduled task (elevated, handled through Steps.ps1 in main.js);
// macOS uses the login-item API; Linux writes an XDG autostart entry. This file holds the pure parts.
const path = require('path');
const os = require('os');

const LINUX_FILE = 'kafkaboost.desktop';

function linuxAutostartPath() {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'autostart', LINUX_FILE);
}

// XDG desktop entry that starts the app hidden in the tray.
function linuxDesktopEntry(execPath, args = ['--hidden']) {
  const quote = (s) => (/[\s"]/.test(s) ? `"${s.replace(/(["\\$`])/g, '\\$1')}"` : s);
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=KafkaBoost',
    'Comment=Keeps the PC optimized and watches it from the tray',
    `Exec=${[quote(execPath), ...args.map(quote)].join(' ')}`,
    'X-GNOME-Autostart-enabled=true',
    'Terminal=false',
    ''
  ].join('\n');
}

module.exports = { linuxAutostartPath, linuxDesktopEntry, LINUX_FILE };
