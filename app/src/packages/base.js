'use strict';
const { validId, validKind, validQuery } = require('./ids');

// Helpers shared by every provider.
const lines = (text) => String(text || '').split('\n').map((l) => l.replace(/\r$/, '').split('\r').pop());
const tail = (res) => String(res.stderr || res.stdout || '').trim().split('\n').slice(-3).join(' ').slice(0, 240);

// Result of an install/uninstall command. `okCodes` are exit codes that count as success (already installed, ...).
function actionResult(res, verb, id, extra = {}) {
  const okCodes = extra.okCodes || [0];
  if (res.error === 'ENOENT') return { ok: false, code: 'msg.apps.noManager', args: {}, message: 'The package manager was not found.' };
  if (res.error === 'TIMEOUT') return { ok: false, code: 'msg.apps.timeout', args: { id }, message: `${verb} of ${id} timed out.` };
  if (extra.denied && extra.denied.includes(res.code)) return { ok: false, code: 'msg.apps.authFailed', args: { id }, message: 'Administrator approval was cancelled or refused.' };
  if (okCodes.includes(res.code >>> 0) || okCodes.includes(res.code)) {
    if (extra.already && extra.already.includes(res.code >>> 0)) return { ok: true, code: 'msg.apps.already', args: { id }, message: `${id} is already installed.` };
    return { ok: true, code: verb === 'install' ? 'msg.apps.installed' : 'msg.apps.removed', args: { id }, message: `${id}: done.` };
  }
  return { ok: false, code: 'msg.apps.failed', args: { id, exit: res.code }, message: `${verb} of ${id} failed (exit ${res.code}).`, detail: tail(res) };
}

const invalid = (id) => ({ ok: false, code: 'msg.apps.invalidId', args: { id: String(id).slice(0, 60) }, message: 'Not a valid package id.' });

// Wraps the per-manager pieces into the one provider interface:
//   name, label, available(), list(), search(q), install(id, {kind}), uninstall(id, {kind}), exportList(), importList(items, onProgress)
// spec: { name, label, probe(), list(), search(q), installCmd(id, kind), uninstallCmd(id, kind), install/uninstall result options }
function makeProvider(spec, runner) {
  const p = {
    name: spec.name, label: spec.label, kinds: spec.name === 'brew',
    async available() { const r = await spec.probe(runner); return r.code === 0 && !r.error; },
    list: () => spec.list(runner),
    async search(q) { return validQuery(q) ? spec.search(runner, q.trim()) : []; },
    async install(id, opts = {}) {
      if (!validId(spec.name, id) || !validKind(spec.name, opts.kind)) return invalid(id);
      if (spec.before) { const b = await spec.before(runner); if (b) return b; }
      const [cmd, args] = spec.installCmd(id, opts.kind);
      return actionResult(await runner(cmd, args), 'install', id, spec.installResult);
    },
    async uninstall(id, opts = {}) {
      if (!validId(spec.name, id) || !validKind(spec.name, opts.kind)) return invalid(id);
      const [cmd, args] = spec.uninstallCmd(id, opts.kind);
      return actionResult(await runner(cmd, args), 'uninstall', id, spec.uninstallResult);
    },
    async exportList() { return p.list(); },
    // Installs one item after the other; a failure does not stop the rest. Returns [{ id, ...result }].
    async importList(items, onProgress = () => {}) {
      const out = [];
      for (const it of items) {
        const r = await p.install(it.id, { kind: it.kind });
        out.push({ id: it.id, ...r }); onProgress(out.length, items.length, it.id, r);
      }
      return out;
    }
  };
  return p;
}

module.exports = { lines, tail, actionResult, invalid, makeProvider };
