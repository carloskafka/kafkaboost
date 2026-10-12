'use strict';
// System tray: status icon next to the clock, a context menu, and toast notifications when the optimization breaks.
const { Tray, Menu, Notification, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const BUILD = path.join(__dirname, '..', 'build');
const VERDICTS = ['unknown', 'ok', 'warn', 'fail'];

function iconFor(verdict) {
  const file = path.join(BUILD, `tray-${VERDICTS.includes(verdict) ? verdict : 'unknown'}.png`);
  const fallback = path.join(BUILD, 'icon.png');
  const img = nativeImage.createFromPath(fs.existsSync(file) ? file : fallback);
  return img.resize({ width: 16, height: 16, quality: 'best' });
}

// opts: { t(key, vars), onOpen, onCheck, onQuit, onToggleAutostart }
function createTray(opts) {
  const { t } = opts;
  const tray = new Tray(iconFor('unknown'));
  let verdict = 'unknown';
  let detail = '';
  let autostart = false;

  const rebuild = () => {
    const label = t(`tray.verdict.${verdict}`);
    tray.setToolTip(`KafkaBoost – ${label}${detail ? '\n' + detail : ''}`);
    tray.setImage(iconFor(verdict));
    tray.setContextMenu(Menu.buildFromTemplate([
      { label, enabled: false },
      { type: 'separator' },
      { label: t('tray.open'), click: opts.onOpen },
      { label: t('tray.check'), click: opts.onCheck },
      { label: t('tray.autostart'), type: 'checkbox', checked: autostart, click: (item) => opts.onToggleAutostart(item.checked) },
      { type: 'separator' },
      { label: t('tray.quit'), click: opts.onQuit }
    ]));
  };

  tray.on('click', opts.onOpen);
  tray.on('double-click', opts.onOpen);
  rebuild();

  return {
    // Updates the icon/tooltip. Returns true when the state got worse (so the caller can notify).
    setStatus(next, nextDetail) {
      const rank = { unknown: 0, ok: 1, warn: 2, fail: 3 };
      const worse = verdict === 'ok' && (rank[next] || 0) > rank.ok;
      verdict = VERDICTS.includes(next) ? next : 'unknown'; detail = nextDetail || ''; rebuild();
      return worse;
    },
    setAutostart(on) { autostart = !!on; rebuild(); },
    refreshLanguage: rebuild,
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

module.exports = { createTray };
