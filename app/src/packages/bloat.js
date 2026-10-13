'use strict';
const { APPX } = require('./catalog');
const { lines } = require('./base');

// Windows only: removes pre-installed (inbox) Store apps, but ONLY packages named in the fixed allow-list of
// config/apps.json (`bloatware`). The renderer sends an allow-list id, never a package name; the name that reaches
// PowerShell comes from the catalog and is checked against a strict pattern first. It removes the app for the
// current user only (no -AllUsers, nothing provisioned is touched) and each app can be installed again from the Store.
const PS = (script) => ['powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script]];
const entries = (catalog) => (catalog.bloatware || []).filter((b) => APPX.test(b.appx || ''));

async function installedSet(runner, catalog) {
  const names = entries(catalog).map((b) => `'${b.appx}'`).join(',');
  if (!names) return new Set();
  const [cmd, args] = PS(`Get-AppxPackage | Where-Object { @(${names}) -contains $_.Name } | ForEach-Object { $_.Name }`);
  const res = await runner(cmd, args, { timeout: 60000 });
  return new Set(lines(res.stdout).map((l) => l.trim()).filter((l) => APPX.test(l)));
}

async function bloatList(runner, catalog) {
  const present = await installedSet(runner, catalog);
  return entries(catalog).filter((b) => present.has(b.appx)).map((b) => ({ id: b.id, appx: b.appx }));
}

async function bloatRemove(runner, catalog, id) {
  const b = entries(catalog).find((x) => x.id === id);
  if (!b) return { ok: false, code: 'msg.apps.invalidId', args: { id: String(id).slice(0, 60) }, message: 'Not on the removal list.' };
  const [cmd, args] = PS(`Get-AppxPackage -Name '${b.appx}' | Remove-AppxPackage -ErrorAction Stop`);
  const res = await runner(cmd, args, { timeout: 5 * 60 * 1000 });
  if (res.code === 0 && !res.error) return { ok: true, code: 'msg.apps.removed', args: { id: b.appx }, message: `${b.appx} removed.` };
  return { ok: false, code: 'msg.apps.failed', args: { id: b.appx, exit: res.code }, message: `Could not remove ${b.appx}.`, detail: String(res.stderr || '').trim().slice(0, 240) };
}

module.exports = { bloatList, bloatRemove, entries };
