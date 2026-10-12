'use strict';
// System tray: status icon next to the clock, a context menu, and toast notifications when the optimization breaks.
const { Tray, Menu, Notification, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const BUILD = path.join(__dirname, '..', 'build');
const LABEL = {
  unknown: 'Checking…',
  ok: 'Your PC is optimized',
  warn: 'Almost there – one thing needs a look',
  fail: 'The optimization is not fully in place'
};

function iconFor(verdict) {
  const file = path.join(BUILD, `tray-${LABEL[verdict] ? verdict : 'unknown'}.png`);
  const fallback = path.join(BUILD, 'icon.png');
  const img = nativeImage.createFromPath(fs.existsSync(file) ? file : fallback);
  return img.resize({ width: 16, height: 16, quality: 'best' });
}

// handlers: { onOpen, onCheck, onQuit, onToggleAutostart }
function createTray(handlers) {
  const tray = new Tray(iconFor('unknown'));
  let verdict = 'unknown';
  let detail = '';
  let autostart = false;

  const rebuild = () => {
    tray.setToolTip(`Legion Tuning – ${LABEL[verdict]}${detail ? '\n' + detail : ''}`);
    tray.setImage(iconFor(verdict));
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: LABEL[verdict], enabled: false },
      { type: 'separator' },
      { label: 'Open Legion Tuning', click: handlers.onOpen },
      { label: 'Check now', click: handlers.onCheck },
      { label: 'Start with Windows', type: 'checkbox', checked: autostart, click: (item) => handlers.onToggleAutostart(item.checked) },
      { type: 'separator' },
      { label: 'Quit', click: handlers.onQuit }
    ]));
  };

  tray.on('click', handlers.onOpen);
  tray.on('double-click', handlers.onOpen);
  rebuild();

  return {
    // Updates the icon/tooltip. Returns true when the state got worse (so the caller can notify).
    setStatus(next, nextDetail) {
      const rank = { unknown: 0, ok: 1, warn: 2, fail: 3 };
      const worse = verdict === 'ok' && (rank[next] || 0) > rank.ok;
      verdict = LABEL[next] ? next : 'unknown'; detail = nextDetail || ''; rebuild();
      return worse;
    },
    setAutostart(on) { autostart = !!on; rebuild(); },
    notify(title, body, onClick) {
      if (!Notification.isSupported()) return;
      const n = new Notification({ title, body, icon: path.join(BUILD, 'icon.png') });
      if (onClick) n.on('click', onClick);
      n.show();
    },
    destroy() { tray.destroy(); },
    get verdict() { return verdict; },
    get exists() { return !tray.isDestroyed(); }
  };
}

module.exports = { createTray, LABEL };
