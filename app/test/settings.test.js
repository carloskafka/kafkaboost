'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore, sanitize, DEFAULTS } = require('../src/settings');

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kb-settings-')), 'settings.json');

test('a missing file gives the defaults', () => {
  assert.deepEqual(createStore(tmpFile()).get(), { ...DEFAULTS });
});

test('a corrupt file gives the defaults instead of crashing', () => {
  const f = tmpFile(); fs.writeFileSync(f, '{not json');
  assert.deepEqual(createStore(f).get(), { ...DEFAULTS });
});

test('set saves valid values and survives a reload', () => {
  const f = tmpFile();
  const a = createStore(f);
  const r = a.set({ theme: 'light', language: 'pt-BR', closeToTray: false, checkIntervalMin: 45 });
  assert.deepEqual(r.rejected, []);
  const b = createStore(f).get();
  assert.equal(b.theme, 'light'); assert.equal(b.language, 'pt-BR'); assert.equal(b.closeToTray, false); assert.equal(b.checkIntervalMin, 45);
});

test('invalid values and unknown keys are rejected, the rest is kept', () => {
  const s = createStore(tmpFile());
  const r = s.set({ theme: 'purple', checkIntervalMin: 2, notifications: 'yes', bogus: 1, startHidden: true });
  assert.deepEqual(r.rejected.sort(), ['bogus', 'checkIntervalMin', 'notifications', 'theme']);
  assert.equal(s.get().theme, 'system'); assert.equal(s.get().checkIntervalMin, 30); assert.equal(s.get().startHidden, true);
});

test('interval must be an integer between 5 and 1440', () => {
  const s = createStore(tmpFile());
  for (const bad of [4, 1441, 7.5, '30', null]) assert.deepEqual(s.set({ checkIntervalMin: bad }).rejected, ['checkIntervalMin']);
  for (const good of [5, 30, 1440]) assert.deepEqual(s.set({ checkIntervalMin: good }).rejected, []);
});

test('sanitize drops unknown keys and bad values from a loaded file', () => {
  const clean = sanitize({ theme: 'dark', hacked: true, language: 'xx', installDir: 'C:\\TS' });
  assert.equal(clean.theme, 'dark'); assert.equal(clean.language, 'auto'); assert.equal(clean.installDir, 'C:\\TS'); assert.ok(!('hacked' in clean));
});

test('onChange fires only when something really changed', () => {
  const s = createStore(tmpFile()); let n = 0; s.onChange(() => { n++; });
  s.set({ theme: 'dark' }); s.set({ theme: 'dark' }); s.set({ theme: 'light' });
  assert.equal(n, 2);
});

test('reset restores the defaults and saves them', () => {
  const f = tmpFile(); const s = createStore(f);
  s.set({ theme: 'light', notifications: false }); s.reset();
  assert.deepEqual(createStore(f).get(), { ...DEFAULTS });
});

test('the file is written atomically (no .tmp left behind)', () => {
  const f = tmpFile(); createStore(f).set({ theme: 'dark' });
  assert.ok(fs.existsSync(f)); assert.ok(!fs.existsSync(f + '.tmp'));
});
