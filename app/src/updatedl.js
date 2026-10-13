'use strict';
// Download and install of a new version for copies that cannot update themselves (a source clone or the portable exe).
// Pure Node (no Electron): every effect goes through a seam (fetch, fs, spawn), so it is unit tested with fakes and no real installer
// is ever started by a test.
//
// Rules (also in AGENTS.md rule 14 and docs/ARCHITECTURE.md):
//   * https only; the first address must be a release asset of THIS repository on github.com, every redirect hop must stay on github.com
//     (same repo path) or on GitHub's release CDN hosts; anything else is refused.
//   * the file goes to a private folder (<temp>/KafkaBoost-update), never to Downloads, under a temp name (.part) and is renamed when whole.
//   * the SHA-256 is checked against the release's SHA256SUMS.txt. A mismatch deletes the file. Without a checksum file the installer is
//     NEVER started by the app.
//   * the installer is started only after an explicit confirmation in the UI, only from that folder, only a file named like our installer.
const path = require('path');
const crypto = require('crypto');

const REPO_PATH = '/carloskafka/legion-14900hx-throttlestop/releases/download/';
const CDN_HOSTS = new Set(['objects.githubusercontent.com', 'release-assets.githubusercontent.com', 'github-releases.githubusercontent.com']);
const MAX_INSTALLER_BYTES = 300 * 1024 * 1024;
const MAX_SUMS_BYTES = 256 * 1024;
const DIR_NAME = 'KafkaBoost-update';
const SETUP_RE = /^KafkaBoost-Setup-(\d+\.\d+\.\d+)\.exe$/;
const CLEANABLE_RE = /^(KafkaBoost-Setup-\d+\.\d+\.\d+\.exe(\.part)?|SHA256SUMS\.txt(\.part)?)$/;

const parse = (u) => { try { return new URL(String(u)); } catch { return null; } };
const plainHttps = (x) => !!x && x.protocol === 'https:' && !x.username && !x.password && (x.port === '' || x.port === '443');

// First address: a release asset of this repository on github.com.
function isReleaseAssetUrl(u) {
  const x = parse(u);
  return plainHttps(x) && x.hostname === 'github.com' && x.pathname.startsWith(REPO_PATH) && x.pathname.length > REPO_PATH.length;
}
// A redirect hop: the same, or one of GitHub's release CDN hosts.
function isAllowedHop(u) {
  const x = parse(u);
  return isReleaseAssetUrl(u) || (plainHttps(x) && CDN_HOSTS.has(x.hostname));
}

// GitHub API assets -> the installer (Setup exe of exactly this version) and the checksum file. URLs that fail the check count as absent.
function pickAssets(assets, version) {
  const list = Array.isArray(assets) ? assets : [];
  const ok = (a) => a && typeof a.name === 'string' && isReleaseAssetUrl(a.browser_download_url);
  const inst = list.find((a) => ok(a) && a.name === `KafkaBoost-Setup-${version}.exe` && SETUP_RE.test(a.name));
  const sums = list.find((a) => ok(a) && a.name === 'SHA256SUMS.txt');
  return {
    installer: inst ? { name: inst.name, url: inst.browser_download_url, size: Number(inst.size) || 0 } : null,
    checksums: sums ? { name: sums.name, url: sums.browser_download_url } : null
  };
}

// "<64 hex>  <name>" lines (sha256sum / Get-FileHash output as written by release.yml) -> Map name -> lowercase hex.
function parseChecksums(text) {
  const m = new Map();
  for (const line of String(text || '').replace(/\r/g, '').split('\n')) {
    const x = /^([0-9a-fA-F]{64})\s+\*?(\S.*?)\s*$/.exec(line);
    if (x) m.set(x[2], x[1].toLowerCase());
  }
  return m;
}
// 'ok' | 'mismatch' | 'missing' (no line for that file, or no checksum text at all)
function verifyChecksum(sumsText, name, actualHex) {
  const want = parseChecksums(sumsText).get(name);
  if (!want) return 'missing';
  return want === String(actualHex || '').toLowerCase() ? 'ok' : 'mismatch';
}

