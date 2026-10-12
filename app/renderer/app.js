'use strict';

const STEPS = [
  { id: 'detect', title: 'Detect your hardware', kicker: 'Step 0 · Safety check',
    desc: 'Reads your operating system, CPU and laptop model. The tuning values are specific to the Intel Core i9-14900HX, so the wizard refuses to continue on any other CPU.',
    changes: ['Nothing is changed in this step.'] },
  { id: 'backup', title: 'Back up current settings', kicker: 'Step 1',
    desc: 'Saves a timestamped copy of ThrottleStop.ini so you can always return to where you started.',
    changes: ['Creates ThrottleStop.ini.bak_<date> next to the ini (skipped on a fresh install).'] },
  { id: 'get', title: 'Get ThrottleStop', kicker: 'Step 2',
    desc: 'Uses the ThrottleStop you already have (the folder of your startup task, or one extracted in Downloads, Desktop or Documents). Otherwise it unpacks the zip (tested with 9.7.3) into the install folder: download it from TechPowerUp first and keep it in Downloads, or pick it manually.',
    changes: ['Extracts the zip to C:\\Tools\\ThrottleStop (or the folder you chose).'], options: ['zip'] },
  { id: 'vbs', title: 'Turn off VBS / hypervisor', kicker: 'Step 3',
    desc: 'ThrottleStop can only change CPU voltages while Windows virtualization-based security is off. This is a security setting, so it is your choice.',
    changes: ['bcdedit hypervisorlaunchtype off, VBS off, memory integrity off.', 'Breaks WSL2 and Docker (WSL2) until you roll back.', 'Needs a reboot to take effect.'], options: ['vbs'] },
  { id: 'apply', title: 'Apply the tuning', kicker: 'Step 4',
    desc: 'Writes the tested profile into ThrottleStop.ini.',
    changes: ['Undervolt: -100 mV core and P-cache, -90 mV E-cache.', 'Boost caps: P-cores 47x (4.7 GHz), E-cores 36x (3.6 GHz).', 'Power limits: PL1 65 W / PL2 85 W.'] },
  { id: 'task', title: 'Always-on startup', kicker: 'Step 5',
    desc: 'Registers a Windows scheduled task so ThrottleStop starts at every logon and a 5-minute watchdog brings it back if it is closed. It never starts a second copy.',
    changes: ['Task "ThrottleStop_Autostart", highest privileges, no battery limits.', 'Starts ThrottleStop now and remembers your Windows build for the Dashboard check.'] },
  { id: 'verify', title: 'Verify', kicker: 'Step 6 · Final check',
    desc: 'Compares the saved settings with the profile and checks that ThrottleStop, the task and the hypervisor setting are in the expected state.',
    changes: ['Read-only. If VBS was just disabled, reboot first and run this again.'] }
];

const $ = (id) => document.getElementById(id);
const state = { view: 'health', index: 0, status: STEPS.map(() => 'idle'), info: null, zipPath: null, disableVbs: true, vbsRan: false,
                installDir: null, wizardStarted: false, health: null, analysis: null };
const setText = (el, text) => { el.textContent = text; };

// ---------------------------------------------------------------- views
// Sidebar sections. The wizard and the finish screen belong to "Optimizations".
const NAV_OF = { health: 'health', analysis: 'analysis', optimizations: 'optimizations', wizard: 'optimizations', finish: 'optimizations', restore: 'restore', help: 'help' };

function showView(name) {
  state.view = name;
  const section = NAV_OF[name] || name;
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === section));
  ['health', 'analysis', 'optimizations', 'wizard', 'finish', 'restore', 'help'].forEach((v) => { $(v).hidden = v !== name; });
  $('stepper').hidden = name !== 'wizard';
  if (name === 'wizard') { renderStep(); if (!state.wizardStarted) { state.wizardStarted = true; runStep(true); } }
  if (name === 'analysis' && !state.analysis) runAnalysis();
  if (name === 'optimizations') renderOptStatus();
}

// ---------------------------------------------------------------- dashboard (health check)
const VERDICT = {
  ok:   { cls: 'ok',   icon: '✓', title: 'Your PC is optimized' },
  warn: { cls: 'warn', icon: '!', title: 'Almost there' },
  fail: { cls: 'fail', icon: '✕', title: 'The optimization is not fully in place' }
};

