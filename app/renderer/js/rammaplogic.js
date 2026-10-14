'use strict';
// Pure logic of the RAMMap (memory cleanup) screen: number formatting, what each part shows and which buttons are enabled for the data
// returned by the rammap-state / rammap-history steps. Shared by the page (window.KBRammap) and the node tests. No DOM, no Electron.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KBRammap = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const GB = 1024 * 1024 * 1024;
  const MB = 1024 * 1024;

  // Bytes as "12.3 GB" / "850 MB"; a missing value (null/undefined/NaN) is "—", never "0".
  function formatBytes(n) {
    if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
    const v = Math.abs(Number(n));
    if (v >= GB) return (Number(n) / GB).toFixed(1) + ' GB';
    return Math.round(Number(n) / MB) + ' MB';
  }

  // Signed difference ("+1.2 GB", "-850 MB"); missing stays "—". Zero is shown as "0 MB" because we did measure it.
  function formatDelta(n) {
    if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
    const s = formatBytes(n);
    return Number(n) > 0 ? '+' + s : (Number(n) < 0 ? '-' + s.replace(/^-/, '') : s);
  }

  // What the card shows. `state` is the rammap-state data ({ state, memory, actions, ... }), `busy` is true while a step runs.
  function screenModel(data, busy) {
    const st = data && data.state ? data.state : null;
    const installed = !!(st && st.installed);
    const signerOk = !!(st && st.signerOk);
    const actions = (data && Array.isArray(data.actions) ? data.actions : []).map((a) => ({
      id: a.id, risk: a.risk, switch: a.switch,
      titleKey: 'rammap.action.' + a.id + '.title', descKey: 'rammap.action.' + a.id + '.desc',
      enabled: installed && signerOk && !busy
    }));
    return {
      installed, signerOk,
      showDownload: !installed,
      showActions: installed,
      badSignature: installed && !signerOk,
      downloadEnabled: !installed && !busy,
      actions
    };
  }

  // Rows of the live memory table; every value may be missing.
  function memoryRows(mem) {
    const m = mem || {};
    return [
      { key: 'total', value: formatBytes(m.totalBytes) },
      { key: 'available', value: formatBytes(m.availableBytes) },
      { key: 'free', value: formatBytes(m.freeBytes) },
      { key: 'standby', value: formatBytes(m.standbyBytes) },
      { key: 'modified', value: formatBytes(m.modifiedBytes) }
    ];
  }

  // One history record -> the cells of a table row (time is shown in the viewer's locale by the page).
  function historyRow(rec) {
    const d = (rec && rec.delta) || {};
    return {
      time: rec && rec.time ? String(rec.time) : '',
      action: rec && rec.action ? String(rec.action) : '',
      available: formatDelta(d.availableBytes),
      standby: formatDelta(d.standbyBytes),
      modified: formatDelta(d.modifiedBytes),
      free: formatDelta(d.freeBytes)
    };
  }

  // Totals over the history: how many cleans ran and how much standby memory was released in all (only cleans that measured it).
  function totals(history) {
    const list = Array.isArray(history) ? history : [];
    let released = 0, measured = 0;
    for (const r of list) {
      const s = r && r.delta ? r.delta.standbyBytes : null;
      if (s !== null && s !== undefined && Number.isFinite(Number(s))) { measured++; if (Number(s) < 0) released += -Number(s); }
    }
    return { runs: list.length, measured, releasedStandbyBytes: released };
  }

  return { formatBytes, formatDelta, screenModel, memoryRows, historyRow, totals };
}));
