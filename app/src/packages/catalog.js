'use strict';
const fs = require('fs');
const { validId, BREW_KINDS } = require('./ids');

// config/apps.json: the curated app list (per-OS ids) and the Windows bloatware allow-list.
// "ids" per app: win32 = winget id; darwin = { cask | formula }; linux = { flatpak, apt, dnf, pacman }.
// An OS or manager that is missing simply means the app is not offered there (never a guessed id).
const APPX = /^[A-Za-z0-9][A-Za-z0-9.]{1,79}$/;
const LINUX_MANAGERS = ['flatpak', 'apt', 'dnf', 'pacman'];

function loadCatalog(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

// Package ref { id, kind? } of an app for a platform + manager, or null when the app is not offered there.
function resolve(app, platform, manager) {
  const ids = (app && app.ids) || {};
  if (platform === 'win32' && manager === 'winget') return ids.win32 && validId('winget', ids.win32) ? { id: ids.win32 } : null;
  if (platform === 'darwin' && manager === 'brew') {
    const d = ids.darwin || {};
    if (d.cask && validId('brew', d.cask)) return { id: d.cask, kind: 'cask' };
    if (d.formula && validId('brew', d.formula)) return { id: d.formula, kind: 'formula' };
    return null;
  }
  if (platform === 'linux' && LINUX_MANAGERS.includes(manager)) {
    const id = (ids.linux || {})[manager];
    return id && validId(manager, id) ? { id } : null;
  }
  return null;
}

// Problems found in a catalog object (empty list = valid). Used by the unit tests.
function validateCatalog(cat) {
  const errors = [], seen = new Set();
  if (!cat || !Array.isArray(cat.apps) || !Array.isArray(cat.categories)) return ['apps/categories missing'];
  for (const a of cat.apps) {
    if (!a.id || !/^[a-z0-9-]+$/.test(a.id)) errors.push(`bad app id ${a.id}`);
    if (seen.has(a.id)) errors.push(`duplicate app id ${a.id}`);
    seen.add(a.id);
    if (!a.name) errors.push(`${a.id}: no name`);
    if (!a.desc) errors.push(`${a.id}: no description`);
    if (!cat.categories.includes(a.category)) errors.push(`${a.id}: unknown category ${a.category}`);
    const ids = a.ids || {};
    if (ids.win32 !== undefined && !validId('winget', ids.win32)) errors.push(`${a.id}: bad winget id`);
    if (ids.darwin !== undefined) {
      const d = ids.darwin;
      for (const k of Object.keys(d)) if (!BREW_KINDS.includes(k) || !validId('brew', d[k])) errors.push(`${a.id}: bad brew ${k}`);
    }
    if (ids.linux !== undefined) for (const [m, v] of Object.entries(ids.linux)) if (!LINUX_MANAGERS.includes(m) || !validId(m, v)) errors.push(`${a.id}: bad ${m} id`);
    if (!ids.win32 && !ids.darwin && !(ids.linux && Object.keys(ids.linux).length)) errors.push(`${a.id}: no id for any OS`);
  }
  const bseen = new Set();
  for (const b of cat.bloatware || []) {
    if (!/^[a-z0-9-]+$/.test(b.id || '')) errors.push(`bad bloat id ${b.id}`);
    if (bseen.has(b.id)) errors.push(`duplicate bloat id ${b.id}`);
    bseen.add(b.id);
    if (!APPX.test(b.appx || '')) errors.push(`${b.id}: bad appx name`);
  }
  return errors;
}

module.exports = { loadCatalog, resolve, validateCatalog, LINUX_MANAGERS, APPX };