function renderHealth(h, msg) {
  state.health = h;
  const v = VERDICT[h.verdict] || VERDICT.fail;
  $('hero').className = 'hero ' + v.cls;
  setText($('heroIcon'), v.icon); setText($('heroTitle'), v.title);
  const when = h.checkedAt ? ' · checked ' + h.checkedAt.replace('T', ' ').slice(0, 16) : '';
  setText($('heroSub'), (h.windows || '') + when);

  const upd = (h.checks || []).find((c) => c.id === 'windows' && !c.ok);
  $('updateNote').hidden = !upd; if (upd) setText($('updateNote'), '🛈  ' + upd.detail);

  const live = h.live;
  $('tiles').hidden = !live;
  if (live) {
    setText($('tTemp'), live.packageTempC != null ? live.packageTempC + ' °C' : '–');
    setText($('tClock'), live.pClockMaxMHz != null ? (live.pClockMaxMHz / 1000).toFixed(2) + ' GHz' : '–');
    setText($('tPower'), live.packagePowerW != null ? live.packagePowerW + ' W' : '–');
  }

  const ul = $('checks'); ul.textContent = '';
  (h.checks || []).forEach((c) => {
    const li = document.createElement('li'); li.className = 'check-row ' + (c.ok ? 'ok' : (c.severity === 'info' ? 'info' : c.severity === 'warn' ? 'warn' : 'fail'));
    const ic = document.createElement('span'); ic.className = 'check-ic'; ic.textContent = c.ok ? '✓' : (c.severity === 'info' ? 'i' : '!');
    const body = document.createElement('div');
    const name = document.createElement('div'); name.className = 'check-name'; name.textContent = c.name;
    const det = document.createElement('div'); det.className = 'check-detail'; det.textContent = c.detail;
    body.append(name, det); li.append(ic, body); ul.append(li);
  });

  const fixable = (h.checks || []).some((c) => !c.ok && c.fix);
  $('fix').hidden = !(fixable && h.verdict !== 'ok');
  $('vbsAllow').hidden = !(h.checks || []).some((c) => c.id === 'vbs' && !c.ok);
  if (msg) setText($('heroSub'), msg + ' · ' + (h.windows || ''));
  renderOptStatus();
}

async function runHealth() {
  $('check').disabled = true; $('fix').disabled = true;
  $('hero').className = 'hero checking'; setText($('heroIcon'), '…'); setText($('heroTitle'), 'Checking…');
  const res = await window.wizard.runStep('health', { installDir: state.installDir });
  $('check').disabled = false; $('fix').disabled = false;
  if (res.data && res.data.checks) { renderHealth(res.data); return res.data; }
  $('hero').className = 'hero fail'; setText($('heroIcon'), '✕'); setText($('heroTitle'), 'Could not check'); setText($('heroSub'), res.message || '');
  return null;
}

async function runFix() {
  $('check').disabled = true; $('fix').disabled = true;
  setText($('heroTitle'), 'Fixing…');
  const log = $('healthLog'); log.hidden = false; log.textContent = '';
  const res = await window.wizard.runStep('fix', { installDir: state.installDir, disableVbs: $('vbsAllowBox').checked });
  $('check').disabled = false; $('fix').disabled = false;
  if (res.data && res.data.checks) renderHealth(res.data, res.message);
  else { setText($('heroTitle'), 'Could not fix'); setText($('heroSub'), res.message || ''); }
}

// ---------------------------------------------------------------- system analysis
function renderSpecs(d) {
  const dl = $('specs'); dl.textContent = '';
  const rows = [
    ['Computer', [d.manufacturer, d.model].filter(Boolean).join(' ')],
    ['Processor', d.cpu], ['Graphics', d.gpu || 'unknown'], ['Memory', d.ramGB ? d.ramGB + ' GB' : 'unknown'],
    ['Windows', d.osVersion], ['Power plan', d.powerPlan || 'unknown'],
    ['Virtualization-based security', d.hypervisorPresent ? 'On (blocks voltage changes)' : 'Off'],
    ['ThrottleStop', d.throttleStopFound ? (d.throttleStopRunning ? 'Installed and running' : 'Installed, not running') : 'Not installed'],
    ['Always-on startup task', d.taskInstalled ? 'Installed' : 'Not installed']
  ];
  rows.forEach(([k, v]) => { const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; dl.append(dt, dd); });
}

