'use strict';
// Optimizations > "CPU thermal tuning": the step-by-step ThrottleStop setup (step 0 to step 6), plus the card status on the catalog.
(function () {
  const { $, t, setText } = KB;

  const STEPS = [
    { id: 'detect', n: 1 }, { id: 'backup', n: 1 }, { id: 'get', n: 1, options: ['zip'] },
    { id: 'vbs', n: 3, options: ['vbs'] }, { id: 'apply', n: 3 }, { id: 'task', n: 2 }, { id: 'verify', n: 1 }
  ];
  const state = { index: 0, status: STEPS.map(() => 'idle'), zipPath: null, download: true, disableVbs: true, vbsRan: false, started: false };

  // ---- card status on the Optimizations page ------------------------------------------------------------------
  KB.renderOptStatus = function () {
    const chip = $('optStatus'); const h = KB.state.health;
    if (!h) { setText(chip, t('opt.status.checking')); chip.className = 'chip status'; return; }
    if (h.installed === false) { setText(chip, t('opt.status.notSetUp')); chip.className = 'chip status none'; }
    else if (h.verdict === 'ok') { setText(chip, t('opt.status.optimized')); chip.className = 'chip status ok'; }
    else if (h.verdict === 'warn') { setText(chip, t('opt.status.needsLook')); chip.className = 'chip status warn'; }
    else { setText(chip, t('opt.status.needsAttention')); chip.className = 'chip status fail'; }
    setText($('openThrottle'), t(h.installed === false ? 'opt.cpu.start' : 'opt.cpu.open'));
  };

  // ---- stepper ------------------------------------------------------------------------------------------------
  function renderStepper() {
    const ol = $('stepper'); ol.textContent = '';
    STEPS.forEach((s, i) => {
      const li = document.createElement('li'); const st = state.status[i];
      li.className = [i === state.index ? 'active' : '', st !== 'idle' ? st : ''].join(' ').trim();
      const dot = document.createElement('span'); dot.className = 'dot';
      dot.textContent = st === 'ok' ? '✓' : st === 'fail' ? '!' : String(i);
      const label = document.createElement('span'); label.textContent = t(`step.${s.id}.title`);
      li.append(dot, label); ol.append(li);
    });
  }

  function renderOptions(step) {
    const box = $('options'); box.textContent = '';
    (step.options || []).forEach((o) => {
      if (o === 'zip') {
        const pick = document.createElement('button'); pick.className = 'btn small'; pick.type = 'button'; pick.textContent = t('wizard.zipPick');
        const lbl = document.createElement('span'); lbl.className = 'muted'; lbl.style.margin = '0';
        lbl.textContent = state.zipPath || t('wizard.zipAuto');
        pick.addEventListener('click', async () => { const p = await window.kb.pickZip(); if (p) { state.zipPath = p; lbl.textContent = p; } });
        const link = document.createElement('button'); link.className = 'btn small ghost'; link.type = 'button'; link.textContent = t('wizard.openDownload');
        link.addEventListener('click', () => window.kb.openExternal('https://www.techpowerup.com/download/techpowerup-throttlestop/'));
        const dl = document.createElement('label'); dl.className = 'check';
        const dcb = document.createElement('input'); dcb.type = 'checkbox'; dcb.checked = state.download;
        dcb.addEventListener('change', () => { state.download = dcb.checked; });
        const dsp = document.createElement('span'); dsp.textContent = t('wizard.downloadCheck');
        dl.append(dcb, dsp);
        box.append(dl, pick, link, lbl);
      }
      if (o === 'vbs') {
        const label = document.createElement('label'); label.className = 'check';
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = state.disableVbs;
        cb.addEventListener('change', () => { state.disableVbs = cb.checked; });
        const span = document.createElement('span'); span.textContent = t('wizard.vbsCheckbox');
        label.append(cb, span); box.append(label);
      }
    });
  }

  function renderStep() {
    const s = STEPS[state.index];
    setText($('kicker'), t('wizard.kicker', { step: t(`step.${s.id}.kicker`) }));
    setText($('title'), t(`step.${s.id}.title`)); setText($('desc'), t(`step.${s.id}.desc`));
    const ul = $('changes'); ul.textContent = '';
    for (let i = 1; i <= s.n; i++) { const li = document.createElement('li'); li.textContent = t(`step.${s.id}.c${i}`); ul.append(li); }
    renderOptions(s);
    $('log').textContent = ''; KB.showResult($('result'), '', '');
    const st = state.status[state.index];
    $('run').disabled = false; setText($('run'), t(st === 'ok' ? 'common.runAgain' : 'common.runStep'));
    $('next').disabled = st !== 'ok';
    setText($('next'), t(state.index === STEPS.length - 1 ? 'common.finish' : 'common.next'));
    renderStepper();
  }

  async function runStep(auto) {
    const i = state.index, s = STEPS[i];
    state.status[i] = 'running'; renderStepper();
    $('run').disabled = true; $('next').disabled = true; $('log').textContent = ''; KB.showResult($('result'), '', '');
    const res = await window.kb.runStep(s.id, { zipPath: state.zipPath, disableVbs: state.disableVbs, download: state.download });
    state.status[i] = res.ok ? 'ok' : 'fail';
    if (s.id === 'vbs' && res.ok && state.disableVbs) state.vbsRan = true;
    const warn = res.ok && s.id === 'detect' && res.data && !res.data.modelVerified;
    KB.showResult($('result'), res.ok ? (warn ? 'warn' : 'ok') : 'fail', KB.message(res) || t(res.ok ? 'common.done' : 'common.failed'));
    $('run').disabled = false; setText($('run'), t(res.ok ? 'common.runAgain' : 'common.tryAgain'));
    $('next').disabled = !res.ok;
    renderStepper();
    if (auto && res.ok) $('next').focus();
  }

  function next() {
    if (state.index < STEPS.length - 1) { state.index++; renderStep(); return; }
    KB.showView('finish');
    setText($('finishText'), t(state.vbsRan ? 'finish.reboot' : 'finish.ok'));
  }

  KB.resetWizard = () => { state.status = STEPS.map(() => 'idle'); state.index = 0; state.started = false; };
  KB.registerView('wizard', { onShow() { renderStep(); if (!state.started) { state.started = true; runStep(true); } } });
  KB.registerView('optimizations', { onShow() { KB.renderOptStatus(); } });

  document.addEventListener('DOMContentLoaded', () => {
    $('run').addEventListener('click', () => runStep(false));
    $('next').addEventListener('click', next);
    $('openThrottle').addEventListener('click', () => KB.showView('wizard'));
    $('backToOpt').addEventListener('click', () => KB.showView('optimizations'));
    $('toHealth').addEventListener('click', () => { KB.showView('health'); KB.runHealth(); });
    window.kb.onLog((step, line) => { if (step !== 'fix') { const log = $('log'); log.textContent += line + '\n'; log.scrollTop = log.scrollHeight; } });
    KB.onSettingsChanged(() => { KB.renderOptStatus(); if (KB.state.view === 'wizard') renderStep(); });
  });
})();
