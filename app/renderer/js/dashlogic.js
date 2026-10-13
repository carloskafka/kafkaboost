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
  //   live        values are shown, no notice
  //   pending     nothing read yet: dashes, no notice
  //   needsAdmin  unreadable and KafkaBoost is not elevated: "run as administrator" + restart button
  //   noSharing   unreadable although elevated: start HWiNFO / turn Shared Memory Support on (the HWiNFO card below)
  //   error       the read itself failed
  function tilesNotice(reading, admin) {
    if (!reading) return { state: 'pending', key: null, restart: false };
    if (reading.failed) return { state: 'error', key: 'dashboard.tiles.error', restart: false };
    if (reading.available) return { state: 'live', key: null, restart: false };
    if (!admin) return { state: 'needsAdmin', key: 'dashboard.tiles.needsAdmin', restart: true };
    return { state: 'noSharing', key: 'dashboard.tiles.noSharing', restart: false };
  }

  return { REFRESH_MS, tilesNotice, optimizationLevel, formatTile, clockTime, formatSize };
});
