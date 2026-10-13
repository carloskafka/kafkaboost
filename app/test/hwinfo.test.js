'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { cardModel, DOWNLOAD_PAGE } = require('../renderer/js/hwinfologic');
const demo = require('../src/demo');

const release = { version: '8.54', url: 'https://www.hwinfo.com/files/hwi_854.zip', signer: 'REALiX' };

test('not installed: only "check" first, the download button needs the release, the consent and administrator rights', () => {
  const missing = { installed: false, running: false };
  let m = cardModel(missing, { admin: true });
  assert.equal(m.status, 'hwinfo.status.missing');
  assert.ok(m.showCheck && !m.showGet && !m.showStart && !m.showStop);
  m = cardModel(missing, { admin: true, release });
  assert.ok(!m.showCheck && m.showGet);
  assert.equal(m.getEnabled, false, 'no consent yet');
  assert.equal(cardModel(missing, { admin: true, release, consent: true }).getEnabled, true);
  assert.equal(cardModel(missing, { admin: false, release, consent: true }).getEnabled, false, 'not elevated');
  assert.equal(cardModel(missing, { admin: true, release, consent: true, busy: true }).getEnabled, false, 'busy');
});

test('installed: start when stopped, stop when running, live only with shared memory', () => {
  const stopped = { installed: true, source: 'own', running: false, sharedMemory: false, ini: 'ok' };
  let m = cardModel(stopped, { admin: true });
  assert.equal(m.status, 'hwinfo.status.stopped'); assert.ok(m.showStart && !m.showStop && m.startEnabled);
  assert.equal(m.sourceKey, 'hwinfo.source.own');
  m = cardModel({ ...stopped, running: true, sharedMemory: true }, { admin: true });
  assert.equal(m.status, 'hwinfo.status.live'); assert.ok(m.showStop && !m.showStart && m.stopEnabled);
  assert.equal(cardModel({ ...stopped, running: true, sharedMemory: false }, { admin: true }).status, 'hwinfo.status.runningNoSm');
  assert.equal(cardModel({ ...stopped, source: 'existing' }, {}).sourceKey, 'hwinfo.source.existing');
  assert.equal(cardModel(stopped, { admin: false }).startEnabled, false);
});

test("a user's INI without shared memory needs its own consent before start", () => {
  const s = { installed: true, source: 'existing', running: false, ini: 'noSharedMemory' };
  let m = cardModel(s, { admin: true });
  assert.ok(m.needsIni); assert.equal(m.startEnabled, false);
  m = cardModel(s, { admin: true, iniConsent: true });
  assert.equal(m.startEnabled, true);
});

test('the download page is the official one and the main process may open it', () => {
  assert.equal(DOWNLOAD_PAGE, 'https://www.hwinfo.com/download/');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const m = src.match(/const EXTERNAL_OK = (\/.*\/);/);
  assert.ok(m, 'EXTERNAL_OK not found');
  const re = eval(m[1]); // eslint-disable-line no-eval -- a regex literal from our own source
  assert.ok(re.test(DOWNLOAD_PAGE));
  assert.ok(!re.test('https://www.hwinfo.com.evil.example/download/'));
});

test('main.js passes only a plain version and an explicit boolean to Steps.ps1', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(src, /\^\[0-9\]\+\\\.\[0-9\]\+\$/);
  assert.match(src, /opts\.updateIni === true/);
});

test('demo mode walks missing -> installed -> running -> stopped and asks consent for a download', () => {
  demo.state.hwinfo = { installed: false, running: false };
  const step = (s, o) => demo.demoStep(s, o || {}, null).res;
  assert.equal(step('hwinfo-state').data.installed, false);
  assert.equal(step('hwinfo-check').data.signer, 'REALiX');
  assert.equal(step('hwinfo-get', {}).code, 'msg.hwinfo.consentNeeded');
  assert.equal(step('hwinfo-get', { download: true, hwinfoVersion: '8.54' }).code, 'msg.hwinfo.installed');
  assert.equal(step('hwinfo-state').data.installed, true);
  assert.equal(step('hwinfo-start').code, 'msg.hwinfo.started');
  assert.equal(step('hwinfo-state').data.sharedMemory, true);
  assert.equal(step('hwinfo-stop').code, 'msg.hwinfo.stopped');
  assert.equal(step('hwinfo-state').data.running, false);
});

test('Steps.ps1 declares every hwinfo step and the two read-only ones need no administrator', () => {
  const ps = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'Steps.ps1'), 'utf8');
  for (const s of ['hwinfo-state', 'hwinfo-check', 'hwinfo-get', 'hwinfo-start', 'hwinfo-stop']) assert.ok(ps.includes(`'${s}'`), s);
  const ro = ps.match(/\$readOnly = \(([^\r\n]*?)\) -or/)[1];
  assert.ok(ro.includes("'hwinfo-state'") && ro.includes("'hwinfo-check'"));
  assert.ok(!ro.includes("'hwinfo-get'") && !ro.includes("'hwinfo-start'") && !ro.includes("'hwinfo-stop'"));
});
