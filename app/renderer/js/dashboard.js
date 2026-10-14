'use strict';
// Dashboard: the health check ("is the optimization still in place?") and the one-click fix, live tiles (HWiNFO shared memory, read about
// every 2 s only while this screen and the window are visible), hardware cards, the optimization level and "Apply recommended".
(function () {
  const { $, t, setText } = KB;
  const L = window.KBDash;

  const VERDICT = {
    ok:   { cls: 'ok',   icon: '✓', key: 'dashboard.verdict.ok' },
    warn: { cls: 'warn', icon: '!', key: 'dashboard.verdict.warn' },
    fail: { cls: 'fail', icon: '✕', key: 'dashboard.verdict.fail' }
  };

  const checkName = (c) => (KB.dict[`check.${c.id}.name`] || KB.fallback[`check.${c.id}.name`]) ? t(`check.${c.id}.name`) : c.name;
  KB.checkDetail = (c) => (c.code && (KB.dict[c.code] || KB.fallback[c.code]) ? t(c.code, c.args || {}) : c.detail);

  function renderHealth(h, msg) {
    KB.state.health = h;
    const v = VERDICT[h.verdict] || VERDICT.fail;
    $('hero').className = 'hero ' + v.cls;
    setText($('heroIcon'), v.icon); setText($('heroTitle'), t(v.key));
    const when = h.checkedAt ? ' · ' + t('dashboard.checked', { time: h.checkedAt.replace('T', ' ').slice(0, 16) }) : '';
    setText($('heroSub'), (h.windows || '') + when);

    const upd = (h.checks || []).find((c) => c.id === 'windows' && !c.ok);
    $('updateNote').hidden = !upd; if (upd) setText($('updateNote'), '🛈  ' + KB.checkDetail(upd));

    const ul = $('checks'); ul.textContent = '';
    (h.checks || []).forEach((c) => {
      const li = document.createElement('li'); li.className = 'check-row ' + (c.ok ? 'ok' : (c.severity === 'info' ? 'info' : c.severity === 'warn' ? 'warn' : 'fail'));
      const ic = document.createElement('span'); ic.className = 'check-ic'; ic.textContent = c.ok ? '✓' : (c.severity === 'info' ? 'i' : '!');
      const body = document.createElement('div');
      const name = document.createElement('div'); name.className = 'check-name'; name.textContent = checkName(c);
      const det = document.createElement('div'); det.className = 'check-detail'; det.textContent = KB.checkDetail(c);
      body.append(name, det); li.append(ic, body); ul.append(li);
    });

    const fixable = (h.checks || []).some((c) => !c.ok && c.fix);
    $('fix').hidden = !(fixable && h.verdict !== 'ok');
    $('vbsAllow').hidden = !(h.checks || []).some((c) => c.id === 'vbs' && !c.ok);
    if (msg) setText($('heroSub'), msg + ' · ' + (h.windows || ''));
    if (KB.renderOptStatus) KB.renderOptStatus();
    renderLevel();
  }

  let healthFromCache = false;        // the verdict on screen is the last check, shown while the real one runs
  async function runHealth() {
    $('check').disabled = true; $('fix').disabled = true;
    if (healthFromCache) KB.refreshing($('hero'), true);
    else { $('hero').className = 'hero checking'; setText($('heroIcon'), '…'); setText($('heroTitle'), t('dashboard.checking')); }
    let res;
    try { res = await window.kb.runStep('health', {}); } finally { $('check').disabled = false; $('fix').disabled = false; KB.refreshing($('hero'), false); healthFromCache = false; }
    if (res.data && res.data.checks) { renderHealth(res.data); KB.lastSet('health', res.data); return res.data; }
    $('hero').className = 'hero fail'; setText($('heroIcon'), '✕'); setText($('heroTitle'), t('dashboard.couldNotCheck')); setText($('heroSub'), KB.message(res));
    return null;
  }

  async function runFix() {
    $('check').disabled = true; $('fix').disabled = true;
    setText($('heroTitle'), t('dashboard.fixing'));
    const log = $('healthLog'); log.hidden = false; log.textContent = '';
    const res = await window.kb.runStep('fix', { disableVbs: $('vbsAllowBox').checked });
    $('check').disabled = false; $('fix').disabled = false;
    if (res.data && res.data.checks) renderHealth(res.data, KB.message(res));
    else { setText($('heroTitle'), t('dashboard.couldNotFix')); setText($('heroSub'), KB.message(res)); }
  }

  // ---- live tiles ---------------------------------------------------------------------------------------------
  // Values come only from the telemetry step (HWiNFO shared memory). When they cannot be read the tiles stay "–" and a notice says why.
  let reading = null, live = null, takenAt = '', tActive = false, tBusy = false, tTimer = null, noticeBusy = false;
  const HW_FRESH_MS = 10000;                           // how old the HWiNFO state may get while the tiles stay empty
  const canPoll = () => tActive && !document.hidden && KB.featureOn('optimizations');

  function renderTiles() {
    const on = KB.featureOn('optimizations');
    $('tiles').hidden = !on;
    if (!on) { $('tilesNotice').hidden = true; $('tilesWhen').hidden = true; return; }
    setText($('tTemp'), L.formatTile('temp', live)); setText($('tClock'), L.formatTile('clock', live)); setText($('tPower'), L.formatTile('power', live));
    const n = L.tilesNotice(reading, !!(KB.state.info && KB.state.info.isAdmin), KB.hwinfoData || null, { iniConsent: $('tilesIniBox').checked, busy: noticeBusy || (KB.hwinfoBusy ? KB.hwinfoBusy() : false) });
    $('tilesNotice').hidden = !n.key;
    if (n.key) setText($('tilesNoticeText'), t(n.key));
    $('tilesRestart').hidden = !n.restart;
    $('tilesStart').hidden = !n.start; $('tilesStart').disabled = !n.startEnabled;
    $('tilesIniRow').hidden = !n.iniOption;
    if (!n.start) $('tilesIniBox').checked = false;
    if (!n.key) KB.showResult($('tilesStartResult'), '', '');
    const time = n.state === 'live' ? L.clockTime(takenAt) : '';
    $('tilesWhen').hidden = !time;
    if (time) setText($('tilesWhen'), t('dashboard.tiles.when', { time }));
  }

  function scheduleTelemetry() { clearTimeout(tTimer); if (canPoll()) tTimer = setTimeout(readTelemetry, L.REFRESH_MS); }
  async function readTelemetry() {
    if (tBusy) return;                                   // one read in flight at a time
    tBusy = true;
    KB.telemetryReads = (KB.telemetryReads || 0) + 1;    // read counter (the UI test checks that polling stops when the screen is left)
    const res = await window.kb.runStep('telemetry', {});
    tBusy = false;
    if (res && res.ok && res.data) { reading = { available: !!res.data.available }; live = res.data.available ? res.data.live : null; takenAt = res.data.takenAt || ''; }
    else { reading = { failed: true }; live = null; }
    renderTiles();
    // empty tiles: keep the HWiNFO state fresh (throttled), so the notice follows HWiNFO being started or closed outside the app
    if (reading && reading.available === false && KB.hwinfoRefresh && Date.now() - (KB.hwinfoStamp || 0) > HW_FRESH_MS) KB.hwinfoRefresh();
    scheduleTelemetry();
  }
  async function startFromNotice() {
    if (noticeBusy || !KB.hwinfoStart) return;
    noticeBusy = true; renderTiles();
    const res = await KB.hwinfoStart($('tilesIniBox').checked);
    noticeBusy = false;
    if (res) KB.showResult($('tilesStartResult'), res.ok ? 'ok' : 'fail', KB.message(res) || t('common.failed'));
    renderTiles();
    if (res && res.ok && canPoll()) { clearTimeout(tTimer); tTimer = setTimeout(readTelemetry, 1500); }   // pick the readings up as soon as HWiNFO has them
  }
  function startTelemetry() { tActive = true; clearTimeout(tTimer); if (canPoll()) readTelemetry(); }
  function stopTelemetry() { tActive = false; clearTimeout(tTimer); }

  // ---- hardware cards -----------------------------------------------------------------------------------------
  let hw = null;
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
  function hwCard(titleKey, rows) {
    const c = el('div', 'hw-card'); c.append(el('h3', '', t(titleKey)));
    rows.forEach((r) => { c.append(el('div', 'hw-main', r.main || t('common.unknown'))); if (r.sub) c.append(el('div', 'hw-sub', r.sub)); });
    return c;
  }
  function renderHardware() {
    const host = $('hwCards'); host.textContent = '';
    const i = KB.state.info; if (!i) { host.hidden = true; return; }
    if (hw) {
      host.append(hwCard('dashboard.hw.cpu', [{ main: hw.cpu, sub: hw.cpuCores ? t('dashboard.hw.cores', { cores: hw.cpuCores, threads: hw.cpuThreads }) : '' }]));
      host.append(hwCard('dashboard.hw.gpu', [{ main: hw.gpu }]));
      host.append(hwCard('dashboard.hw.ram', [{ main: hw.ramGB ? hw.ramGB + ' GB' : '', sub: hw.ramSpeedMHz ? t('dashboard.hw.ramSpeed', { modules: hw.ramModules, speed: hw.ramSpeedMHz }) : '' }]));
      const disks = Array.isArray(hw.disks) ? hw.disks : [];
      if (disks.length) host.append(hwCard('dashboard.hw.disks', disks.map((d) => ({ main: d.model, sub: [t(`dashboard.hw.disk.${d.type}`), L.formatSize(d.sizeGB)].filter(Boolean).join(' · ') }))));
      host.append(hwCard('dashboard.hw.os', [{ main: hw.osVersion, sub: [[hw.manufacturer, hw.model].filter(Boolean).join(' '), hw.powerPlan].filter(Boolean).join(' · ') }]));
    } else if (!KB.featureOn('optimizations')) {          // macOS / Linux: what Node can tell us
      host.append(hwCard('dashboard.hw.cpu', [{ main: i.cpu, sub: String(i.cores) }]));
      host.append(hwCard('dashboard.hw.ram', [{ main: i.ramGB + ' GB' }]));
      host.append(hwCard('dashboard.hw.os', [{ main: i.osName, sub: `${i.osRelease} · ${i.arch}` }]));
    }
    host.hidden = !host.childElementCount;
  }
  let hwLoading = false;
  async function loadHardware() {
    if (hw || hwLoading) return;                             // loaded already, or the request is in flight
    hwLoading = true;
    const last = KB.lastGet('detect');                       // the last answer at once (detect is the slowest step), refreshed below
    if (last) { hw = last.v; KB.state.hardware = hw; renderHardware(); renderLevel(); KB.refreshing($('hwCards'), true); }
    let res = null;
    try { res = await KB.getHardware(); } catch { /* the cards already shown stay */ } finally { KB.refreshing($('hwCards'), false); hwLoading = false; }
    if (res && res.data) { hw = res.data; KB.state.hardware = hw; renderHardware(); renderLevel(); }
  }

  // ---- optimization level + Apply recommended --------------------------------------------------------------------
  let tweaks = null, applying = false;
  function levelEmpty(lineKey) {
    setText($('levelLine'), t(lineKey)); setText($('levelPct'), '–'); $('levelFill').style.width = '0'; setText($('levelFormula'), '');
    $('applyReco').disabled = true;
  }
  function renderLevel() {
    const card = $('optLevel');
    card.hidden = !KB.featureOn('optimizations');
    if (card.hidden) return;
    const h = KB.state.health;
    if (!tweaks || !hw || !h) { levelEmpty('dashboard.level.loading'); return; }
    const lvl = L.optimizationLevel(tweaks, { applicable: !!hw.cpuSupported, installed: h.installed, verdict: h.verdict });
    if (lvl.percent === null) { levelEmpty('dashboard.level.none'); return; }
    setText($('levelPct'), lvl.percent + '%');
    $('levelFill').style.width = lvl.percent + '%';
    const cpu = !lvl.cpuApplicable ? t('dashboard.level.cpuNa') : t(lvl.cpuOk ? 'dashboard.level.cpuOk' : 'dashboard.level.cpuNo');
    setText($('levelLine'), t('dashboard.level.line', { active: lvl.active, total: lvl.total }) + ' · ' + cpu);
    setText($('levelFormula'), t('dashboard.level.formula', { active: lvl.active, cpu: lvl.cpuOk ? 1 : 0, total: lvl.total, cpuItem: lvl.cpuApplicable ? 1 : 0, percent: lvl.percent }));
    $('applyReco').disabled = applying || tweaksStale || !lvl.todo.length;
  }
  let tweaksStale = false;             // the list is the last one (shared with Optimizations), shown while the real one loads: Apply stays off
  async function loadTweaks() {
    if (!tweaks) {
      const last = KB.lastGet('tweaks');
      if (last && last.v && Array.isArray(last.v.tweaks)) { tweaks = last.v.tweaks; tweaksStale = true; renderLevel(); }
    }
    let res = null;
    try { res = await window.kb.runStep('tweaks-list', {}); } finally { tweaksStale = false; }
    if (res && res.ok && res.data) {
      tweaks = res.data.tweaks; KB.state.tweaks = tweaks;
      KB.lastSet('tweaks', { tweaks, admin: !!res.data.admin });
    }
    renderLevel();
  }
  async function applyReco() {
    if (applying || !tweaks) return;
    applying = true; renderLevel(); KB.showResult($('levelResult'), '', '');
    const r = await KB.applyRecommended(tweaks);          // same confirmation, restore point and safe-only rule as the Optimizations screen
    if (r.status === 'none') KB.showResult($('levelResult'), 'ok', t('tweaks.recommendedNone'));
    if (r.status === 'done') KB.showResult($('levelResult'), r.res.ok ? 'ok' : 'warn', KB.message(r.res));
    applying = false;
    await loadTweaks();
  }

  // On macOS/Linux there is no CPU-tuning health check: the Dashboard shows the basic system information instead.
  function renderBasic() {
    const i = KB.state.info;
    $('hero').className = 'hero ok'; setText($('heroIcon'), '✓');
    setText($('heroTitle'), i.osName); setText($('heroSub'), `${i.osRelease} · ${i.arch} · ${i.cpu}`);
    $('check').hidden = true; $('fix').hidden = true; $('tiles').hidden = true; $('updateNote').hidden = true;
    $('tilesNotice').hidden = true; $('tilesWhen').hidden = true; $('optLevel').hidden = true;
    $('checks').textContent = '';
    renderHardware();
  }

  KB.runHealth = runHealth;
  KB.registerView('health', {
    onShow() {
      if (!KB.featureOn('optimizations')) { renderBasic(); return; }
      if (KB.hwinfoRefresh) KB.hwinfoRefresh();
      if (!KB.state.health) {                                  // the last check at once; runHealth refreshes it (shimmer on the verdict)
        const last = KB.lastGet('health');
        if (last && last.v && last.v.checks) { healthFromCache = true; renderHealth(last.v); }
      }
      renderTiles(); renderLevel(); startTelemetry(); loadHardware(); loadTweaks();
     
    },
    onHide() { stopTelemetry(); }
  });

  document.addEventListener('DOMContentLoaded', () => {
    $('check').addEventListener('click', runHealth);
    $('fix').addEventListener('click', runFix);
    $('applyReco').addEventListener('click', applyReco);
    $('tilesRestart').addEventListener('click', () => window.kb.relaunchAdmin());
    $('tilesStart').addEventListener('click', startFromNotice);
    $('tilesIniBox').addEventListener('change', renderTiles);
    document.addEventListener('kb:hwinfo', renderTiles);
    window.kb.onLog((step, line) => { if (step === 'fix') { const log = $('healthLog'); log.textContent += line + '\n'; log.scrollTop = log.scrollHeight; } });
    // a hidden window (closed to the tray) must not keep reading; coming back resumes
    document.addEventListener('visibilitychange', () => { if (document.hidden) clearTimeout(tTimer); else if (tActive) startTelemetry(); });
    // re-render with the new language
    KB.onSettingsChanged(() => { if (KB.state.health) renderHealth(KB.state.health); renderTiles(); renderLevel(); renderHardware(); });
  });
})();
