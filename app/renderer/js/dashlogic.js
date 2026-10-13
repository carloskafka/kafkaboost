'use strict';
// Pure logic of the Dashboard, shared by the page (window.KBDash) and the node tests. No DOM, no Electron.
// Everything here is computed from real data only (the tweaks-list step and the CPU health verdict): nothing is estimated or invented.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KBDash = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const REFRESH_MS = 2000;

  // The optimization level.
  //   items = every recommended tweak that is safe and available on this Windows build (status is not "unavailable")
  //           + one more item for the CPU thermal tuning, only when it applies to this PC (a supported CPU)
  //   done  = items that are really in place: tweak status "active" (a "partial" tweak does not count), and the CPU tuning only when
  //           it is set up AND the last health check says "ok"
  //   percent = round(100 * done / items); null when there is nothing to count.
  // tweaks: the list returned by tweaks-list. cpu: { applicable: bool, installed: bool, verdict: 'ok'|'warn'|'fail'|null }.
  function optimizationLevel(tweaks, cpu) {
    const rec = (Array.isArray(tweaks) ? tweaks : []).filter((x) => x && x.risk === 'safe' && x.recommended && x.status !== 'unavailable');
    const active = rec.filter((x) => x.status === 'active').length;
    const c = cpu || {};
    const cpuApplicable = !!c.applicable;
    const cpuOk = cpuApplicable && c.installed !== false && c.verdict === 'ok';
    const outOf = rec.length + (cpuApplicable ? 1 : 0);
    const done = active + (cpuOk ? 1 : 0);
    return {
      active, total: rec.length, cpuApplicable, cpuOk, done, outOf,
      percent: outOf ? Math.round((100 * done) / outOf) : null,
      todo: rec.filter((x) => x.status === 'inactive').map((x) => x.id)
    };
  }

  // Tile text. Missing values stay "–", never zero.
  function formatTile(kind, live) {
    if (!live) return '–';
    if (kind === 'temp') return live.packageTempC != null ? live.packageTempC + ' °C' : '–';
    if (kind === 'clock') return live.pClockMaxMHz != null ? (live.pClockMaxMHz / 1000).toFixed(2) + ' GHz' : '–';
    if (kind === 'power') return live.packagePowerW != null ? live.packagePowerW + ' W' : '–';
    return '–';
  }

  // "2026-10-12T22:41:03" -> "22:41:03" (the local time the script read the values), or '' when it is not a time.
  function clockTime(takenAt) {
    const m = /T(\d\d:\d\d:\d\d)/.exec(String(takenAt || ''));
    return m ? m[1] : '';
  }

  // Size like "1 TB" / "512 GB" from GB (decimal, as disk vendors print it).
  function formatSize(gb) {
    if (!(gb > 0)) return '';
    return gb >= 1000 ? (Math.round((gb / 1000) * 10) / 10) + ' TB' : Math.round(gb) + ' GB';
  }

  // What the tiles area says. reading: null before the first read | { failed: true } when the step failed | { available: bool }.
  // admin: whether KafkaBoost itself runs elevated (HWiNFO usually does, and a non-elevated process cannot open its shared memory).
  // hw: the hwinfo-state data when known (null/undefined = not known yet); ui: { iniConsent, busy } of the notice's own controls.
  //   live        values are shown, no notice
  //   pending     nothing read yet: dashes, no notice
  //   needsAdmin  unreadable and KafkaBoost is not elevated: "run as administrator" + restart button
  //   hwMissing   elevated, HWiNFO is not installed: points to the HWiNFO card (download flow)
  //   hwStopped   elevated, HWiNFO installed but not running: "Start HWiNFO" button; when its INI has shared memory off, the notice also
  //               carries the explicit consent box (maps to -UpdateIni; the start stays disabled until it is ticked)
  //   hwNoSm      elevated, HWiNFO is running but not sharing (Shared Memory Support is off): explanation only, nothing is started
  //   noSharing   elevated, state unknown or HWiNFO runs and shares (just started): generic text
  //   error       the read itself failed
  function tilesNotice(reading, admin, hw, ui) {
    const n = (state, key, extra) => Object.assign({ state, key, restart: false, start: false, iniOption: false, startEnabled: false }, extra);
    if (!reading) return n('pending', null);
    if (reading.failed) return n('error', 'dashboard.tiles.error');
    if (reading.available) return n('live', null);
    if (!admin) return n('needsAdmin', 'dashboard.tiles.needsAdmin', { restart: true });
    if (hw && typeof hw === 'object') {
      const u = ui || {};
      if (!hw.installed) return n('hwMissing', 'dashboard.tiles.hwMissing');
      if (!hw.running) {
        const iniOption = hw.ini === 'noSharedMemory';
        return n('hwStopped', iniOption ? 'dashboard.tiles.hwStoppedIni' : 'dashboard.tiles.hwStopped',
          { start: true, iniOption, startEnabled: !u.busy && (!iniOption || !!u.iniConsent) });
      }
      if (!hw.sharedMemory) return n('hwNoSm', 'dashboard.tiles.hwNoSm');
    }
    return n('noSharing', 'dashboard.tiles.noSharing');
  }

  return { REFRESH_MS, tilesNotice, optimizationLevel, formatTile, clockTime, formatSize };
});
