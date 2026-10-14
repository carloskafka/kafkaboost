'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLoadWatch, LOW_READINGS } = require('../src/loadwatch');

test('a load reading starts a recording; idle and missing readings do not', () => {
  const w = createLoadWatch();
  assert.equal(w.decide(10, 'idle'), null);
  assert.equal(w.decide(null, 'idle'), null, 'a missing sensor is never load');
  assert.equal(w.decide(65, 'idle'), 'start');
});

test('an automatic recording stops after a sustained low load, and a spike resets the count', () => {
  const w = createLoadWatch(); w.decide(70, 'idle');
  for (let i = 0; i < LOW_READINGS - 1; i++) assert.equal(w.decide(10, 'running'), null);
  assert.equal(w.decide(60, 'running'), null, 'load came back: counting restarts');
  for (let i = 0; i < LOW_READINGS - 1; i++) assert.equal(w.decide(10, 'running'), null);
  assert.equal(w.decide(10, 'running'), 'stop');
});

test('missing readings during a recording neither stop it nor count as low', () => {
  const w = createLoadWatch(); w.decide(70, 'idle');
  for (let i = 0; i < 20; i++) assert.equal(w.decide(null, 'running'), null);
});

test('a recording the user started is never stopped automatically', () => {
  const w = createLoadWatch();
  for (let i = 0; i < 20; i++) assert.equal(w.decide(5, 'running'), null);
});
