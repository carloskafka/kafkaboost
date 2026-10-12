'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { linuxDesktopEntry, linuxAutostartPath, LINUX_FILE } = require('../src/autostart');

test('the Linux autostart entry starts the app hidden in the tray', () => {
  const e = linuxDesktopEntry('/opt/kafkaboost/kafkaboost', ['--hidden']);
  assert.match(e, /^\[Desktop Entry\]/);
  assert.match(e, /Exec=\/opt\/kafkaboost\/kafkaboost --hidden\n/);
  assert.match(e, /Type=Application/); assert.match(e, /Terminal=false/);
});

test('paths with spaces are quoted in Exec', () => {
  const e = linuxDesktopEntry('/home/me/My Apps/kb', ['/home/me/app dir']);
  assert.match(e, /Exec="\/home\/me\/My Apps\/kb" "\/home\/me\/app dir"/);
});

test('the entry goes to the XDG autostart folder', () => {
  const old = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(path.sep, 'cfg');
  try { assert.equal(linuxAutostartPath(), path.join(path.sep, 'cfg', 'autostart', LINUX_FILE)); }
  finally { if (old === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = old; }
});