async function runAnalysis() {
  $('analyze').disabled = true; showResult2($('analysisResult'), '', '');
  const res = await window.wizard.runStep('detect', { installDir: state.installDir });
  $('analyze').disabled = false;
  if (res.data) { state.analysis = res.data; renderSpecs(res.data); }
  showResult2($('analysisResult'), res.ok ? (res.data && !res.data.modelVerified ? 'warn' : 'ok') : 'fail', res.message || '');
}

function showResult2(el, kind, text) { if (!text) { el.hidden = true; return; } el.hidden = false; el.className = 'result ' + kind; setText(el, text); }

// ---------------------------------------------------------------- optimizations catalog
function renderOptStatus() {
  const chip = $('optStatus'); const h = state.health;
  if (!h) { setText(chip, 'Checking…'); chip.className = 'chip status'; return; }
  if (h.installed === false) { setText(chip, 'Not set up'); chip.className = 'chip status none'; }
  else if (h.verdict === 'ok') { setText(chip, 'Optimized'); chip.className = 'chip status ok'; }
  else if (h.verdict === 'warn') { setText(chip, 'Needs a look'); chip.className = 'chip status warn'; }
  else { setText(chip, 'Needs attention'); chip.className = 'chip status fail'; }
  setText($('openThrottle'), h.installed === false ? 'Start setup' : 'Open setup');
}

// ---------------------------------------------------------------- setup wizard (CPU thermal tuning)
function renderStepper() {
  const ol = $('stepper'); ol.textContent = '';
  STEPS.forEach((s, i) => {
    const li = document.createElement('li');
    const st = state.status[i];
    li.className = [i === state.index ? 'active' : '', st !== 'idle' ? st : ''].join(' ').trim();
    const dot = document.createElement('span'); dot.className = 'dot';
    dot.textContent = st === 'ok' ? '✓' : st === 'fail' ? '!' : String(i);
    const label = document.createElement('span'); label.textContent = s.title;
    li.append(dot, label); ol.append(li);
  });
}

function showResult(kind, text) { showResult2($('result'), kind, text); }

function renderOptions(step) {
  const box = $('options'); box.textContent = '';
  (step.options || []).forEach((o) => {
    if (o === 'zip') {
      const pick = document.createElement('button'); pick.className = 'btn small'; pick.type = 'button'; pick.textContent = 'Choose zip…';
      const lbl = document.createElement('span'); lbl.className = 'muted'; lbl.style.margin = '0';
      lbl.textContent = state.zipPath || 'Automatic: newest ThrottleStop*.zip in Downloads';
      pick.addEventListener('click', async () => { const p = await window.wizard.pickZip(); if (p) { state.zipPath = p; lbl.textContent = p; } });
      const link = document.createElement('button'); link.className = 'btn small ghost'; link.type = 'button'; link.textContent = 'Open download page';
      link.addEventListener('click', () => window.wizard.openExternal('https://www.techpowerup.com/download/techpowerup-throttlestop/'));
      box.append(pick, link, lbl);
    }
    if (o === 'vbs') {
      const label = document.createElement('label'); label.className = 'check';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = state.disableVbs;
      cb.addEventListener('change', () => { state.disableVbs = cb.checked; });
      const t = document.createElement('span'); t.textContent = 'Yes, disable VBS/hypervisor (required for the undervolt)';
      label.append(cb, t); box.append(label);
    }
  });
}

function renderStep() {
  const s = STEPS[state.index];
  setText($('kicker'), 'CPU thermal tuning · ' + s.kicker); setText($('title'), s.title); setText($('desc'), s.desc);
  const ul = $('changes'); ul.textContent = '';
  s.changes.forEach((c) => { const li = document.createElement('li'); li.textContent = c; ul.append(li); });
  renderOptions(s);
  $('log').textContent = ''; showResult('', '');
  const st = state.status[state.index];
  $('run').disabled = false; setText($('run'), st === 'ok' ? 'Run again' : 'Run this step');
  $('next').disabled = st !== 'ok';
  setText($('next'), state.index === STEPS.length - 1 ? 'Finish ›' : 'Next ›');
  renderStepper();
}

