'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const L = require('../renderer/js/updatelogic');
const { loadDictionaries } = require('../src/i18n');

const dicts = loadDictionaries(path.join(__dirname, '..', 'renderer', 'i18n'));
const installer = { name: 'KafkaBoost-Setup-1.1.0.exe', size: 98 * 1048576 };
const clone = { newer: true, canInstall: false, mode: 'download', explain: ['update.why.source', 'update.why.clone'], installer, checksum: true };
const noinst = { newer: true, canInstall: false, mode: 'manual', explain: ['update.why.source', 'update.why.noInstaller', 'update.why.clone'], installer: null, checksum: false };
const installed = { newer: true, canInstall: true, mode: 'auto', explain: [], installer, checksum: true };
const m = (r, phase, percent) => L.model(r, { phase, percent });

test('a clone with an installer: Download and install + release page, with the why and the git pull hint', () => {
  const x = m(clone, 'idle');
  assert.deepEqual(x.buttons, ['download', 'release']); assert.deepEqual(x.explain, ['update.why.source', 'update.why.clone']); assert.equal(x.status, null);
});

test('no installer attached: no download button, the reason and the release page only', () => {
  const x = m(noinst, 'idle');
  assert.deepEqual(x.buttons, ['release']); assert.ok(x.explain.includes('update.why.noInstaller') && x.explain.includes('update.why.clone'));
  assert.deepEqual(m(noinst, 'error').buttons, ['release']);
});

test('installed build: Download the update, then Restart and update; no explanation of why it cannot update', () => {
  assert.deepEqual(m(installed, 'idle').buttons, ['install']); assert.deepEqual(m(installed, 'idle').explain, []);
  assert.deepEqual(m(installed, 'ready').buttons, ['restart']); assert.equal(m(installed, 'ready').status.key, 'update.readyRestart');
  assert.deepEqual(m(installed, 'error').buttons, ['install', 'release']);
  assert.equal(m(installed, 'downloading', 40).progress, 40);
});

test('downloading shows the percent and a Cancel button (clone), no Cancel for the updater path', () => {
  const x = m(clone, 'downloading', 42);
  assert.deepEqual(x.buttons, ['cancel']); assert.equal(x.progress, 42); assert.deepEqual(x.status, { kind: 'warn', key: 'update.downloading', vars: { percent: 42 } });
  assert.deepEqual(m(installed, 'downloading', 5).buttons, []);
});

test('end states of a clone download', () => {
  assert.deepEqual(m(clone, 'nochecksum').buttons, ['folder', 'release']); assert.equal(m(clone, 'nochecksum').status.key, 'update.noChecksum');
  assert.deepEqual(m(clone, 'mismatch').buttons, ['download', 'release']); assert.equal(m(clone, 'mismatch').status.kind, 'fail');
  assert.equal(m(clone, 'cancelled').status.key, 'update.cancelled'); assert.equal(m(clone, 'declined').status.key, 'update.declined');
  assert.equal(m(clone, 'error').status.key, 'update.downloadFailed'); assert.equal(m(clone, 'launchFailed').status.key, 'update.launchFailed');
  assert.deepEqual(m(clone, 'installing').buttons, []);
});

test('every key the panel can use exists in both languages and the texts say the plain things', () => {
  const keys = new Set();
  for (const r of [clone, noinst, installed]) for (const ph of ['idle', 'downloading', 'ready', 'nochecksum', 'mismatch', 'error', 'cancelled', 'declined', 'installing', 'launchFailed']) {
    const x = m(r, ph, 10); x.explain.forEach((k) => keys.add(k)); if (x.status) keys.add(x.status.key);
  }
  for (const b of ['install', 'restart', 'download', 'cancel', 'folder', 'release']) keys.add('update.btn.' + b);
  ['update.confirmTitle', 'update.confirmBody', 'update.confirmSmart', 'update.confirmClone', 'update.confirmOk', 'update.mismatchHint', 'update.noChecksumHint'].forEach((k) => keys.add(k));
  for (const lang of ['en', 'pt-BR']) for (const k of keys) assert.ok(dicts[lang][k], `${lang} ${k}`);
  assert.match(dicts.en['update.why.source'], /source folder|portable/); assert.match(dicts.en['update.why.clone'], /git pull/);
  assert.match(dicts.en['update.why.noInstaller'], /no installer/); assert.match(dicts.en['update.confirmBody'], /closes this window[\s\S]*administrator/);
  assert.match(dicts.en['update.confirmSmart'], /SmartScreen/); assert.match(dicts.en['update.confirmClone'], /separate installed copy/);
  assert.match(dicts['pt-BR']['update.why.clone'], /git pull/); assert.match(dicts['pt-BR']['update.confirmSmart'], /SmartScreen/);
});

test('formatSize', () => {
  assert.equal(L.formatSize(98 * 1048576), '98.0 MB');
  assert.equal(L.formatSize(2048), '2 KB'); assert.equal(L.formatSize(12), '12 B'); assert.equal(L.formatSize(undefined), '0 B');
});
