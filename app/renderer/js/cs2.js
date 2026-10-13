'use strict';
// Counter-Strike 2 preset (opened from the Optimizations card): GPU preference for cs2.exe, an optional autoexec.cfg with backup and
// restore, and a launch-options string to copy. The work is done by scripts/lib/Cs2.ps1 through the cs2-* steps; what each part shows
// and which buttons are enabled comes from js/cs2logic.js. Everything is written with textContent.
(function () {
  const { $, t } = KB;
  const L = window.KBCs2;

  let ov = null;                       // cs2-state data
  let busy = false;
  const cfgIds = new Set();            // autoexec options ticked
  let fps = '';                        // value for the option that takes a number
  let launchSel = null;                // Set of launch option ids ticked (null until the catalog arrives)

  const exeOpt = () => (KB.settings && KB.settings.cs2Exe ? { cs2Exe: KB.settings.cs2Exe } : {});
  const run = (step, extra) => window.kb.runStep(step, { ...exeOpt(), ...(extra || {}) });

  // ---- copy to the clipboard: the async API first, a hidden textarea as the fallback ---------------------------------
  KB.copyText = async (text) => {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* not allowed here: use the fallback */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.className = 'offscreen'; ta.setAttribute('readonly', '');
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return !!ok;
    } catch { return false; }
  };

  function chip(el, status, kind) { el.textContent = t(status); el.className = 'chip status' + (kind ? ' ' + kind : ''); }

  // ---- render --------------------------------------------------------------------------------------------------------
  function renderLocation() {
    const m = L.locationModel(ov);
    const found = !!(ov && ov.found);
    $('cs2Loc').textContent = m.source ? t(m.source, { count: ov.libraryCount }) : t(m.status);
    $('cs2Exe').textContent = found ? ov.exe : '';
    $('cs2Exe').parentElement.hidden = !found;
    $('cs2Forget').hidden = !(KB.settings && KB.settings.cs2Exe);
    $('cs2Pick').disabled = busy; $('cs2Rescan').disabled = busy; $('cs2Forget').disabled = busy;
    $('cs2Gpu').hidden = !found; $('cs2Cfg').hidden = !found;
  }

  function renderGpu() {
    if (!ov || !ov.found) return;
    const m = L.gpuModel(ov.gpu, busy);
    chip($('cs2GpuStatus'), m.status, m.status.endsWith('.ours') || m.status.endsWith('.theirs') ? 'ok' : '');
    $('cs2GpuApply').disabled = !m.canApply; $('cs2GpuRevert').disabled = !m.canRevert;
  }

  function cfgOptions() { return (ov && ov.catalog && ov.catalog.autoexec) || []; }

  function renderCfg() {
    if (!ov || !ov.found) return;
    const opts = cfgOptions();
    $('cs2CfgPath').textContent = ov.autoexec && ov.autoexec.file ? ov.autoexec.file : (ov.cfgDir || '');
    const list = $('cs2CfgList'); list.textContent = '';
    opts.forEach((o) => {
      const row = document.createElement('label'); row.className = 'clean-row'; row.dataset.id = o.id;
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = cfgIds.has(o.id); cb.disabled = busy;
      cb.addEventListener('change', () => { if (cb.checked) cfgIds.add(o.id); else cfgIds.delete(o.id); renderCfgButtons(); });
      const text = document.createElement('span'); text.className = 'clean-text';
      const code = document.createElement('code'); code.textContent = o.param ? o.line.replace('{' + o.param.name + '}', fps || '…') : o.line; code.dataset.line = '1';
      const hint = document.createElement('span'); hint.className = 'muted'; hint.textContent = t(`cs2.cfg.opt.${o.id}`, o.param ? { min: o.param.min, max: o.param.max } : {});
      text.append(code, hint);
      row.append(cb, text);
      if (o.param) {
        const n = document.createElement('input'); n.type = 'text'; n.inputMode = 'numeric'; n.className = 'field narrow'; n.maxLength = 4; n.value = fps; n.id = 'cs2Fps';
        n.placeholder = t('cs2.cfg.fpsPlaceholder'); n.setAttribute('aria-label', t('cs2.cfg.fpsPlaceholder')); n.disabled = busy;
        n.addEventListener('click', (e) => e.stopPropagation());
        n.addEventListener('input', () => { fps = n.value.trim(); code.textContent = o.line.replace('{' + o.param.name + '}', fps || '…'); renderCfgButtons(); });
        row.append(n);
      }
      list.appendChild(row);
    });
    renderCfgButtons();
  }

  function cfgModel() { return L.autoexecModel(ov && ov.autoexec, { ids: [...cfgIds], fps }, cfgOptions(), busy); }
  function renderCfgButtons() {
    if (!ov || !ov.found) return;
    const m = cfgModel();
    chip($('cs2CfgStatus'), m.status, m.status.endsWith('.ours') ? 'ok' : (m.status.endsWith('.foreign') ? 'warn' : ''));
    $('cs2CfgWrite').disabled = !m.canWrite; $('cs2CfgRestore').disabled = !m.canRestore;
  }

  function launchCatalog() { return (ov && ov.catalog && ov.catalog.launch) || []; }

  function renderLaunch() {
    const cat = launchCatalog();
    $('cs2Launch').hidden = !cat.length;
    if (!cat.length) return;
    if (!launchSel) launchSel = new Set(L.defaultLaunchSelection(cat));
    const list = $('cs2LaunchList'); list.textContent = '';
    cat.forEach((o) => {
      const row = document.createElement('label'); row.className = 'clean-row'; row.dataset.id = o.id;
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = launchSel.has(o.id);
      cb.addEventListener('change', () => { if (cb.checked) launchSel.add(o.id); else launchSel.delete(o.id); renderLaunchString(); });
      const text = document.createElement('span'); text.className = 'clean-text';
      const head = document.createElement('span');
      const code = document.createElement('code'); code.textContent = o.text;
      const tier = document.createElement('span'); tier.className = 'chip tier-' + o.tier; tier.textContent = t(`cs2.launch.tier.${o.tier}`);
      head.append(code, ' ', tier);
      const hint = document.createElement('span'); hint.className = 'muted'; hint.textContent = t(`cs2.launch.opt.${o.id}`);
      text.append(head, hint);
      row.append(cb, text); list.appendChild(row);
    });
    renderLaunchString();
  }

  function renderLaunchString() {
    const s = L.buildLaunchOptions(launchCatalog(), [...(launchSel || [])]);
    const input = $('cs2LaunchStr'); input.value = s; input.placeholder = t('cs2.launch.empty');
    $('cs2Copy').disabled = !s;
    KB.showResult($('cs2CopyResult'), '', '');
  }

  function render() {
    renderLocation(); renderGpu(); renderCfg(); renderLaunch();
  }

  // ---- actions -------------------------------------------------------------------------------------------------------
  async function load() {
    busy = true; render();
    const res = await run('cs2-state');
    busy = false;
    if (!res.ok || !res.data) { KB.showResult($('cs2LocResult'), 'fail', KB.message(res) || t('common.failed')); ov = null; render(); return; }
    ov = res.data;
    if (ov.userExeInvalid) { await KB.saveSetting({ cs2Exe: '' }); KB.showResult($('cs2LocResult'), 'warn', t('cs2.loc.invalid')); }
    else KB.showResult($('cs2LocResult'), '', '');
    render();
  }

  async function pick() {
    const r = await window.kb.cs2.pickExe();
    if (!r || r.canceled) return;
    if (!r.ok) { KB.showResult($('cs2LocResult'), 'fail', KB.message(r) || t('common.failed')); return; }
    await KB.saveSetting({ cs2Exe: r.path });
    await load();
  }

  async function forget() { await KB.saveSetting({ cs2Exe: '' }); await load(); }

  async function step(name, extra, resultId) {
    busy = true; render(); KB.showResult($(resultId), '', '');
    const res = await run(name, extra);
    busy = false;
    KB.showResult($(resultId), res.ok ? 'ok' : (res.code === 'msg.cs2.autoexecNotOurs' || res.code === 'msg.cs2.gpuNotOurs' ? 'warn' : 'fail'), KB.message(res) || t('common.failed'));
    const fresh = await run('cs2-state');
    if (fresh.ok && fresh.data) ov = fresh.data;
    render();
    return res;
  }

  const gpuApply = () => step('cs2-gpu', { cs2Mode: 'on' }, 'cs2GpuResult');
  const gpuRevert = () => step('cs2-gpu', { cs2Mode: 'off' }, 'cs2GpuResult');

  async function cfgWrite() {
    const m = cfgModel(); if (!m.canWrite) return;
    const lines = cfgOptions().filter((o) => cfgIds.has(o.id)).map((o) => '• ' + (o.param ? o.line.replace('{' + o.param.name + '}', fps) : o.line));
    const ok = await KB.confirm({ title: t('cs2.cfg.confirmTitle'), paragraphs: [t('cs2.cfg.confirmBody'), ...lines, t(m.willBackup ? 'cs2.cfg.confirmBackup' : 'cs2.cfg.confirmNoBackup'), t('cs2.cfg.loadNote')], ok: t('cs2.cfg.write') });
    if (!ok) return;
    await step('cs2-autoexec', { cs2Mode: 'on', cs2Options: [...cfgIds].join(','), cs2FpsMax: cfgIds.has('fpsmax') ? fps : undefined }, 'cs2CfgResult');
  }

  async function cfgRestore() {
    if (!cfgModel().canRestore) return;
    const ok = await KB.confirm({ title: t('cs2.cfg.restoreTitle'), paragraphs: [t('cs2.cfg.restoreBody')], ok: t('cs2.cfg.restoreOk') });
    if (!ok) return;
    await step('cs2-autoexec', { cs2Mode: 'off' }, 'cs2CfgResult');
  }

  async function copy() {
    const s = $('cs2LaunchStr').value; if (!s) return;
    const ok = await KB.copyText(s);
    if (!ok) $('cs2LaunchStr').select();
    KB.showResult($('cs2CopyResult'), ok ? 'ok' : 'warn', t(ok ? 'cs2.launch.copied' : 'cs2.launch.copyFailed'));
  }

  KB.registerView('cs2', { onShow() { load(); } });
  document.addEventListener('DOMContentLoaded', () => {
    $('openCs2').addEventListener('click', () => KB.showView('cs2'));
    $('backFromCs2').addEventListener('click', () => KB.showView('optimizations'));
    $('cs2Pick').addEventListener('click', pick);
    $('cs2Rescan').addEventListener('click', load);
    $('cs2Forget').addEventListener('click', forget);
    $('cs2GpuApply').addEventListener('click', gpuApply);
    $('cs2GpuRevert').addEventListener('click', gpuRevert);
    $('cs2CfgWrite').addEventListener('click', cfgWrite);
    $('cs2CfgRestore').addEventListener('click', cfgRestore);
    $('cs2Copy').addEventListener('click', copy);
  });
  KB.onSettingsChanged(() => { if (ov && !$('cs2').hidden) render(); });
})();
