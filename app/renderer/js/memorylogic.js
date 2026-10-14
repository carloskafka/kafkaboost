'use strict';
// Pure logic of the Memory page: what the live counters show (values, shares of installed memory and the stacked bar). Shared by the page
// (window.KBMemory) and the node tests. No DOM, no Electron. A counter Windows does not report is null and shown as a dash, never as 0.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rammaplogic'));
  else root.KBMemory = factory(root.KBRammap);
}(typeof self !== 'undefined' ? self : this, function (R) {
  const known = (v) => typeof v === 'number' && Number.isFinite(v);
  const pct = (v, total) => (known(v) && known(total) && total > 0 ? Math.max(0, Math.min(100, Math.round((v / total) * 1000) / 10)) : null);

  // sample: { totalBytes, availableBytes, freeBytes, standbyBytes, modifiedBytes } (any may be null) -> the cards and the bar segments.
  function model(sample) {
    const s = sample || {};
    const total = known(s.totalBytes) ? s.totalBytes : null;
    // "in use" is what is neither available nor waiting to be written: total - available - modified (needs all three)
    const inUse = known(total) && known(s.availableBytes) && known(s.modifiedBytes) ? Math.max(0, total - s.availableBytes - s.modifiedBytes) : null;
    const rows = [
      ['total', total], ['inUse', inUse], ['available', s.availableBytes], ['free', s.freeBytes], ['standby', s.standbyBytes], ['modified', s.modifiedBytes]
    ];
    return {
      hasData: rows.some(([, v]) => known(v)),
      cards: rows.map(([key, value]) => ({ key, value: R.formatBytes(value), pct: key === 'total' ? null : pct(value, total) })),
      segments: [['inUse', inUse], ['modified', s.modifiedBytes], ['standby', s.standbyBytes], ['free', s.freeBytes]]
        .map(([key, v]) => ({ key, pct: pct(v, total) || 0, known: known(v) }))
    };
  }

  // The page state for a memory watch state ({ status, last, history }).
  function screenModel(state) {
    const st = state || { status: 'idle', last: null, history: [] };
    return { running: st.status === 'running', failed: st.status === 'failed', waiting: st.status === 'running' && !st.last, ...model(st.last) };
  }

  return { model, screenModel };
}));
