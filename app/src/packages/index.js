'use strict';
// The Apps manager back end: picks a package-manager provider for this OS, annotates the curated catalog with what is
// installed, and handles the export/import file. Nothing here touches Electron, so it is unit-tested with a fake runner.
const { defaultRunner } = require('./runner');
const { resolve, loadCatalog } = require('./catalog');
const { validId, validKind, validQuery } = require('./ids');
const { invalid } = require('./base');
const bloat = require('./bloat');
const makeWinget = require('./winget');
const makeBrew = require('./brew');
const linux = require('./linux');

const EXPORT_FORMAT = 1;
const MAX_IMPORT_BYTES = 1024 * 1024, MAX_IMPORT_ITEMS = 1000;

// Providers to try on a platform, in order of preference. On Linux flatpak comes first: one ids list that works on
// every distro and installs per user without root. The distro managers are used when flatpak is not there.
function candidates(platform, runner, isRoot) {
  if (platform === 'win32') return [makeWinget(runner)];
  if (platform === 'darwin') return [makeBrew(runner)];
  if (platform === 'linux') return [linux.flatpak(runner), linux.apt(runner, { isRoot }), linux.dnf(runner, { isRoot }), linux.pacman(runner, { isRoot })];
  return [];
}

function createService({ catalog, runner = defaultRunner, platform = process.platform, isRoot = false } = {}) {
  const providers = candidates(platform, runner, isRoot);
  let chosen, detected = false;

  async function detect() {
    if (detected) return chosen;
    detected = true; chosen = null;
    for (const p of providers) if (await p.available()) { chosen = p; break; }
    return chosen;
  }
  const info = async () => {
    const p = await detect();
    return { platform, manager: p ? p.name : null, label: p ? p.label : null, bloat: platform === 'win32' && (catalog.bloatware || []).length > 0 };
  };

  const key = (id) => String(id).toLowerCase();

  // The catalog for this OS: only apps that have an id for the active manager, each flagged installed or not.
  async function apps() {
    const p = await detect();
    if (!p) return { manager: null, apps: [] };
    const have = new Set((await p.list()).map((x) => key(x.id)));
    const list = [];
    for (const a of catalog.apps) {
      const ref = resolve(a, platform, p.name);
      if (ref) list.push({ appId: a.id, name: a.name, category: a.category, id: ref.id, kind: ref.kind || null, installed: have.has(key(ref.id)) });
    }
    return { manager: p.name, label: p.label, apps: list };
  }

  async function search(q) {
    const p = await detect();
    if (!p) return { ok: false, code: 'msg.apps.noManager', args: {}, message: 'No package manager found.' };
    if (!validQuery(q)) return { ok: false, code: 'msg.apps.badQuery', args: {}, message: 'Use letters, numbers, spaces and . _ + # - only.' };
    const have = new Set((await p.list()).map((x) => key(x.id)));
    const results = (await p.search(q)).map((r) => ({ id: r.id, kind: r.kind || null, name: r.name || r.id, version: r.version || '', summary: r.summary || '', installed: have.has(key(r.id)) }));
    return { ok: true, results };
  }

  // `ref` is { appId } (a catalog app, resolved here) or { id, kind } (a search result). Anything else is refused.
  function pick(p, ref) {
    if (ref && typeof ref.appId === 'string') {
      const a = catalog.apps.find((x) => x.id === ref.appId);
      const r = a && resolve(a, platform, p.name);
      return r || null;
    }
    if (ref && validId(p.name, ref.id) && validKind(p.name, ref.kind || undefined)) return { id: ref.id, kind: ref.kind || undefined };
    return null;
  }
  async function act(verb, ref) {
    const p = await detect();
    if (!p) return { ok: false, code: 'msg.apps.noManager', args: {}, message: 'No package manager found.' };
    const r = pick(p, ref);
    if (!r) return invalid(ref && (ref.appId || ref.id) || '');
    return p[verb](r.id, { kind: r.kind });
  }

  // ---- export / import ------------------------------------------------------------------------------------------
  async function exportData() {
    const p = await detect();
    if (!p) return null;
    const known = new Map();
    for (const a of catalog.apps) { const r = resolve(a, platform, p.name); if (r) known.set(key(r.id), a.id); }
    const packages = (await p.exportList()).map((x) => {
      const e = { id: x.id }; if (x.kind) e.kind = x.kind;
      if (known.has(key(x.id))) e.catalogId = known.get(key(x.id));
      return e;
    });
    return { app: 'KafkaBoost', format: EXPORT_FORMAT, exportedAt: new Date().toISOString(), platform, manager: p.name, packages };
  }

  // Parses an export file and decides what may be reinstalled here. An item is accepted when its catalogId is in the
  // curated catalog (mapped to this OS id, so a Windows list can be imported on Linux) or when its own id passes the
  // strict id check of the active manager. Everything else, and what is already installed, is only counted.
  async function planImport(text) {
    const p = await detect();
    if (!p) return { ok: false, code: 'msg.apps.noManager', args: {}, message: 'No package manager found.' };
    let data;
    try {
      if (typeof text !== 'string' || text.length > MAX_IMPORT_BYTES) throw new Error('size');
      data = JSON.parse(text);
    } catch { return { ok: false, code: 'msg.apps.badFile', args: {}, message: 'This is not a KafkaBoost app list.' }; }
    if (!data || data.app !== 'KafkaBoost' || data.format !== EXPORT_FORMAT || !Array.isArray(data.packages)) return { ok: false, code: 'msg.apps.badFile', args: {}, message: 'This is not a KafkaBoost app list.' };
    const have = new Set((await p.list()).map((x) => key(x.id)));
    const items = [], seen = new Set(); let skipped = 0, already = 0;
    for (const e of data.packages.slice(0, MAX_IMPORT_ITEMS)) {
      let r = null, name = '';
      if (e && typeof e.catalogId === 'string') {
        const a = catalog.apps.find((x) => x.id === e.catalogId);
        if (a) { r = resolve(a, platform, p.name); name = a.name; }
      }
      if (!r && e && validId(p.name, e.id) && validKind(p.name, e.kind || undefined)) {
        r = { id: e.id, kind: e.kind || undefined }; name = e.id;
        const a = catalog.apps.find((x) => { const q = resolve(x, platform, p.name); return q && key(q.id) === key(e.id); });
        if (a) name = a.name;
      }
      if (!r) { skipped++; continue; }
      if (have.has(key(r.id))) { already++; continue; }
      if (seen.has(key(r.id))) continue;
      seen.add(key(r.id)); items.push({ id: r.id, kind: r.kind || null, name });
    }
    skipped += Math.max(0, data.packages.length - MAX_IMPORT_ITEMS);
    return { ok: true, items, skipped, already };
  }

  async function runImport(items, onProgress) {
    const p = await detect();
    if (!p) return { ok: false, code: 'msg.apps.noManager', args: {}, message: 'No package manager found.', results: [] };
    const clean = (Array.isArray(items) ? items : []).filter((i) => i && validId(p.name, i.id) && validKind(p.name, i.kind || undefined)).map((i) => ({ id: i.id, kind: i.kind || undefined }));
    const results = await p.importList(clean, onProgress);
    const okCount = results.filter((r) => r.ok).length;
    return { ok: okCount === results.length, code: 'msg.apps.imported', args: { ok: okCount, failed: results.length - okCount }, message: `${okCount} installed, ${results.length - okCount} failed.`, results };
  }

  return {
    platform, detect, info, apps, search,
    install: (ref) => act('install', ref),
    uninstall: (ref) => act('uninstall', ref),
    exportData, planImport, runImport,
    bloatList: () => (platform === 'win32' ? bloat.bloatList(runner, catalog) : Promise.resolve([])),
    bloatRemove: (id) => (platform === 'win32' && typeof id === 'string' ? bloat.bloatRemove(runner, catalog, id) : Promise.resolve({ ok: false, code: 'msg.apps.invalidId', args: { id: '' }, message: 'Windows only.' }))
  };
}

module.exports = { createService, loadCatalog, EXPORT_FORMAT };