async function runStep(auto) {
  const i = state.index, s = STEPS[i];
  state.status[i] = 'running'; renderStepper();
  $('run').disabled = true; $('next').disabled = true; $('log').textContent = ''; showResult('', '');
  const res = await window.wizard.runStep(s.id, { installDir: state.installDir, zipPath: state.zipPath, disableVbs: state.disableVbs });
  state.status[i] = res.ok ? 'ok' : 'fail';
  if (s.id === 'vbs' && res.ok && state.disableVbs) state.vbsRan = true;
  const warn = res.ok && s.id === 'detect' && res.data && !res.data.modelVerified;
  showResult(res.ok ? (warn ? 'warn' : 'ok') : 'fail', res.message || (res.ok ? 'Done.' : 'Failed.'));
  $('run').disabled = false; setText($('run'), res.ok ? 'Run again' : 'Try again');
  $('next').disabled = !res.ok;
  renderStepper();
  if (auto && res.ok) $('next').focus();
}

function next() {
  if (state.index < STEPS.length - 1) { state.index++; renderStep(); }
  else {
    showView('finish');
    setText($('finishText'), state.vbsRan
      ? 'Reboot Windows once so the VBS change takes effect, then open this app again: the Dashboard will tell you whether everything is in place. After that, ThrottleStop starts by itself at every logon.'
      : 'ThrottleStop starts by itself at every logon and the watchdog keeps it running. Open the Dashboard any time (for example after a Windows update) to check that the optimization is still in place.');
  }
}

// ---------------------------------------------------------------- restore
async function rollback() {
  if (!window.confirm('Remove the autostart task and restore the newest ThrottleStop.ini backup?')) return;
  $('rollback').disabled = true;
  const res = await window.wizard.runStep('rollback', { installDir: state.installDir, restoreVbs: $('restoreVbs').checked });
  $('rollback').disabled = false;
  state.status = STEPS.map(() => 'idle'); state.index = 0; state.wizardStarted = false; state.health = null;
  showResult2($('restoreResult'), res.ok ? 'ok' : 'fail', res.ok ? 'Rolled back: ' + (res.data || []).join('; ') : res.message);
}

// ---------------------------------------------------------------- start
async function init() {
  window.wizard.onLog((step, line) => {
    const log = step === 'fix' ? $('healthLog') : $('log');
    log.textContent += line + '\n'; log.scrollTop = log.scrollHeight;
  });
  $('run').addEventListener('click', () => runStep(false));
  $('next').addEventListener('click', next);
  $('rollback').addEventListener('click', rollback);
  $('check').addEventListener('click', runHealth);
  $('fix').addEventListener('click', runFix);
  $('analyze').addEventListener('click', runAnalysis);
  $('openThrottle').addEventListener('click', () => showView('wizard'));
  $('backToOpt').addEventListener('click', () => showView('optimizations'));
  $('toHealth').addEventListener('click', () => { showView('health'); runHealth(); });
  document.querySelectorAll('[data-link]').forEach((b) => b.addEventListener('click', () => window.wizard.openExternal(b.dataset.link)));
  document.querySelectorAll('.nav-btn').forEach((b) => b.addEventListener('click', () => { showView(b.dataset.view); if (b.dataset.view === 'health') runHealth(); }));

  const info = await window.wizard.info();
  state.info = info; state.installDir = info.defaultInstallDir;
  if (info.version) setText($('ver'), info.version);
  if (info.platform !== 'win32') {
    const name = info.platform === 'darwin' ? 'macOS' : 'Linux';
    document.querySelector('.nav').hidden = true; $('stepper').hidden = true; $('unsupported').hidden = false; document.querySelector('.side-note').hidden = true;
    ['health', 'analysis', 'optimizations', 'wizard', 'finish', 'restore', 'help'].forEach((v) => { $(v).hidden = true; });
    setText($('unsupportedTitle'), name + ' is not supported yet');
    setText($('unsupportedText'), info.platform === 'darwin'
      ? 'This tuning relies on ThrottleStop and Intel FIVR voltage controls, which only exist on Windows. macOS has no equivalent for this CPU. Detected: ' + info.cpu + '.'
      : 'This tuning relies on ThrottleStop, which only exists on Windows. A Linux backend (power limits and boost caps) is planned; undervolting is often locked on 13th/14th-gen chips. Detected: ' + info.cpu + '.');
    return;
  }
  if (!info.isAdmin) {
    $('banner').hidden = false;
    setText($('bannerText'), 'Administrator rights are needed to fix or change settings. Checking works without them.');
    $('bannerBtn').addEventListener('click', () => window.wizard.relaunchAdmin());
  }
  // Home = Dashboard when the tuning was set up before; otherwise guide the user into the setup.
  showView('health');
  const h = await runHealth();
  if (h && h.installed === false) showView('optimizations');
}

init();
