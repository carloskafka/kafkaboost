'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../renderer/js/rammaplogic');

test('formatBytes keeps a missing value missing, never 0', () => {
  assert.equal(R.formatBytes(null), '—');
  assert.equal(R.formatBytes(undefined), '—');
  assert.equal(R.formatBytes(NaN), '—');
  assert.equal(R.formatBytes(0), '0 MB');
  assert.equal(R.formatBytes(850 * 1024 * 1024), '850 MB');
  assert.equal(R.formatBytes(12.3 * 1024 * 1024 * 1024), '12.3 GB');
});

test('formatDelta signs the number and keeps missing as a dash', () => {
  assert.equal(R.formatDelta(1.5 * 1024 * 1024 * 1024), '+1.5 GB');
  assert.equal(R.formatDelta(-850 * 1024 * 1024), '-850 MB');
  assert.equal(R.formatDelta(0), '0 MB');
  assert.equal(R.formatDelta(null), '—');
});

test('screenModel: download offered when missing, actions only when installed with a valid signature and not busy', () => {
  const actions = [{ id: 'standby', risk: 'advanced', switch: '-E0' }, { id: 'working-sets', risk: 'safe', switch: '-Ew' }];
  const missing = R.screenModel({ state: { installed: false }, actions }, false);
  assert.equal(missing.showDownload, true); assert.equal(missing.showActions, false); assert.equal(missing.downloadEnabled, true);
  const ok = R.screenModel({ state: { installed: true, signerOk: true }, actions }, false);
  assert.equal(ok.showActions, true); assert.equal(ok.showDownload, false);
  assert.ok(ok.actions.every((a) => a.enabled));
  assert.equal(ok.actions[0].titleKey, 'rammap.action.standby.title');
  const busy = R.screenModel({ state: { installed: true, signerOk: true }, actions }, true);
  assert.ok(busy.actions.every((a) => !a.enabled));
  const bad = R.screenModel({ state: { installed: true, signerOk: false }, actions }, false);
  assert.equal(bad.badSignature, true); assert.ok(bad.actions.every((a) => !a.enabled));
  assert.equal(R.screenModel(null, false).showDownload, true);
});

test('memoryRows lists five rows and shows a missing counter as a dash', () => {
  const rows = R.memoryRows({ totalBytes: 32 * 1024 ** 3, availableBytes: null });
  assert.deepEqual(rows.map((r) => r.key), ['total', 'available', 'free', 'standby', 'modified']);
  assert.equal(rows[0].value, '32.0 GB'); assert.equal(rows[1].value, '—');
});

test('historyRow and totals only count what was measured', () => {
  const rec = { time: '2026-10-14T10:00:00Z', action: 'standby', delta: { availableBytes: 2 * 1024 ** 3, standbyBytes: -(2 * 1024 ** 3), modifiedBytes: null, freeBytes: 0 } };
  const row = R.historyRow(rec);
  assert.equal(row.standby, '-2.0 GB'); assert.equal(row.modified, '—'); assert.equal(row.available, '+2.0 GB');
  const t = R.totals([rec, { action: 'working-sets', delta: { standbyBytes: null } }, { action: 'standby', delta: { standbyBytes: -(1024 ** 3) } }]);
  assert.equal(t.runs, 3); assert.equal(t.measured, 2); assert.equal(t.releasedStandbyBytes, 3 * 1024 ** 3);
  assert.deepEqual(R.totals(null), { runs: 0, measured: 0, releasedStandbyBytes: 0 });
});
