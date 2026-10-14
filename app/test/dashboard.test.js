'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const L = require('../renderer/js/dashlogic');
const demo = require('../src/demo');
const { loadDictionaries } = require('../src/i18n');

const configDir = path.join(__dirname, '..', '..', 'config');
const dicts = loadDictionaries(path.join(__dirname, '..', 'renderer', 'i18n'));
const tw = (id, status, extra) => ({ id, risk: 'safe', recommended: true, status, ...extra });

test('level: counts only safe + recommended + available tweaks that are really active', () => {
  const list = [tw('a', 'active'), tw('b', 'inactive'), tw('c', 'partial'), tw('d', 'unavailable'),
    { id: 'e', risk: 'advanced', recommended: true, status: 'active' }, { id: 'f', risk: 'safe', recommended: false, status: 'active' }];
  const l = L.optimizationLevel(list, { applicable: false });
  assert.equal(l.active, 1); assert.equal(l.total, 3); assert.equal(l.outOf, 3); assert.equal(l.percent, 33);
  assert.deepEqual(l.todo, ['b']);
});

test('level: the CPU tuning is one more item, in place only when installed and the verdict is ok', () => {
  const list = [tw('a', 'active'), tw('b', 'active')];
  assert.equal(L.optimizationLevel(list, { applicable: true, installed: true, verdict: 'ok' }).percent, 100);
  assert.equal(L.optimizationLevel(list, { applicable: true, installed: true, verdict: 'warn' }).percent, 67);
  assert.equal(L.optimizationLevel(list, { applicable: true, installed: false, verdict: 'ok' }).percent, 67);
  assert.equal(L.optimizationLevel(list, { applicable: true, installed: true, verdict: 'fail' }).cpuOk, false);
  assert.equal(L.optimizationLevel(list, { applicable: false, installed: true, verdict: 'ok' }).percent, 100, 'not applicable: not counted at all');
});

test('level: nothing to count gives null, never 0 or 100', () => {
  assert.equal(L.optimizationLevel([], { applicable: false }).percent, null);
  assert.equal(L.optimizationLevel(null, null).percent, null);
  assert.equal(L.optimizationLevel([tw('a', 'unavailable')], {}).percent, null);
});

test('level on the demo catalog is consistent with its own formula', () => {
  const r = demo.demoStep('tweaks-list', {}, configDir).res.data.tweaks;
  const l = L.optimizationLevel(r, { applicable: true, installed: true, verdict: 'ok' });
  assert.equal(l.percent, Math.round((100 * l.done) / l.outOf));
  assert.ok(l.total >= 5 && l.todo.length === l.total - l.active);
  demo.demoStep('tweaks-recommended', {}, configDir);
  const after = L.optimizationLevel(demo.demoStep('tweaks-list', {}, configDir).res.data.tweaks, { applicable: true, installed: true, verdict: 'ok' });
  assert.equal(after.percent, 100); assert.deepEqual(after.todo, []);
});

test('tiles notice: which message to show (administrator vs sharing vs failure)', () => {
  assert.equal(L.tilesNotice(null, false).state, 'pending'); assert.equal(L.tilesNotice(null, false).key, null);
  const base = { restart: false, start: false, iniOption: false, startEnabled: false };
  assert.deepEqual(L.tilesNotice({ available: true }, false), { ...base, state: 'live', key: null });
  assert.deepEqual(L.tilesNotice({ available: false }, false), { ...base, state: 'needsAdmin', key: 'dashboard.tiles.needsAdmin', restart: true });
  assert.deepEqual(L.tilesNotice({ available: false }, true), { ...base, state: 'noSharing', key: 'dashboard.tiles.noSharing' }, 'HWiNFO state not known yet');
  assert.deepEqual(L.tilesNotice({ failed: true }, true), { ...base, state: 'error', key: 'dashboard.tiles.error' });
});

