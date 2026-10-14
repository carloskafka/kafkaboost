'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const d = require('../src/updatedl');

const BASE = 'https://github.com/carloskafka/kafkaboost/releases/download/v1.1.0/';
const SETUP = 'KafkaBoost-Setup-1.1.0.exe';
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kb-dl-test-'));
const bytes = Buffer.from('pretend installer '.repeat(500));

// Fake fetch: a map url -> () => Response. Records every address asked for. No network.
function fakeFetch(routes, seen = []) {
  return async (url) => {
    seen.push(url);
    const make = routes[url];
    if (!make) return new Response('nope', { status: 404 });
    return make();
  };
}
const ok = (buf, extra = {}) => () => new Response(buf, { status: 200, headers: { 'content-length': String(buf.length), ...extra } });
const redirect = (to, status = 302) => () => new Response(null, { status, headers: { location: to } });

test('only release assets of this repository on github.com are accepted as the first address', () => {
  assert.ok(d.isReleaseAssetUrl(BASE + SETUP));
  for (const bad of [
    'http://github.com/carloskafka/kafkaboost/releases/download/v1/x.exe',
    'https://github.com.evil.com/carloskafka/kafkaboost/releases/download/v1/x.exe',
    'https://evil.com/github.com/carloskafka/kafkaboost/releases/download/v1/x.exe',
    'https://github.com/someone/else/releases/download/v1/x.exe',
    'https://github.com/carloskafka/legion-14900hx-throttlestop/releases/download/v1/x.exe',   // the old repository name is no longer accepted
    'https://github.com/carloskafka/kafkaboost/releases/download/',
    'https://github.com/carloskafka/kafkaboost/archive/main.zip',
    'https://user:pw@github.com/carloskafka/kafkaboost/releases/download/v1/x.exe',
    'https://github.com:8443/carloskafka/kafkaboost/releases/download/v1/x.exe',
    'file:///C:/x.exe', 'javascript:alert(1)', '', null, undefined
  ]) assert.equal(d.isReleaseAssetUrl(bad), false, String(bad));
});

test('redirect hops may go to GitHub release CDN hosts only', () => {
  assert.ok(d.isAllowedHop('https://objects.githubusercontent.com/github-production-release-asset/abc?x=1'));
  assert.ok(d.isAllowedHop('https://release-assets.githubusercontent.com/github-production-release-asset/abc'));
  assert.ok(d.isAllowedHop(BASE + SETUP));
  for (const bad of ['https://githubusercontent.com/x', 'https://evil.githubusercontent.com.attacker.net/x', 'https://raw.githubusercontent.com/x', 'http://objects.githubusercontent.com/x', 'https://example.com/x', 'https://github.com/other/repo/releases/download/v/x'])
    assert.equal(d.isAllowedHop(bad), false, bad);
});

test('pickAssets takes the Setup exe of exactly that version and SHA256SUMS.txt; the Portable exe is never offered', () => {
  const a = (name) => ({ name, browser_download_url: BASE + name, size: 123 });
  const p = d.pickAssets([a('KafkaBoost-Portable-1.1.0.exe'), a(SETUP), a('KafkaBoost-Setup-1.0.0.exe'), a('SHA256SUMS.txt'), a('latest.yml')], '1.1.0');
  assert.equal(p.installer.name, SETUP); assert.equal(p.installer.size, 123); assert.equal(p.checksums.name, 'SHA256SUMS.txt');
  assert.equal(d.pickAssets([a('KafkaBoost-Portable-1.1.0.exe')], '1.1.0').installer, null);
  assert.equal(d.pickAssets([a(SETUP)], '1.2.0').installer, null);
  assert.equal(d.pickAssets([{ name: SETUP, browser_download_url: 'https://evil.com/' + SETUP }], '1.1.0').installer, null, 'an asset address outside the repo counts as absent');
  assert.equal(d.pickAssets(null, '1.1.0').installer, null);
  assert.equal(d.pickAssets([a(SETUP)], '1.1.0').checksums, null);
});

