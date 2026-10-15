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

test('startHwinfoWithApp: off by default, boolean only, survives a reload, sanitize drops junk', () => {
  assert.equal(DEFAULTS.startHwinfoWithApp, false);
  const f = tmpFile(); const s = createStore(f);
  for (const bad of ['yes', 1, null, undefined, {}]) assert.deepEqual(s.set({ startHwinfoWithApp: bad }).rejected, ['startHwinfoWithApp']);
  assert.equal(s.get().startHwinfoWithApp, false);
  assert.deepEqual(s.set({ startHwinfoWithApp: true }).rejected, []);
  assert.equal(createStore(f).get().startHwinfoWithApp, true);
  assert.equal(sanitize({ startHwinfoWithApp: 'true' }).startHwinfoWithApp, false);
});

test('autoRecord: off by default, boolean only, survives a reload, sanitize drops junk', () => {
  assert.equal(DEFAULTS.autoRecord, false);
  const f = tmpFile(); const s = createStore(f);
  for (const bad of ['yes', 1, null, undefined, {}]) assert.deepEqual(s.set({ autoRecord: bad }).rejected, ['autoRecord']);
  assert.equal(s.get().autoRecord, false);
  assert.deepEqual(s.set({ autoRecord: true }).rejected, []);
  assert.equal(createStore(f).get().autoRecord, true);
  assert.equal(sanitize({ autoRecord: 'true' }).autoRecord, false);
});

test('M2-01 autoClean defaults: off, threshold 50, cooldown 10', () => {
  const s = createStore(tmpFile()).get();
  assert.equal(s.autoClean, false); assert.equal(s.autoCleanThresholdPct, 50); assert.equal(s.autoCleanCooldownMin, 10);
});

test('M2-02 autoClean is boolean only', () => {
  const s = createStore(tmpFile());
  for (const bad of ['yes', 1, null, undefined, {}]) assert.deepEqual(s.set({ autoClean: bad }).rejected, ['autoClean']);
  assert.equal(s.get().autoClean, false);
});

test('M2-03 threshold 20..90 and cooldown 5..60 are rejected outside the bounds, not clamped', () => {
  const s = createStore(tmpFile());
  for (const bad of [19, 91, 50.5, '50']) assert.deepEqual(s.set({ autoCleanThresholdPct: bad }).rejected, ['autoCleanThresholdPct']);
  for (const bad of [4, 61, 10.5, '10']) assert.deepEqual(s.set({ autoCleanCooldownMin: bad }).rejected, ['autoCleanCooldownMin']);
  assert.equal(s.get().autoCleanThresholdPct, 50); assert.equal(s.get().autoCleanCooldownMin, 10);
  for (const good of [20, 90]) assert.deepEqual(s.set({ autoCleanThresholdPct: good }).rejected, []);
  for (const good of [5, 60]) assert.deepEqual(s.set({ autoCleanCooldownMin: good }).rejected, []);
});

test('M2-04 valid auto clean values survive a reload and sanitize drops junk', () => {
  const f = tmpFile();
  createStore(f).set({ autoClean: true, autoCleanThresholdPct: 70, autoCleanCooldownMin: 30 });
  const b = createStore(f).get();
  assert.equal(b.autoClean, true); assert.equal(b.autoCleanThresholdPct, 70); assert.equal(b.autoCleanCooldownMin, 30);
  const clean = sanitize({ autoClean: 'true', autoCleanThresholdPct: 5, autoCleanCooldownMin: 99 });
  assert.equal(clean.autoClean, false); assert.equal(clean.autoCleanThresholdPct, 50); assert.equal(clean.autoCleanCooldownMin, 10);
});