test('tiles notice: what is wrong with HWiNFO, in words, and when Start is offered', () => {
  const none = { available: false };
  const hw = (o) => ({ installed: true, running: false, sharedMemory: false, ini: 'ok', ...o });
  // not elevated: always the administrator notice, whatever HWiNFO looks like (a start would need administrator rights)
  assert.equal(L.tilesNotice(none, false, hw()).state, 'needsAdmin');
  assert.ok(!L.tilesNotice(none, false, hw()).start);
  // not installed: points to the HWiNFO card (download flow), no start button
  let n = L.tilesNotice(none, true, { installed: false, running: false });
  assert.deepEqual([n.state, n.key, n.start], ['hwMissing', 'dashboard.tiles.hwMissing', false]);
  // installed, not running, INI fine: one-click start, no consent box
  n = L.tilesNotice(none, true, hw());
  assert.deepEqual([n.state, n.key, n.start, n.iniOption, n.startEnabled], ['hwStopped', 'dashboard.tiles.hwStopped', true, false, true]);
  assert.equal(L.tilesNotice(none, true, hw(), { busy: true }).startEnabled, false, 'busy');
  // installed, not running, INI without SensorsSM: explicit consent box, Start disabled until it is ticked
  n = L.tilesNotice(none, true, hw({ ini: 'noSharedMemory' }));
  assert.deepEqual([n.state, n.key, n.start, n.iniOption, n.startEnabled], ['hwStopped', 'dashboard.tiles.hwStoppedIni', true, true, false]);
  assert.equal(L.tilesNotice(none, true, hw({ ini: 'noSharedMemory' }), { iniConsent: true }).startEnabled, true);
  assert.equal(L.tilesNotice(none, true, hw({ ini: 'noSharedMemory' }), { iniConsent: true, busy: true }).startEnabled, false);
  // running but not sharing: explanation only, nothing to start
  n = L.tilesNotice(none, true, hw({ running: true }));
  assert.deepEqual([n.state, n.key, n.start], ['hwNoSm', 'dashboard.tiles.hwNoSm', false]);
  // running and sharing but the tiles are still empty (just started): the generic text
  assert.equal(L.tilesNotice(none, true, hw({ running: true, sharedMemory: true })).state, 'noSharing');
  // readings win over everything
  assert.equal(L.tilesNotice({ available: true }, true, hw()).state, 'live');
});

test('tiles: missing values stay a dash, the time is the one from the script, sizes are decimal', () => {
  assert.equal(L.formatTile('temp', null), '–');
  assert.equal(L.formatTile('temp', { packageTempC: 68 }), '68 °C');
  assert.equal(L.formatTile('clock', { pClockMaxMHz: 4689 }), '4.69 GHz');
  assert.equal(L.formatTile('power', { packagePowerW: null }), '–');
  assert.equal(L.formatTile('power', { packagePowerW: 0 }), '0 W', 'a real zero is shown');
  assert.equal(L.clockTime('2026-10-12T22:41:03'), '22:41:03'); assert.equal(L.clockTime('nope'), '');
  assert.equal(L.formatSize(1024), '1 TB'); assert.equal(L.formatSize(512), '512 GB'); assert.equal(L.formatSize(0), '');
});

test('demo telemetry: live values wobble, "unavailable" returns no values at all', () => {
  demo.state.telemetry = 'live';
  const a = demo.demoStep('telemetry').res.data;
  assert.ok(a.available && a.live.packageTempC > 0 && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/.test(a.takenAt));
  demo.state.telemetry = 'unavailable';
  const b = demo.demoStep('telemetry').res;
  assert.ok(b.ok && b.data.available === false && b.data.live === null);
  demo.state.telemetry = 'live';
});

test('i18n: every key the Dashboard uses exists in en and pt-BR', () => {
  const keys = ['dashboard.tiles.needsAdmin', 'dashboard.tiles.noSharing', 'dashboard.tiles.error', 'dashboard.tiles.when', 'dashboard.level.title', 'dashboard.level.loading',
    'dashboard.level.none', 'dashboard.level.line', 'dashboard.level.cpuOk', 'dashboard.level.cpuNo', 'dashboard.level.cpuNa', 'dashboard.level.formula', 'dashboard.level.note',
    'dashboard.hw.cpu', 'dashboard.hw.gpu', 'dashboard.hw.ram', 'dashboard.hw.disks', 'dashboard.hw.os', 'dashboard.hw.cores', 'dashboard.hw.ramSpeed',
    'dashboard.hw.disk.nvme', 'dashboard.hw.disk.ssd', 'dashboard.hw.disk.hdd', 'dashboard.hw.disk.unknown', 'msg.telemetry.ok', 'msg.telemetry.unavailable'];
  for (const lang of ['en', 'pt-BR']) for (const k of keys) assert.ok(dicts[lang][k], `${lang} ${k}`);
  assert.ok(dicts.en['dashboard.tiles.needsAdmin'].includes('as administrator'));
});

test('the telemetry step is wired: Steps.ps1 (read-only) and no serial number field anywhere in the hardware info', () => {
  const ps = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'Steps.ps1'), 'utf8');
  assert.ok(/'telemetry'[^)]*\)\]\[string\]\$Step/.test(ps) && /\$readOnly = [^\n]*'telemetry'/.test(ps));
  const hw = JSON.stringify(demo.demoStep('detect', {}, configDir).res.data);
  assert.ok(!/serial/i.test(hw));
  const tun = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'lib', 'Tuning.ps1'), 'utf8');
  assert.ok(!/Serial/i.test(tun.slice(tun.indexOf('function Get-DiskSummary'), tun.indexOf('function Find-ThrottleStopZip'))));
});
