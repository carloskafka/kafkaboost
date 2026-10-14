'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../renderer/js/sessionlogic');
const demo = require('../src/demo');
const path = require('node:path');
const fs = require('node:fs');
const { loadDictionaries } = require('../src/i18n');
const dicts = loadDictionaries(path.join(__dirname, '..', 'renderer', 'i18n'));

test('duration reads as m s under an hour and h m above; garbage is a dash', () => {
  assert.equal(L.formatDuration(125), '2m 05s');
  assert.equal(L.formatDuration(3900), '1h 05m');
  assert.equal(L.formatDuration(null), '–');
  assert.equal(L.formatDuration(-1), '–');
});

test('a sensor that was never readable shows as missing, never 0', () => {
  assert.equal(L.formatStat(null, '°C'), null);
  assert.deepEqual(L.formatStat({ peak: 90, avg: 80.5 }, '°C'), { peak: '90 °C', avg: '80.5 °C' });
  assert.deepEqual(L.formatNow(null), { temp: '–', power: '–', clock: '–' });
  assert.equal(L.formatNow({ tempC: null, powerW: 60, pClockMHz: null }).temp, '–');
  assert.equal(L.pctText(null), '–');
  assert.equal(L.pctText(0), '0%');
});

test('WHEA wording: none / some / 19 (undervolt warning) / unreadable', () => {
  assert.equal(L.wheaKey({ count: 0, has19: false }).key, 'dashboard.session.wheaNone');
  assert.equal(L.wheaKey({ count: 2, has19: false }).key, 'dashboard.session.wheaSome');
  assert.equal(L.wheaKey({ count: 1, has19: true }).key, 'dashboard.session.whea19');
  assert.equal(L.wheaKey(null).key, 'dashboard.session.wheaUnknown');
});

test('view only follows known states', () => {
  assert.equal(L.view(null), 'idle'); assert.equal(L.view({ status: 'running' }), 'running'); assert.equal(L.view({ status: 'x' }), 'idle');
});

test('demo session step gives sample lines and a summary that never claims throttle information', () => {
  const d = demo.demoStep('session', {}, null);
  assert.ok(d.logs.every((l) => l.startsWith('SAMPLE ')));
  assert.equal(d.res.data.summary.throttleFlags, 'unknown');
  assert.equal(d.res.data.whea.has19, false);
});

test('every session i18n key exists in both languages', () => {
  const keys = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'js', 'session.js'), 'utf8') + fs.readFileSync(path.join(__dirname, '..', 'renderer', 'js', 'sessionlogic.js'), 'utf8');
  const used = new Set(keys.match(/dashboard\.session\.[A-Za-z0-9]+/g));
  for (const k of ['msg.session.noSensors', 'msg.session.done', 'dashboard.session.title', 'dashboard.session.intro', 'dashboard.session.note', 'dashboard.session.start', 'dashboard.session.stop']) used.add(k);
  for (const lang of Object.keys(dicts)) for (const k of used) assert.ok(dicts[lang][k], `${lang} lacks ${k}`);
});

test('formatRange shows the lowest and highest memory in GB or MB, and nothing for a counter that was never readable', () => {
  const GB = 1024 ** 3;
  assert.deepEqual(L.formatRange({ min: 0.8 * GB, max: 14 * GB }), { low: '819 MB', high: '14.0 GB' });
  assert.equal(L.formatRange(null), null);
  assert.equal(L.formatRange({ min: null, max: 5 }), null);
  assert.equal(L.bytesText(null), null);
  assert.equal(L.bytesText(-1), null);
  assert.equal(L.bytesText(0), '0 MB', 'a measured zero is shown, a missing value is not');
});
