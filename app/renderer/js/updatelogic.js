'use strict';
// Pure model of the update panel (Settings result and the changelog dialog), shared by the page (window.KBUpdateLogic) and the node tests.
// Given the check result `r` (from main.js checkUpdate) and the UI state `st`, it says which buttons and which messages to show.
//
//   r:  { newer, canInstall, mode: 'auto' | 'download' | 'manual', explain: [i18n keys], installer: { name, size } | null, checksum: bool, url }
//   st: { phase, percent }
//       phase: idle | downloading | ready | verified | nochecksum | mismatch | error | cancelled | declined | installing | launchFailed
//
// Buttons: install (installed build: download through the updater), restart (installed build: restart and update), download (download and
// install from a clone / portable copy), cancel, folder (show the downloaded file), release (open the release page).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KBUpdateLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function formatSize(bytes) {
    const n = Number(bytes) || 0;
    if (n >= 1048576) return (n / 1048576).toFixed(n >= 104857600 ? 0 : 1) + ' MB';
    if (n >= 1024) return Math.round(n / 1024) + ' KB';
    return n + ' B';
  }

  function model(r, st) {
    const phase = (st && st.phase) || 'idle';
    const percent = (st && st.percent) || 0;
    const auto = !!r.canInstall;
    const out = { buttons: [], status: null, explain: auto ? [] : (Array.isArray(r.explain) ? r.explain : []), progress: phase === 'downloading' ? percent : null };
    const s = (kind, key, vars) => { out.status = { kind, key, vars: vars || {} }; };

    if (phase === 'downloading') {
      s('warn', 'update.downloading', { percent });
      out.buttons = auto ? [] : ['cancel'];
      return out;
    }
    if (phase === 'installing') { s('warn', 'update.starting'); return out; }
    if (auto) {
      if (phase === 'ready') { s('ok', 'update.readyRestart'); out.buttons = ['restart']; return out; }
      if (phase === 'error') { s('fail', 'update.installFailed'); out.buttons = ['install', 'release']; return out; }
      out.buttons = ['install'];
      return out;
    }
    if (r.mode === 'download' && r.installer) {
      out.buttons = ['download', 'release'];
      if (phase === 'nochecksum') { s('warn', 'update.noChecksum'); out.buttons = ['folder', 'release']; }
      else if (phase === 'mismatch') s('fail', 'update.mismatch');
      else if (phase === 'error') s('fail', 'update.downloadFailed');
      else if (phase === 'cancelled') s('warn', 'update.cancelled');
      else if (phase === 'declined') s('warn', 'update.declined');
      else if (phase === 'launchFailed') s('fail', 'update.launchFailed');
      return out;
    }
    out.buttons = ['release'];         // no installer attached to the release: only the explanation and the release page
    return out;
  }

  return { model, formatSize };
});
