'use strict';
// Sensors: live temperatures, clocks, voltages, power, fans and load read by LibreHardwareMonitor (downloaded on demand, after the
// user agrees). The page refreshes every ~2 s only while it is the visible screen and the window is visible, can be paused, and can
// copy or save the current snapshot as JSON. Values are written with textContent only. Min/max are tracked here, over the readings
// this page has seen (the library is restarted for every read, so its own min/max would only cover a fraction of a second).
(function () {
  const { $, t } = KB;
  const L = window.KBSensors;
  const LIMIT = 8;                                    // rows per type before "Show all"
  const DRIVER_DIR = '%ProgramData%\\LegionTuning\\sensors';

  let state = null;                                   // sensors-state data: { installed, version, name, sizeBytes, ... }
  let data = null;                                    // last snapshot data
  let lastCode = '';
  let active = false, paused = false, gen = 0, timer = null, busy = false;
  let track = new Map();                              // sensor key -> { min, max } seen by this page
  let trackSince = new Date();
  let expanded = new Set();                           // hardware keys with "Show all" on
  let sig = '', cells = new Map();                    // structure signature of what is drawn, and key -> value cells for in-place updates

  const tr = (key, fallback) => (KB.dict[key] ?? KB.fallback[key]) !== undefined ? t(key) : fallback;
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
  const locale = () => (KB.lang === 'pt-BR' ? 'pt-BR' : 'en');

  // ---- consent / download -----------------------------------------------------------------------------------------
  function renderGet() {
    if (!state) return;
    const mb = Math.round((state.sizeBytes / 1048576) * 10) / 10;
    $('sensorsGetWhat').textContent = t('sensors.get.what', { name: state.name, version: state.version, license: state.license });
    $('sensorsGetDetails').textContent = t('sensors.get.details', { mb, dir: DRIVER_DIR });
    $('sensorsConsentText').textContent = t('sensors.get.consent', { version: state.version });
    const admin = !!(KB.state.info && KB.state.info.isAdmin);
    $('sensorsGetNote').textContent = admin ? '' : t('sensors.get.needsAdmin');
    $('sensorsGetBtn').disabled = busy || !admin || !$('sensorsConsent').checked;
    $('sensorsConsent').disabled = busy;
  }

  async function getSupport() {
    if (busy || !$('sensorsConsent').checked) return;
    busy = true; renderGet();
    KB.showResult($('sensorsResult'), 'warn', t('sensors.get.working'));
    const res = await window.kb.runStep('sensors-get', {});
    busy = false;
    if (!res.ok) { KB.showResult($('sensorsResult'), 'fail', KB.message(res) || t('common.failed')); renderGet(); return; }
    KB.showResult($('sensorsResult'), '', '');
    await loadState();
  }

  // ---- state ------------------------------------------------------------------------------------------------------
  async function loadState() {
    const res = await window.kb.runStep('sensors-state', {});
    if (!res.ok || !res.data) { KB.showResult($('sensorsResult'), 'fail', KB.message(res) || t('common.failed')); return; }
    state = res.data;
    const ready = !!state.installed;
    $('sensorsGet').hidden = ready; $('sensorsMain').hidden = !ready; $('sensorsDriver').hidden = false;
    if (ready) { if (active) start(); } else renderGet();
  }

  // ---- reading loop -----------------------------------------------------------------------------------------------
  const canRun = () => active && !paused && !document.hidden;
  function schedule() { clearTimeout(timer); if (canRun()) timer = setTimeout(readOnce, L.REFRESH_MS); }
  function start() { gen++; clearTimeout(timer); readOnce(); }
  function stop() { gen++; clearTimeout(timer); }

  async function readOnce() {
    const my = gen;
    KB.sensorReads = (KB.sensorReads || 0) + 1;      // read counter (the UI test checks that polling stops when the screen is left)
    const res = await window.kb.runStep('sensors-read', {});
    if (my !== gen) return;                           // the screen was left, paused or restarted meanwhile
    if (apply(res) && !paused) schedule();
  }

  function hardFail(res) {
    paused = true; stop(); updateControls();
    KB.showResult($('sensorsResult'), 'fail', KB.message(res) || t('common.failed'));
  }

  function apply(res) {
    if (res.code === 'msg.sensors.missing') { stop(); state = state || {}; state.installed = false; loadState(); return false; }
    if (!res.data || !Array.isArray(res.data.groups) || !res.ok) { hardFail(res); return false; }
    KB.showResult($('sensorsResult'), '', '');
    data = res.data; lastCode = res.code || '';
    for (const g of data.groups) for (const h of g.hardware) {
      const seen = new Map();
      for (const s of h.sensors) {
        const base = `${g.id}|${h.name}|${s.type}|${s.name}`; const n = seen.get(base) || 0; seen.set(base, n + 1);
        s.key = `${base}|${n}`;
        const tk = track.get(s.key);
        if (!tk) track.set(s.key, { min: s.value, max: s.value }); else { tk.min = Math.min(tk.min, s.value); tk.max = Math.max(tk.max, s.value); }
      }
    }
    render();
    return true;
  }

  // ---- drawing ----------------------------------------------------------------------------------------------------
  function typeLabel(type) { return tr(`sensors.type.${type}`, type); }

  function notices() {
    const host = $('sensorsNotices'); host.textContent = '';
    const add = (kind, text, withRestart) => {
      const d = el('div', 'result ' + kind); d.append(el('span', '', text));
      if (withRestart) { const b = el('button', 'btn small', t('banner.restart')); b.type = 'button'; b.addEventListener('click', () => window.kb.relaunchAdmin()); d.append(' ', b); }
      host.append(d);
    };
    if (lastCode === 'msg.sensors.needsAdmin') add('warn', t('sensors.notice.needsAdmin'), true);
    if (data && (data.pawnio === false || lastCode === 'msg.sensors.noCpuTemp')) add('warn', t('sensors.notice.noDriver'));
  }

  function updateControls() {
    $('sensorsPause').textContent = paused ? t('sensors.resume') : t('sensors.pause');
    $('sensorsDemo').hidden = !(data && data.demo);
  }

  function status() {
    if (!data) { $('sensorsStatus').textContent = t('sensors.loading'); return; }
    const count = data.count;
    const time = new Date().toLocaleTimeString(locale());
    $('sensorsStatus').textContent = (paused ? t('sensors.pausedAt', { time }) : t('sensors.updated', { time })) + ' · ' + t('sensors.count', { count }) + ' · ' + data.source;
  }

  function cellsFor(s, row) {
    const v = el('span', 'sval'), mn = el('span', 'smin'), mx = el('span', 'smax');
    row.append(el('span', 'sname', s.name), v, mn, mx);
    cells.set(s.key, { row, v, mn, mx, s });
  }

  function fill(s) {
    const c = cells.get(s.key); if (!c) return;
    const tk = track.get(s.key) || { min: s.value, max: s.value };
    const level = s.type === 'Temperature' ? L.tempLevel(s.value) : 'ok';
    c.v.textContent = L.formatValue(s.value, s.unit, locale()) + (level === 'ok' ? '' : ' · ' + t(`sensors.level.${level}`));
    c.mn.textContent = L.formatValue(tk.min, s.unit, locale()); c.mx.textContent = L.formatValue(tk.max, s.unit, locale());
    c.row.className = 'srow' + (level === 'ok' ? '' : ' t-' + level);
  }

  function render() {
    updateControls(); status(); notices();
    $('sensorsLegend').textContent = t('sensors.legend', { warm: L.TEMP_WARM, hot: L.TEMP_HOT });
    const visibleRows = [];
    const plan = [];
    for (const g of data.groups) for (const h of g.hardware) {
      const hk = `${g.id}|${h.name}`; const open = expanded.has(hk);
      const types = L.sensorsByType(h.sensors).map((ty) => ({ type: ty.type, all: ty.sensors, shown: open ? ty.sensors : ty.sensors.slice(0, LIMIT) }));
      plan.push({ g, h, hk, open, types, long: types.some((ty) => ty.all.length > LIMIT) });
      types.forEach((ty) => ty.shown.forEach((s) => visibleRows.push(s.key)));
    }
    const newSig = KB.lang + '#' + plan.map((p) => p.hk + (p.open ? '+' : '')).join(';') + '#' + visibleRows.join('\n');
    if (newSig === sig) { plan.forEach((p) => p.types.forEach((ty) => ty.shown.forEach(fill))); return; }
    sig = newSig; cells = new Map();
    const host = $('sensorsGroups'); host.textContent = '';
    let lastGroup = '';
    for (const p of plan) {
      if (p.g.id !== lastGroup) { lastGroup = p.g.id; host.append(el('h2', 'h2 sensors-group', t(`sensors.group.${p.g.id}`))); }
      const card = el('article', 'card sensor-card'); card.dataset.hw = p.hk;
      const head = el('div', 'sensor-head'); head.append(el('h3', '', p.h.name)); card.append(head);
      const cols = el('div', 'srow shead'); cols.append(el('span', 'sname', ''), el('span', 'sval', t('sensors.col.value')), el('span', 'smin', t('sensors.col.min')), el('span', 'smax', t('sensors.col.max'))); card.append(cols);
      for (const ty of p.types) {
        card.append(el('div', 'sensor-type', typeLabel(ty.type)));
        for (const s of ty.shown) { const row = el('div', 'srow'); row.dataset.type = s.type; cellsFor(s, row); card.append(row); fill(s); }
      }
      if (p.long) {
        const total = p.types.reduce((n, ty) => n + ty.all.length, 0);
        const b = el('button', 'btn small', p.open ? t('sensors.less') : t('sensors.more', { count: total })); b.type = 'button';
        b.addEventListener('click', () => { if (expanded.has(p.hk)) expanded.delete(p.hk); else expanded.add(p.hk); sig = ''; render(); });
        card.append(b);
      }
      host.append(card);
    }
  }

  // ---- snapshot (copy / save) -------------------------------------------------------------------------------------
  function snapshot() {
    if (!data) return null;
    const copy = JSON.parse(JSON.stringify(data));
    for (const g of copy.groups) for (const h of g.hardware) for (const s of h.sensors) {
      const tk = track.get(s.key); if (tk) { s.min = tk.min; s.max = tk.max; }
      delete s.key;
    }
    copy.minMaxSince = trackSince.toISOString();
    return copy;
  }

  async function exportSnapshot(kind) {
    const snap = snapshot();
    if (!snap) return;
    const res = await window.kb.sensors[kind](snap);
    if (res.canceled) return;
    KB.showResult($('sensorsResult'), res.ok ? 'ok' : 'fail', res.ok ? t(kind === 'copy' ? 'sensors.copied' : 'sensors.saved', { file: res.file || '' }) : t('sensors.exportFailed'));
  }

  function togglePause() {
    paused = !paused;
    if (paused) stop(); else { KB.showResult($('sensorsResult'), '', ''); start(); }
    updateControls(); status();
  }

  KB.registerView('sensors', {
    onShow() {
      active = true;
      if (!state) { loadState(); return; }
      if (state.installed && !paused) start();
    },
    onHide() { active = false; stop(); }
  });

  document.addEventListener('DOMContentLoaded', () => {
    $('sensorsConsent').addEventListener('change', renderGet);
    $('sensorsGetBtn').addEventListener('click', getSupport);
    $('sensorsPause').addEventListener('click', togglePause);
    $('sensorsResetMinMax').addEventListener('click', () => { track = new Map(); trackSince = new Date(); if (data) { apply({ ok: true, code: lastCode, data }); } });
    $('sensorsCopy').addEventListener('click', () => exportSnapshot('copy'));
    $('sensorsSave').addEventListener('click', () => exportSnapshot('save'));
    // a hidden window (closed to the tray) must not keep reading; coming back resumes
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { stop(); return; }
      if (active && state && state.installed && !paused) start();
    });
  });
  KB.onSettingsChanged(() => { sig = ''; renderGet(); if (data) render(); else updateControls(); });
})();
