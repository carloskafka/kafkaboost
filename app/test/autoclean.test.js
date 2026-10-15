'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAutoClean } = require('../src/autoclean');

function setup({ enabled = true, code = 'msg.rammap.done', runStep } = {}) {
  const calls = []; const notices = []; const patches = [];
  let clock = 0; const settings = { autoClean: enabled, autoCleanThresholdPct: 55, autoCleanCooldownMin: 12 };
  const auto = createAutoClean({
    runStep: runStep || (async (step, opts) => { calls.push({ step, opts }); return { ok: true, code }; }),
    getSettings: () => ({ ...settings }),
    setSettings: (p) => { patches.push(p); Object.assign(settings, p); },
    notify: (c) => notices.push(c),
    now: () => clock
  });
  return { auto, calls, notices, patches, settings, at: (ms) => { clock = ms; } };
}
const running = { status: 'running' };

test('M2-05 a running session with the setting on runs rammap-auto with numeric pct and cooldown', async () => {
  const t = setup();
  await t.auto.onSession(running);
  assert.equal(t.calls.length, 1);
  assert.equal(t.calls[0].step, 'rammap-auto');
  assert.deepEqual(t.calls[0].opts, { rammapAutoPct: 55, rammapAutoCooldownMin: 12 });
});

test('M2-06 stopped, idle or setting off: no call', async () => {
  const t = setup();
  for (const status of ['idle', 'done', 'failed']) await t.auto.onSession({ status });
  const off = setup({ enabled: false });
  await off.auto.onSession(running);
  assert.equal(t.calls.length, 0); assert.equal(off.calls.length, 0);
});

test('M2-07 two samples 30 s apart give one call, a sample at 61 s gives a second', async () => {
  const t = setup();
  t.at(1000); await t.auto.onSession(running);
  t.at(31000); await t.auto.onSession(running);
  assert.equal(t.calls.length, 1);
  t.at(62000); await t.auto.onSession(running);
  assert.equal(t.calls.length, 2);
});

test('M2-08 a second sample while the first call is pending does not start another', async () => {
  let release; let n = 0;
  const t = setup({ runStep: () => { n++; return new Promise((res) => { release = () => res({ ok: true, code: 'msg.rammap.skipped' }); }); } });
  const first = t.auto.onSession(running);
  t.at(120000); await t.auto.onSession(running);
  assert.equal(n, 1);
  release(); await first;
});

for (const [id, codes] of [['M2-09', ['msg.rammap.needsAdmin']], ['M2-10', ['msg.rammap.notInstalled', 'msg.rammap.badSignature']]]) {
  test(`${id} ${codes.join(' and ')} turn the setting off and notify once`, async () => {
    for (const code of codes) {
      const t = setup({ code });
      await t.auto.onSession(running);
      t.at(120000); await t.auto.onSession(running);
      assert.deepEqual(t.patches, [{ autoClean: false }]);
      assert.deepEqual(t.notices, [code]);
      assert.equal(t.calls.length, 1);
    }
  });
}

test('M2-11 skipped, alreadyRunning and runFailed keep the setting on and do not notify', async () => {
  for (const code of ['msg.rammap.skipped', 'msg.rammap.alreadyRunning', 'msg.rammap.runFailed']) {
    const t = setup({ code });
    await t.auto.onSession(running);
    assert.deepEqual(t.patches, []); assert.deepEqual(t.notices, []); assert.equal(t.settings.autoClean, true);
  }
});
