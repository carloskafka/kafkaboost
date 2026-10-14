'use strict';
// Pure logic of the Dashboard "Boost clock advice" card (window.KBAdvice), shared with the node tests. No DOM, no Electron.
// The advice comes from the PowerShell `advice` step; this only picks the sentence. It never says "stable" and never applies anything.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KBAdvice = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const KNOWN = {
    notEnough: ['fewSessions', 'noSensors', 'noCap'],
    hold: ['whea', 'hot', 'marginal', 'notCapBound', 'powerBound'],
    raise: ['headroom'],
    lowerCheck: ['whea19']
  };

  // data = the `advice` step result data; returns { key, args, kind } or null when it cannot be read
  function describe(data) {
    if (!data || !KNOWN[data.verdict] || !KNOWN[data.verdict].includes(data.reason)) return null;
    const ev = data.evidence || {};
    const args = { cap: data.capRatio, next: data.suggestedRatio, loaded: data.loadedSessions, needed: data.needed, temp: ev.maxTempC, clock: ev.maxPClockMHz, power: ev.avgPowerW };
    const kind = data.verdict === 'raise' ? 'ok' : data.verdict === 'lowerCheck' ? 'fail' : 'warn';
    return { key: `dashboard.advice.${data.verdict}.${data.reason}`, args, kind };
  }

  // The numbers behind the advice, only when the engine had them (never invented)
  function evidence(data) {
    const ev = data && data.evidence;
    if (!ev || ![ev.maxTempC, ev.maxPClockMHz, ev.avgPowerW].every(isNum)) return null;
    return { loaded: data.loadedSessions, temp: ev.maxTempC, clock: ev.maxPClockMHz, power: ev.avgPowerW };
  }

  return { describe, evidence, KNOWN };
});