test('checksum lines are parsed (sha256sum and Get-FileHash styles) and verified', () => {
  const h = sha(bytes);
  const text = `${h.toUpperCase()}  ${SETUP}\r\n${'a'.repeat(64)} *KafkaBoost-Portable-1.1.0.exe\nnot a checksum line\n`;
  const m = d.parseChecksums(text);
  assert.equal(m.size, 2); assert.equal(m.get(SETUP), h);
  assert.equal(d.verifyChecksum(text, SETUP, h), 'ok');
  assert.equal(d.verifyChecksum(text, SETUP, 'b'.repeat(64)), 'mismatch');
  assert.equal(d.verifyChecksum(text, 'KafkaBoost-Setup-9.9.9.exe', h), 'missing');
  assert.equal(d.verifyChecksum('', SETUP, h), 'missing');
  assert.equal(d.verifyChecksum(null, SETUP, h), 'missing');
});

test('decide: installed builds update themselves, a clone with an installer downloads it, otherwise only the release page', () => {
  assert.deepEqual(d.decide({ canSelf: true, installer: null }), { mode: 'auto', explain: [] });
  const dl = d.decide({ canSelf: false, installer: { name: SETUP } });
  assert.equal(dl.mode, 'download'); assert.deepEqual(dl.explain, ['update.why.source', 'update.why.clone']);
  const man = d.decide({ canSelf: false, installer: null });
  assert.equal(man.mode, 'manual'); assert.deepEqual(man.explain, ['update.why.source', 'update.why.noInstaller', 'update.why.clone']);
});

test('temp folder guard: direct children of the private folder only', () => {
  const dir = path.join(os.tmpdir(), d.DIR_NAME);
  assert.equal(d.updateDir(os.tmpdir()), dir);
  assert.ok(d.insideDir(dir, path.join(dir, SETUP)));
  assert.equal(d.insideDir(dir, dir), false);
  assert.equal(d.insideDir(dir, path.join(dir, '..', SETUP)), false);
  assert.equal(d.insideDir(dir, path.join(dir, 'sub', SETUP)), false);
  assert.equal(d.insideDir(dir, path.join(dir, '..', 'x', '..', d.DIR_NAME, SETUP)), true, 'spelling does not matter, the resolved place does');
  assert.equal(d.insideDir(dir, path.join(os.homedir(), 'Downloads', SETUP)), false);
});

test('only our own file names are cleanable', () => {
  for (const ok2 of [SETUP, SETUP + '.part', 'SHA256SUMS.txt', 'SHA256SUMS.txt.part']) assert.ok(d.isCleanableName(ok2), ok2);
  for (const bad of ['notes.txt', 'KafkaBoost-Setup-1.1.exe', 'KafkaBoost-Setup-1.1.0.exe.bak', 'KafkaBoost-Portable-1.1.0.exe', '..', 'x/KafkaBoost-Setup-1.1.0.exe', 'KafkaBoost-Setup-1.1.0.exe\n']) assert.equal(d.isCleanableName(bad), false, bad);
});

