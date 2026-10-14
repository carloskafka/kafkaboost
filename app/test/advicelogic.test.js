'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const L = require('../renderer/js/advicelogic');
const demo = require('../src/demo');
const { loadDictionaries } = require('../src/i18n');
const dicts = loadDictionaries(path.join(__dirname, '..', 'renderer', 'i18n'));

test('every verdict/reason the engine can return has a sentence in both languages', () => {
  for (const [verdict, reasons] of Object.entries(L.KNOWN)) {
    for (const reason of reasons) for (const lang of Object.keys(dicts)) assert.ok(dicts[lang][`dashboard.advice.${verdict}.${reason}`], `${lang} lacks ${verdict}.${reason}`);
    for (const lang of Object.keys(dicts)) assert.ok(dicts[lang][`msg.advice.${verdict}`], `${lang} lacks msg.advice.${verdict}`);
  }
});

test('unknown verdicts or reasons are not described (the card shows its failure text)', () => {
  assert.equal(L.describe(null), null);
  assert.equal(L.describe({ verdict: 'raise', reason: 'because' }), null);
  assert.equal(L.describe({ verdict: 'maybe', reason: 'headroom' }), null);
});

test('only a raise is green and WHEA 19 is red; the sentence never claims stability', () => {
  assert.equal(L.describe({ verdict: 'raise', reason: 'headroom', capRatio: 47, suggestedRatio: 48 }).kind, 'ok');
  assert.equal(L.describe({ verdict: 'lowerCheck', reason: 'whea19' }).kind, 'fail');
  assert.equal(L.describe({ verdict: 'hold', reason: 'hot' }).kind, 'warn');
  for (const lang of Object.keys(dicts)) assert.ok(!/\bis stable\b|estável garantid/i.test(dicts[lang]['dashboard.advice.raise.headroom']));
});

test('evidence is shown only when every number exists', () => {
  assert.equal(L.evidence({ evidence: { maxTempC: 80, maxPClockMHz: null, avgPowerW: 50 } }), null);
  assert.equal(L.evidence(null), null);
  assert.deepEqual(L.evidence({ loadedSessions: 3, evidence: { maxTempC: 80, maxPClockMHz: 4700, avgPowerW: 50 } }), { loaded: 3, temp: 80, clock: 4700, power: 50 });
});

test('the demo advice is a verdict the card understands', () => {
  assert.ok(L.describe(demo.demoStep('advice', {}, null).res.data));
});
