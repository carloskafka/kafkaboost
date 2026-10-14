'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryWatch, KEEP } = require('../src/memorywatch');

const fakeFs = () => { const files = new Set(); return { files, rmSync: (f) => files.delete(f), writeFileSync: (f) => files.add(f) }; };
const mem = (n) => 'MEM ' + JSON.stringify({ t: '2026-10-14T10:00:0' + n, totalBytes: 1000, availableBytes: 400 + n, freeBytes: null, standbyBytes: 300, modifiedBytes: 5 });

test('start launches the memory-watch step with the stop file and a 2 s interval, and a second start is refused while running', async () => {
  const fs = fakeFs(); let call = null; let finish;
  const runStep = (step, opts, onLine) => { call = { step, opts, onLine }; return new Promise((r) => { finish = r; }); };
  const w = createMemoryWatch({ runStep, fs, stopFile: 'stop.file' });
  assert.equal(w.start(), true);
  assert.equal(call.step, 'memory-watch'); assert.equal(call.opts.sessionStopFile, 'stop.file'); assert.equal(call.opts.sessionIntervalSec, 2);
  assert.equal(w.getState().status, 'running');
  assert.equal(w.start(), false);
  finish({ ok: true, code: 'msg.memory.watched' });
  await w.whenDone();
});

test('MEM lines update the latest reading and the trend; a missing counter stays null, never 0; other lines are ignored', () => {
  const w = createMemoryWatch({ runStep: () => new Promise(() => {}), fs: fakeFs(), stopFile: 's' });
  w.start();
  w.onLine(mem(1)); w.onLine('LOG something else'); w.onLine('MEM {not json'); w.onLine(mem(2));
  const st = w.getState();
  assert.equal(st.history.length, 2);
  assert.equal(st.last.availableBytes, 402);
  assert.equal(st.last.freeBytes, null);
  assert.equal(st.last.modifiedBytes, 5);
});

test('only the latest KEEP readings are kept', () => {
  const w = createMemoryWatch({ runStep: () => new Promise(() => {}), fs: fakeFs(), stopFile: 's' });
  w.start();
  for (let i = 0; i < KEEP + 10; i++) w.onLine(mem(i % 10));
  assert.equal(w.getState().history.length, KEEP);
});

test('stop writes the stop file only while running; when the step ends the state is idle (ok) or failed, and the stop file is removed', async () => {
  const fs = fakeFs(); let finish;
  const w = createMemoryWatch({ runStep: () => new Promise((r) => { finish = r; }), fs, stopFile: 'stop.file' });
  assert.equal(w.stop(), false);
  w.start();
  assert.equal(w.stop(), true); assert.ok(fs.files.has('stop.file'));
  finish({ ok: true });
  await w.whenDone();
  await new Promise((r) => setImmediate(r));
  assert.equal(w.getState().status, 'idle'); assert.ok(!fs.files.has('stop.file'));
  const w2 = createMemoryWatch({ runStep: () => Promise.resolve({ ok: false, code: 'msg.x' }), fs: fakeFs(), stopFile: 's' });
  w2.start(); await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
  assert.equal(w2.getState().status, 'failed'); assert.equal(w2.getState().code, 'msg.x');
});

test('leaving and re-entering quickly: a start while the old process is stopping waits for it and then starts again', async () => {
  const fs = fakeFs(); const finishers = []; let launches = 0;
  const w = createMemoryWatch({ runStep: () => { launches++; return new Promise((r) => finishers.push(r)); }, fs, stopFile: 'stop.file' });
  w.start(); assert.equal(launches, 1);
  assert.equal(w.stop(), true);
  assert.equal(w.start(), true, 'accepted while stopping');
  assert.equal(launches, 1, 'not started twice at once');
  finishers[0]({ ok: true });
  await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
  assert.equal(launches, 2, 'started again once the old one ended');
  assert.equal(w.getState().status, 'running');
  assert.equal(w.start(), false, 'a normal second start is still refused');
  // a stop after the quick restart request cancels the restart
  const w2 = createMemoryWatch({ runStep: () => new Promise((r) => finishers.push(r)), fs: fakeFs(), stopFile: 's' });
  w2.start(); w2.stop(); w2.start(); w2.stop();
  const before = finishers.length;
  finishers[finishers.length - 1]({ ok: true });
  await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
  assert.equal(finishers.length, before, 'no restart after the last stop');
  assert.equal(w2.getState().status, 'idle');
});

test('onChange is called for every update with a copy of the state', () => {
  const seen = [];
  const w = createMemoryWatch({ runStep: () => new Promise(() => {}), fs: fakeFs(), stopFile: 's', onChange: (s) => seen.push(s) });
  w.start(); w.onLine(mem(1));
  assert.equal(seen.length, 2);
  seen[1].history.push('x');
  assert.equal(w.getState().history.length, 1, 'the state handed out is a copy');
});
