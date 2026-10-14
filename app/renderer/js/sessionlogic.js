'use strict';
// Pure logic of the Dashboard "Play session" card, shared by the page (window.KBSession) and the node tests. No DOM, no Electron.
// Only what the recorder measured is shown; a missing sensor is "–", never 0, and throttle flags are never claimed.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KBSession = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

  function formatDuration(sec) {
    if (!isNum(sec) || sec < 0) return '–';
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
    const p = (n) => String(n).padStart(2, '0');
    return h ? `${h}h ${p(m)}m` : `${m}m ${p(s)}s`;
  }

  // stat = { peak, avg } from the PowerShell summary (or null when the sensor was never readable)
  function formatStat(stat, unit) {
    if (!stat || !isNum(stat.peak)) return null;
    return { peak: `${stat.peak} ${unit}`, avg: `${stat.avg} ${unit}` };
  }

  // Bytes as "12.3 GB" / "850 MB"; a missing value is null (the caller shows a dash), never 0.
  function bytesText(n) {
    if (!isNum(n) || n < 0) return null;
    return n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${Math.round(n / 1024 ** 2)} MB`;
  }

  // range = { min, max } in bytes from the PowerShell summary's `memory` part (or null when the counter was never readable)
  function formatRange(range) {
    if (!range || !isNum(range.min) || !isNum(range.max)) return null;
    return { low: bytesText(range.min), high: bytesText(range.max) };
  }

  function formatNow(last) {
    const f = (v, u) => (isNum(v) ? `${v} ${u}` : '–');
    return last ? { temp: f(last.tempC, '°C'), power: f(last.powerW, 'W'), clock: f(last.pClockMHz, 'MHz') } : { temp: '–', power: '–', clock: '–' };
  }

  // Which sentence describes the WHEA events logged during the session (rule 1: WHEA 19 -> do not deepen the undervolt).
  function wheaKey(whea) {
    if (!whea || !isNum(whea.count)) return { key: 'dashboard.session.wheaUnknown', args: {} };
    if (whea.has19) return { key: 'dashboard.session.whea19', args: { count: whea.count } };
    if (whea.count > 0) return { key: 'dashboard.session.wheaSome', args: { count: whea.count } };
    return { key: 'dashboard.session.wheaNone', args: {} };
  }

  function pctText(p) { return isNum(p) ? `${p}%` : '–'; }

  // 'idle' | 'running' | 'done' | 'failed' of the main-process state; the UI never invents a state
  function view(state) {
    if (!state) return 'idle';
    return ['running', 'done', 'failed'].includes(state.status) ? state.status : 'idle';
  }

  return { formatDuration, formatStat, formatRange, bytesText, formatNow, wheaKey, pctText, view };
});
