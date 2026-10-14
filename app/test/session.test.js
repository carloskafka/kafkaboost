'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSession } = require('../src/session');

function fakeFs() {
  const files = new Map();
  return { files,
    readFileSync: (f) => { if (!files.has(f)) throw new Error('ENOENT'); return files.get(f); },
    writeFileSync: (f, d) => { files.set(f, String(d)); },
    rmSync: (f) => { files.delete(f); } };
}
const mk = (runStep, fs = fakeFs()) => ({ fs, s: createSession({ runStep, fs, stopFile: 'stop.flag', storeFile: 'last.json' }) });

test('start streams samples into running numbers and keeps the summary when the step ends', async () => {
  let finish;
  const runStep = (step, opts, onLog) => new Promise((resolve) => {
    assert.equal(step, 'session'); assert.equal(opts.sessionStopFile, 'stop.flag');
    onLog('SAMPLE {"t":"2026-10-13T20:00:00","packageTempC":70,"packagePowerW":60,"pClockMaxMHz":4600,"eClockMaxMHz":3500}');
    onLog('SAMPLE {"t":"2026-10-13T20:00:05","packageTempC":85,"packagePowerW":null,"pClockMaxMHz":4700,"eClockMaxMHz":3600}');
    onLog('not a sample line');
    finish = () => resolve({ ok: true, code: 'msg.session.done', data: { summary: { samples: 2 }, whea: { count: 0 } } });
  });
  const { s, fs } = mk(runStep);
  assert.equal(s.start(), true);
  assert.equal(s.start(), false, 'never a second recording');
  const run = s.getState();
  assert.equal(run.status, 'running'); assert.equal(run.count, 2);
  assert.equal(run.peakTempC, 85); assert.equal(run.peakPowerW, 60, 'a missing reading never counts as 0');
  assert.equal(run.last.powerW, null);
  finish(); await s.whenDone();
  assert.equal(s.getState().status, 'done');
  assert.equal(JSON.parse(fs.files.get('last.json')).summary.samples, 2);
});

test('stop writes the stop file only while running; the file is removed afterwards', async () => {
  let finish; const runStep = () => new Promise((r) => { finish = () => r({ ok: true, data: { summary: {} } }); });
  const { s, fs } = mk(runStep);
  assert.equal(s.stop(), false, 'nothing to stop');
  s.start(); assert.equal(s.stop(), true); assert.ok(fs.files.has('stop.flag'));
  finish(); await s.whenDone();
  assert.ok(!fs.files.has('stop.flag'));
});

test('a refused step (no sensors) ends as failed with its code and keeps no summary', async () => {
  const { s } = mk(async () => ({ ok: false, code: 'msg.session.noSensors' }));
  s.start(); await s.whenDone();
  const st = s.getState(); assert.equal(st.status, 'failed'); assert.equal(st.code, 'msg.session.noSensors'); assert.equal(st.result, null);
});

test('the last finished session is loaded from disk at startup', () => {
  const fs = fakeFs(); fs.files.set('last.json', JSON.stringify({ summary: { samples: 9 } }));
  const { s } = mk(async () => ({ ok: false }), fs);
  assert.equal(s.getState().status, 'done'); assert.equal(s.getState().result.summary.samples, 9);
});

test('garbage on disk is ignored', () => {
  const fs = fakeFs(); fs.files.set('last.json', '{nope');
  assert.equal(mk(async () => ({}), fs).s.getState().status, 'idle');
});