// Which way this copy updates. canSelf -> electron-updater; else with an installer asset -> download and install; else only the release page.
function decide({ canSelf, installer }) {
  if (canSelf) return { mode: 'auto', explain: [] };
  if (installer) return { mode: 'download', explain: ['update.why.source', 'update.why.clone'] };
  return { mode: 'manual', explain: ['update.why.source', 'update.why.noInstaller', 'update.why.clone'] };
}

// ---- the private folder --------------------------------------------------------------------------------------------
const updateDir = (tempRoot) => path.join(tempRoot, DIR_NAME);
// Direct children of the private folder only, no matter how the path is spelled.
function insideDir(dir, file) {
  const rel = path.relative(path.resolve(dir), path.resolve(file));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel) && !rel.includes(path.sep);
}
const isCleanableName = (n) => CLEANABLE_RE.test(String(n));

// Removes leftovers of earlier runs: plain files (never links, never folders) with our names, last changed before this run started.
// Returns the names it deleted. Locked files (an installer still running) are skipped silently.
function cleanupDir(dir, startedAtMs, fs) {
  const gone = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return gone; }
  for (const e of entries) {
    if (!e.isFile() || !isCleanableName(e.name)) continue;      // isFile() is false for symlinks and folders
    const f = path.join(dir, e.name);
    try {
      const st = fs.lstatSync(f);
      if (!st.isFile() || st.mtimeMs >= startedAtMs) continue;
      fs.unlinkSync(f); gone.push(e.name);
    } catch { /* in use or already gone */ }
  }
  return gone;
}

// ---- network ----------------------------------------------------------------------------------------------------------
// Follows redirects by hand so every hop can be checked. `fetchImpl(url, { redirect: 'manual', signal, headers })` -> Response-like.
async function fetchFollow(url, { fetchImpl, signal, maxHops = 5 }) {
  let cur = url;
  for (let hop = 0; hop <= maxHops; hop++) {
    if (hop === 0 ? !isReleaseAssetUrl(cur) : !isAllowedHop(cur)) throw Object.assign(new Error('blocked address'), { code: 'blocked' });
    const res = await fetchImpl(cur, { redirect: 'manual', signal, headers: { 'User-Agent': 'KafkaBoost', Accept: 'application/octet-stream' } });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      const next = loc && parse(new URL(loc, cur).href);
      if (!next) throw Object.assign(new Error('bad redirect'), { code: 'blocked' });
      try { if (res.body && res.body.cancel) await res.body.cancel(); } catch { /* ignore */ }
      cur = next.href; continue;
    }
    if (res.status !== 200) throw Object.assign(new Error('HTTP ' + res.status), { code: 'http' });
    return res;
  }
  throw Object.assign(new Error('too many redirects'), { code: 'blocked' });
}

async function fetchText(url, { fetchImpl, signal }) {
  const res = await fetchFollow(url, { fetchImpl, signal });
  const len = Number(res.headers.get('content-length'));
  if (len > MAX_SUMS_BYTES) throw Object.assign(new Error('too large'), { code: 'toolarge' });
  const text = await res.text();
  if (text.length > MAX_SUMS_BYTES) throw Object.assign(new Error('too large'), { code: 'toolarge' });
  return text;
}

// Streams the file into <dir>/<name>.part, hashing as it goes, and renames it to <name> when whole. Cancel (signal) and every error delete
// the .part file. Resolves { file, sha256, bytes }.
async function downloadToFile({ url, dir, name, maxBytes = MAX_INSTALLER_BYTES, fetchImpl, signal, onProgress = () => {}, fs }) {
  if (!SETUP_RE.test(name)) throw Object.assign(new Error('bad file name'), { code: 'blocked' });
  fs.mkdirSync(dir, { recursive: true });
  const part = path.join(dir, name + '.part'), final = path.join(dir, name);
  try { fs.unlinkSync(part); } catch { /* none */ }
  let fd = null;
  try {
    const res = await fetchFollow(url, { fetchImpl, signal });
    const total = Number(res.headers.get('content-length')) || 0;
    if (total > maxBytes) throw Object.assign(new Error('too large'), { code: 'toolarge' });
    const hash = crypto.createHash('sha256');
    fd = fs.openSync(part, 'w');
    let got = 0;
    const reader = res.body.getReader();
    for (;;) {
      if (signal && signal.aborted) throw Object.assign(new Error('cancelled'), { code: 'cancelled' });
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      if (got > maxBytes) throw Object.assign(new Error('too large'), { code: 'toolarge' });
      hash.update(value); fs.writeSync(fd, value);
      onProgress(total ? Math.min(100, Math.floor((got / total) * 100)) : 0, got);
    }
    if (total && got !== total) throw Object.assign(new Error('incomplete'), { code: 'incomplete' });
    fs.closeSync(fd); fd = null;
    try { fs.unlinkSync(final); } catch { /* none */ }
    fs.renameSync(part, final);
    return { file: final, sha256: hash.digest('hex'), bytes: got };
  } catch (e) {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* ignore */ } }
    try { fs.unlinkSync(part); } catch { /* ignore */ }
    if (signal && signal.aborted && e.code !== 'cancelled') e.code = 'cancelled';
    throw e;
  }
}