test('cleanup removes only old files with our names, keeps new files, other files and folders', () => {
  const dir = tmp();
  try {
    const old = Date.now() - 3600 * 1000;
    const mk = (n, when) => { const f = path.join(dir, n); fs.writeFileSync(f, 'x'); fs.utimesSync(f, when / 1000, when / 1000); return f; };
    mk(SETUP, old); mk(SETUP + '.part', old); mk('SHA256SUMS.txt', old); mk('keep-me.txt', old); mk('KafkaBoost-Setup-1.2.0.exe', Date.now() + 5000);
    fs.mkdirSync(path.join(dir, 'KafkaBoost-Setup-9.9.9.exe'));            // a FOLDER with an installer-like name
    const gone = d.cleanupDir(dir, Date.now() - 1000, fs);
    assert.deepEqual(gone.sort(), [SETUP, SETUP + '.part', 'SHA256SUMS.txt'].sort());
    assert.ok(fs.existsSync(path.join(dir, 'keep-me.txt')) && fs.existsSync(path.join(dir, 'KafkaBoost-Setup-1.2.0.exe')) && fs.existsSync(path.join(dir, 'KafkaBoost-Setup-9.9.9.exe')));
    assert.deepEqual(d.cleanupDir(path.join(dir, 'does-not-exist'), Date.now(), fs), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('cleanup never follows a link out of the folder', (t) => {
  const dir = tmp(), outside = tmp();
  try {
    const target = path.join(outside, 'precious.txt'); fs.writeFileSync(target, 'keep');
    try { fs.symlinkSync(target, path.join(dir, SETUP), 'file'); } catch { t.skip('symlinks need privileges on this machine'); return; }
    fs.utimesSync(path.join(dir, SETUP), 1, 1);
    d.cleanupDir(dir, Date.now() + 10000, fs);
    assert.equal(fs.readFileSync(target, 'utf8'), 'keep');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});

test('download: follows the GitHub redirect to the CDN, verifies the checksum, renames from .part, reports progress', async () => {
  const dir = tmp(), seen = [], pct = [];
  try {
    const cdn = 'https://objects.githubusercontent.com/github-production-release-asset/1?sig=abc';
    const fetchImpl = fakeFetch({ [BASE + SETUP]: redirect(cdn), [cdn]: ok(bytes), [BASE + 'SHA256SUMS.txt']: ok(Buffer.from(`${sha(bytes)}  ${SETUP}\n`)) }, seen);
    const r = await d.fetchAndVerify({ installer: { name: SETUP, url: BASE + SETUP }, checksums: { url: BASE + 'SHA256SUMS.txt' }, dir, fetchImpl, fs, onProgress: (p) => pct.push(p) });
    assert.equal(r.state, 'verified'); assert.equal(r.file, path.join(dir, SETUP));
    assert.deepEqual(fs.readFileSync(r.file), bytes); assert.equal(fs.existsSync(r.file + '.part'), false);
    assert.equal(pct[pct.length - 1], 100);
    assert.deepEqual(seen, [BASE + 'SHA256SUMS.txt', BASE + SETUP, cdn]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('download: a checksum mismatch deletes the file', async () => {
  const dir = tmp();
  try {
    const fetchImpl = fakeFetch({ [BASE + SETUP]: ok(bytes), [BASE + 'SHA256SUMS.txt']: ok(Buffer.from(`${'0'.repeat(64)}  ${SETUP}\n`)) });
    const r = await d.fetchAndVerify({ installer: { name: SETUP, url: BASE + SETUP }, checksums: { url: BASE + 'SHA256SUMS.txt' }, dir, fetchImpl, fs });
    assert.equal(r.state, 'mismatch'); assert.equal(r.file, undefined);
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('download: without a checksum file (or without a line for the installer) the file is kept but never counts as verified', async () => {
  for (const sums of [null, { url: BASE + 'SHA256SUMS.txt' }]) {
    const dir = tmp();
    try {
      const routes = { [BASE + SETUP]: ok(bytes), [BASE + 'SHA256SUMS.txt']: ok(Buffer.from(`${'a'.repeat(64)}  other.exe\n`)) };
      const r = await d.fetchAndVerify({ installer: { name: SETUP, url: BASE + SETUP }, checksums: sums, dir, fetchImpl: fakeFetch(routes), fs });
      assert.equal(r.state, 'nochecksum'); assert.ok(fs.existsSync(r.file));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('download: refuses a redirect to a foreign host, a non-https hop, a foreign first address and too many hops', async () => {
  const dir = tmp();
  try {
    const run = (routes, url = BASE + SETUP) => d.downloadToFile({ url, dir, name: SETUP, fetchImpl: fakeFetch(routes), fs });
    await assert.rejects(run({ [BASE + SETUP]: redirect('https://evil.example.com/x.exe') }), { code: 'blocked' });
    await assert.rejects(run({ [BASE + SETUP]: redirect('http://objects.githubusercontent.com/x') }), { code: 'blocked' });
    await assert.rejects(run({}, 'https://evil.example.com/' + SETUP), { code: 'blocked' });
    const loop = 'https://objects.githubusercontent.com/loop';
    await assert.rejects(run({ [BASE + SETUP]: redirect(loop), [loop]: redirect(loop) }), { code: 'blocked' });
    await assert.rejects(run({ [BASE + SETUP]: () => new Response('x', { status: 500 }) }), { code: 'http' });
    assert.deepEqual(fs.readdirSync(dir), [], 'nothing left behind');
    await assert.rejects(d.downloadToFile({ url: BASE + 'evil.exe', dir, name: '..\\evil.exe', fetchImpl: fakeFetch({}), fs }), { code: 'blocked' }, 'a file name outside the installer pattern is refused');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('download: the size cap stops a file that is too big (declared or streamed) and removes the partial file', async () => {
  const dir = tmp();
  try {
    await assert.rejects(d.downloadToFile({ url: BASE + SETUP, dir, name: SETUP, maxBytes: 100, fetchImpl: fakeFetch({ [BASE + SETUP]: ok(bytes) }), fs }), { code: 'toolarge' });
    const noLen = () => new Response(bytes, { status: 200 });                 // no content-length: caught while streaming
    await assert.rejects(d.downloadToFile({ url: BASE + SETUP, dir, name: SETUP, maxBytes: 100, fetchImpl: fakeFetch({ [BASE + SETUP]: noLen }), fs }), { code: 'toolarge' });
    assert.deepEqual(fs.readdirSync(dir), []);
    assert.equal(d.MAX_INSTALLER_BYTES, 300 * 1024 * 1024);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('download: cancelling deletes the partial file', async () => {
  const dir = tmp(), ctl = new AbortController();
  try {
    const chunks = [Buffer.alloc(1000, 1), Buffer.alloc(1000, 2), Buffer.alloc(1000, 3)];
    const slow = () => new Response(new ReadableStream({ async pull(c) { const x = chunks.shift(); if (!x) return c.close(); await new Promise((r) => setTimeout(r, 20)); c.enqueue(x); } }), { status: 200, headers: { 'content-length': '3000' } });
    const p = d.downloadToFile({ url: BASE + SETUP, dir, name: SETUP, fetchImpl: fakeFetch({ [BASE + SETUP]: slow }), fs, signal: ctl.signal, onProgress: () => ctl.abort() });
    await assert.rejects(p, { code: 'cancelled' });
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- starting the installer: only fakes, no real installer is ever started ----
function fakeSpawn(behaviour) {
  const calls = [];
  const fn = (file, args, opts) => {
    calls.push({ file, args, opts });
    const c = new EventEmitter(); c.unref = () => { c.unrefd = true; };
    setImmediate(() => c.emit(behaviour === 'error' ? 'error' : 'spawn', new Error('EACCES')));
    c.calls = calls; fn.child = c; return c;
  };
  fn.calls = calls; return fn;
}

test('launchInstaller spawns the file directly: no shell, no arguments, detached, no inherited streams, then unref', async () => {
  const dir = tmp();
  try {
    const f = path.join(dir, SETUP); fs.writeFileSync(f, 'x');
    const sp = fakeSpawn('spawn');
    const r = await d.launchInstaller({ file: f, dir, spawnImpl: sp, openFallback: async () => { throw new Error('not used'); }, fs });
    assert.deepEqual(r, { ok: true, how: 'spawn' });
    assert.equal(sp.calls.length, 1); assert.equal(sp.calls[0].file, f); assert.deepEqual(sp.calls[0].args, []);
    assert.equal(sp.calls[0].opts.shell, false); assert.equal(sp.calls[0].opts.detached, true); assert.equal(sp.calls[0].opts.stdio, 'ignore');
    assert.ok(sp.child.unrefd);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('launchInstaller falls back to the Windows shell when CreateProcess refuses (elevation), and reports a failure plainly', async () => {
  const dir = tmp();
  try {
    const f = path.join(dir, SETUP); fs.writeFileSync(f, 'x');
    const opened = [];
    let r = await d.launchInstaller({ file: f, dir, spawnImpl: fakeSpawn('error'), openFallback: async (x) => { opened.push(x); return ''; }, fs });
    assert.deepEqual(r, { ok: true, how: 'shell' }); assert.deepEqual(opened, [f]);
    r = await d.launchInstaller({ file: f, dir, spawnImpl: fakeSpawn('error'), openFallback: async () => 'blocked', fs });
    assert.deepEqual(r, { ok: false, code: 'failed' });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('launchInstaller refuses anything but our installer file inside the private folder', async () => {
  const dir = tmp(), other = tmp();
  try {
    const sp = fakeSpawn('spawn'); const run = (file) => d.launchInstaller({ file, dir, spawnImpl: sp, openFallback: async () => '', fs });
    fs.writeFileSync(path.join(dir, 'evil.exe'), 'x'); fs.writeFileSync(path.join(other, SETUP), 'x'); fs.mkdirSync(path.join(dir, 'KafkaBoost-Setup-2.0.0.exe'));
    for (const file of [path.join(dir, 'evil.exe'), path.join(other, SETUP), path.join(dir, SETUP) /* missing */, path.join(dir, 'KafkaBoost-Setup-2.0.0.exe') /* a folder */, '', null, path.join(dir, '..', path.basename(other), SETUP)])
      assert.deepEqual(await run(file), { ok: false, code: 'refused' }, String(file));
    assert.equal(sp.calls.length, 0, 'nothing was started');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(other, { recursive: true, force: true }); }
});
