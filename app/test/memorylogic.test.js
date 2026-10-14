'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../renderer/js/memorylogic');

const GB = 1024 ** 3;

test('model: in use is total - available - modified, and shares are of the installed memory', () => {
  const m = M.model({ totalBytes: 32 * GB, availableBytes: 14 * GB, freeBytes: 1 * GB, standbyBytes: 13 * GB, modifiedBytes: 0.5 * GB });
  const by = Object.fromEntries(m.cards.map((c) => [c.key, c]));
  assert.equal(by.total.value, '32.0 GB'); assert.equal(by.total.pct, null);
  assert.equal(by.inUse.value, '17.5 GB'); assert.equal(by.inUse.pct, 54.7);
  assert.equal(by.standby.value, '13.0 GB'); assert.equal(by.standby.pct, 40.6);
  assert.equal(by.modified.value, '512 MB');
  assert.equal(m.hasData, true);
  assert.deepEqual(m.segments.map((x) => x.key), ['inUse', 'modified', 'standby', 'free']);
});

test('a counter Windows does not report is a dash and is not counted as 0', () => {
  const m = M.model({ totalBytes: 32 * GB, availableBytes: null, freeBytes: null, standbyBytes: 1 * GB, modifiedBytes: null });
  const by = Object.fromEntries(m.cards.map((c) => [c.key, c]));
  assert.equal(by.available.value, '—'); assert.equal(by.available.pct, null);
  assert.equal(by.inUse.value, '—', 'in use needs available and modified');
  assert.equal(by.free.value, '—');
  const seg = Object.fromEntries(m.segments.map((x) => [x.key, x]));
  assert.equal(seg.free.known, false); assert.equal(seg.standby.known, true);
});

test('no sample gives an empty model; screenModel reflects running, waiting and failed', () => {
  assert.equal(M.model(null).hasData, false);
  assert.equal(M.screenModel({ status: 'running', last: null, history: [] }).waiting, true);
  const live = M.screenModel({ status: 'running', last: { totalBytes: GB, availableBytes: GB / 2, freeBytes: 0, standbyBytes: 0, modifiedBytes: 0 }, history: [] });
  assert.equal(live.running, true); assert.equal(live.waiting, false); assert.equal(live.hasData, true);
  assert.equal(M.screenModel({ status: 'failed', last: null, history: [] }).failed, true);
  assert.equal(M.screenModel(null).running, false);
});

test('shares never go below 0 or above 100', () => {
  const m = M.model({ totalBytes: GB, availableBytes: 2 * GB, freeBytes: 2 * GB, standbyBytes: 0, modifiedBytes: 0 });
  const by = Object.fromEntries(m.cards.map((c) => [c.key, c]));
  assert.equal(by.inUse.pct, 0); assert.equal(by.available.pct, 100);
});
