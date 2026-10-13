'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const L = require('../renderer/js/sensorlogic');
const { loadDictionaries } = require('../src/i18n');

const dicts = loadDictionaries(path.join(__dirname, '..', 'renderer', 'i18n'));

test('temperature thresholds are generic: warm from 80, hot from 90', () => {
  assert.equal(L.TEMP_WARM, 80); assert.equal(L.TEMP_HOT, 90);
  assert.equal(L.tempLevel(79.9), 'ok'); assert.equal(L.tempLevel(80), 'warm');
  assert.equal(L.tempLevel(89.9), 'warm'); assert.equal(L.tempLevel(90), 'hot');
  assert.equal(L.tempLevel(null), 'ok'); assert.equal(L.tempLevel(NaN), 'ok');
});

test('values are formatted with their unit and a missing value is a dash', () => {
  assert.equal(L.formatValue(61.26, 'C', 'en'), '61.3 °C');
  assert.equal(L.formatValue(4689, 'MHz', 'en'), '4,689 MHz');
  assert.equal(L.formatValue(4689, 'MHz', 'pt-BR'), '4.689 MHz');
  assert.equal(L.formatValue(31.5, 'W', 'en'), '31.5 W');
  assert.equal(L.formatValue(1.05, 'V', 'en'), '1.05 V');
  assert.equal(L.formatValue(29849600, 'Bps', 'en'), '28.5 MB/s');
  assert.equal(L.formatValue(2048, 'Bps', 'en'), '2 KB/s');
  assert.equal(L.formatValue(null, 'C'), '-');
  assert.equal(L.formatValue(Infinity, 'C'), '-');
});

const good = () => ({
  source: 'LibreHardwareMonitor 0.9.6', takenAt: '2026-10-12T10:00:00', admin: true, cpuTemperature: true, extra: 'x',
  groups: [
    { id: 'cpu', hardware: [{ name: 'CPU', type: 'Cpu', sensors: [{ name: 'Package', type: 'Temperature', value: 60, min: 40, max: 70, unit: 'C', key: 'inject' }, { name: 'bad', type: 'Load', value: 'NaN', unit: 'pct' }] }] },
    { id: 'evil', hardware: [{ name: 'x', sensors: [{ name: 'a', type: 'Load', value: 1 }] }] },
    { id: 'gpu', hardware: [{ name: 'empty', type: 'Gpu', sensors: [] }] }
  ]
});

test('sanitizeSnapshot keeps known fields only and drops unknown groups, non-numeric and empty entries', () => {
  const s = L.sanitizeSnapshot(good());
  assert.deepEqual(s.groups.map((g) => g.id), ['cpu']);
  assert.equal(s.groups[0].hardware[0].sensors.length, 1);
  assert.deepEqual(Object.keys(s.groups[0].hardware[0].sensors[0]).sort(), ['max', 'min', 'name', 'type', 'unit', 'value']);
  assert.equal('extra' in s, false);
  assert.equal(s.demo, false);
});

test('sanitizeSnapshot rejects non-snapshots and bounds sizes and units', () => {
  for (const bad of [null, undefined, 'x', 5, {}, { groups: 'x' }]) assert.equal(L.sanitizeSnapshot(bad), null);
  const big = { groups: [{ id: 'cpu', hardware: [{ name: 'n'.repeat(1000), type: 'Cpu', sensors: Array.from({ length: 1000 }, (_, i) => ({ name: 's' + i, type: 'Load', value: i, unit: 'rm -rf' })) }] }] };
  const s = L.sanitizeSnapshot(big);
  assert.equal(s.groups[0].hardware[0].name.length, 160);
  assert.equal(s.groups[0].hardware[0].sensors.length, 400);
  assert.equal(s.groups[0].hardware[0].sensors[0].unit, '');
  assert.equal(L.sanitizeSnapshot({ groups: [{ id: 'cpu', hardware: [] }] }).groups.length, 0);
});

test('sensorsByType orders known types first and keeps the order inside a type', () => {
  const r = L.sensorsByType([{ type: 'Load', name: 'a' }, { type: 'Zeta', name: 'z' }, { type: 'Temperature', name: 'b' }, { type: 'Load', name: 'c' }, { type: 'Alpha', name: 'y' }]);
  assert.deepEqual(r.map((x) => x.type), ['Temperature', 'Load', 'Alpha', 'Zeta']);
  assert.deepEqual(r[1].sensors.map((s) => s.name), ['a', 'c']);
});

test('hottest finds the highest temperature across groups', () => {
  const h = L.hottest({ groups: [{ id: 'cpu', hardware: [{ name: 'CPU', sensors: [{ type: 'Temperature', name: 'P', value: 70 }, { type: 'Load', name: 'L', value: 99 }] }] }, { id: 'gpu', hardware: [{ name: 'GPU', sensors: [{ type: 'Temperature', name: 'C', value: 74 }] }] }] });
  assert.deepEqual(h, { value: 74, name: 'C', hardware: 'GPU' });
  assert.equal(L.hottest({ groups: [] }), null);
});

test('every group, sensor type and sensor message used by the Sensors screen is translated', () => {
  for (const lang of ['en', 'pt-BR']) {
    for (const g of L.GROUP_ORDER) assert.ok(dicts[lang][`sensors.group.${g}`], `${lang} sensors.group.${g}`);
    for (const ty of ['Temperature', 'Power', 'Clock', 'Load', 'Voltage', 'Current', 'Fan', 'Control', 'Level', 'Data', 'SmallData', 'Throughput', 'Frequency', 'Flow', 'Factor', 'TimeSpan', 'Energy', 'Noise', 'Conductivity', 'Humidity']) assert.ok(dicts[lang][`sensors.type.${ty}`], `${lang} sensors.type.${ty}`);
    for (const lv of ['warm', 'hot']) assert.ok(dicts[lang][`sensors.level.${lv}`], `${lang} sensors.level.${lv}`);
    for (const code of ['installed', 'missing', 'getNeedsAdmin', 'hashMismatch', 'getFailed', 'loadFailed', 'empty', 'needsAdmin', 'noCpuTemp', 'ok']) assert.ok(dicts[lang][`msg.sensors.${code}`], `${lang} msg.sensors.${code}`);
  }
});