// The whole fetch-and-verify flow. Resolves { state, file?, name } with state one of
//   'verified'    checksum matches (safe to offer the install confirmation)
//   'nochecksum'  no SHA256SUMS.txt in the release, or no line for the file: the file is kept, the app will NOT start it
//   'mismatch'    wrong checksum: the file is deleted
// and throws (code: blocked | http | toolarge | incomplete | cancelled | ...) when the download itself fails.
async function fetchAndVerify({ installer, checksums, dir, fetchImpl, signal, onProgress, fs }) {
  let sumsText = null;
  if (checksums) { try { sumsText = await fetchText(checksums.url, { fetchImpl, signal }); } catch (e) { if (e.code === 'cancelled' || (signal && signal.aborted)) throw Object.assign(e, { code: 'cancelled' }); sumsText = null; } }
  const r = await downloadToFile({ url: installer.url, dir, name: installer.name, fetchImpl, signal, onProgress, fs });
  const v = sumsText === null ? 'missing' : verifyChecksum(sumsText, installer.name, r.sha256);
  if (v === 'mismatch') { try { fs.unlinkSync(r.file); } catch { /* ignore */ } return { state: 'mismatch', name: installer.name }; }
  return { state: v === 'ok' ? 'verified' : 'nochecksum', file: r.file, name: installer.name };
}

// ---- starting the installer ----------------------------------------------------------------------------------------
// Never called without the user's confirmation (main.js asks the page for it). Spawns the file directly: an args array, no shell,
// detached, no inherited streams. `spawnImpl` and `openFallback` are seams (tests never start anything real).
// Resolves { ok, how: 'spawn' | 'shell' } or { ok:false, code }.
function launchInstaller({ file, dir, spawnImpl, openFallback, fs }) {
  return new Promise((resolve) => {
    let st = null;
    try { st = fs.lstatSync(file); } catch { /* missing */ }
    if (!file || !insideDir(dir, file) || !SETUP_RE.test(path.basename(file)) || !st || !st.isFile()) return resolve({ ok: false, code: 'refused' });
    let child;
    try { child = spawnImpl(file, [], { detached: true, stdio: 'ignore', shell: false, windowsHide: false }); } catch { child = null; }
    const viaShell = async () => { try { const err = await openFallback(file); resolve(err ? { ok: false, code: 'failed' } : { ok: true, how: 'shell' }); } catch { resolve({ ok: false, code: 'failed' }); } };
    if (!child) return void viaShell();
    let settled = false;
    child.once('error', () => { if (settled) return; settled = true; viaShell(); });       // e.g. the installer asks for elevation and CreateProcess refuses
    child.once('spawn', () => { if (settled) return; settled = true; try { child.unref(); } catch { /* ignore */ } resolve({ ok: true, how: 'spawn' }); });
  });
}

module.exports = {
  REPO_PATH, CDN_HOSTS, MAX_INSTALLER_BYTES, MAX_SUMS_BYTES, DIR_NAME,
  isReleaseAssetUrl, isAllowedHop, pickAssets, parseChecksums, verifyChecksum, decide,
  updateDir, insideDir, isCleanableName, cleanupDir,
  fetchFollow, fetchText, downloadToFile, fetchAndVerify, launchInstaller
};
