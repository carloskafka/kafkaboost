'use strict';

const STEPS = [
  { id: 'detect', title: 'Detect your hardware', kicker: 'Safety check',
    desc: 'Reads your operating system, CPU and laptop model. The tuning values are specific to the Intel Core i9-14900HX, so the wizard refuses to continue on any other CPU.',
    changes: ['Nothing is changed in this step.'] },
  { id: 'backup', title: 'Back up current settings', kicker: 'Step 2',
    desc: 'Saves a timestamped copy of ThrottleStop.ini so you can always return to where you started.',
    changes: ['Creates ThrottleStop.ini.bak_<date> next to the ini (skipped on a fresh install).'] },
  { id: 'get', title: 'Get ThrottleStop', kicker: 'Step 3',
    desc: 'Unpacks ThrottleStop (tested with 9.7.3) into the install folder. Download the zip from TechPowerUp first and keep it in Downloads, or pick it manually.',
    changes: ['Extracts the zip to C:\\Tools\\ThrottleStop (or the folder you chose).'], options: ['zip'] },
  { id: 'vbs', title: 'Turn off VBS / hypervisor', kicker: 'Step 4',
    desc: 'ThrottleStop can only change CPU voltages while Windows virtualization-based security is off. This is a security setting, so it is your choice.',
    changes: ['bcdedit hypervisorlaunchtype off, VBS off, memory integrity off.', 'Breaks WSL2 and Docker (WSL2) until you roll back.', 'Needs a reboot to take effect.'], options: ['vbs'] },
  { id: 'apply', title: 'Apply the tuning', kicker: 'Step 5',
    desc: 'Writes the tested profile into ThrottleStop.ini.',
    changes: ['Undervolt: -100 mV core and P-cache, -90 mV E-cache.', 'Boost caps: P-cores 47x (4.7 GHz), E-cores 36x (3.6 GHz).', 'Power limits: PL1 65 W / PL2 85 W.'] },
  { id: 'task', title: 'Always-on startup', kicker: 'Step 6',
    desc: 'Registers a Windows scheduled task so ThrottleStop starts at every logon and a 5-minute watchdog brings it back if it is closed. It never starts a second copy.',
    changes: ['Task "ThrottleStop_Autostart", highest privileges, no battery limits.', 'Starts ThrottleStop now.'] },
  { id: 'verify', title: 'Verify', kicker: 'Final check',
    desc: 'Compares the saved settings with the profile and checks that ThrottleStop, the task and the hypervisor setting are in the expected state.',
    changes: ['Read-only. If VBS was just disabled, reboot first and run this again.'] }
];

const $ = (id) => document.getElementById(id);
const state = { index: 0, status: STEPS.map(() => 'idle'), info: null, zipPath: null, disableVbs: true, vbsRan: false, installDir: null };

function setText(el, text) { el.textContent = text; }

function renderStepper() {
  const ol = $('stepper'); ol.textContent = '';
  STEPS.forEach((s, i) => {
    const li = document.createElement('li');
    const st = state.status[i];
    li.className = [i === state.index ? 'active' : '', st !== 'idle' ? st : ''].join(' ').trim();
    const dot = document.createElement('span'); dot.className = 'dot';
    dot.textContent = st === 'ok' ? '✓' : st === 'fail' ? '!' : String(i + 1);
    const label = document.createElement('span'); label.textContent = s.title;
    li.append(dot, label); ol.append(li);
  });
}

function showResult(kind, text) {
  const r = $('result');
  if (!text) { r.hidden = true; return; }
  r.hidden = false; r.className = 'result ' + kind; setText(r, text);
}

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
  $('wizard').hidden = false; $('finish').hidden = true;
  setText($('kicker'), s.kicker); setText($('title'), s.title); setText($('desc'), s.desc);
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
    $('wizard').hidden = true; $('finish').hidden = false;
    setText($('finishText'), state.vbsRan
      ? 'Reboot Windows once so the VBS change takes effect, then open this app again and run "Verify". After that, ThrottleStop starts by itself at every logon.'
      : 'ThrottleStop starts by itself at every logon and the watchdog keeps it running.');
  }
}

async function rollback() {
  if (!window.confirm('Remove the autostart task and restore the newest ThrottleStop.ini backup?')) return;
  const res = await window.wizard.runStep('rollback', { installDir: state.installDir, restoreVbs: $('restoreVbs').checked });
  state.status = STEPS.map(() => 'idle'); state.index = 0; renderStep();
  showResult(res.ok ? 'ok' : 'fail', res.ok ? 'Rolled back: ' + (res.data || []).join('; ') : res.message);
}

async function init() {
  window.wizard.onLog((step, line) => { const log = $('log'); log.textContent += line + '\n'; log.scrollTop = log.scrollHeight; });
  $('run').addEventListener('click', () => runStep(false));
  $('next').addEventListener('click', next);
  $('rollback').addEventListener('click', rollback);

  const info = await window.wizard.info();
  state.info = info; state.installDir = info.defaultInstallDir;
  if (info.platform !== 'win32') {
    const name = info.platform === 'darwin' ? 'macOS' : 'Linux';
    $('stepper').textContent = ''; $('unsupported').hidden = false; document.querySelector('.side-foot').hidden = true;
    setText($('unsupportedTitle'), name + ' is not supported yet');
    setText($('unsupportedText'), info.platform === 'darwin'
      ? 'This tuning relies on ThrottleStop and Intel FIVR voltage controls, which only exist on Windows. macOS has no equivalent for this CPU. Detected: ' + info.cpu + '.'
      : 'This tuning relies on ThrottleStop, which only exists on Windows. A Linux backend (power limits and boost caps) is planned; undervolting is often locked on 13th/14th-gen chips. Detected: ' + info.cpu + '.');
    return;
  }
  if (!info.isAdmin) {
    $('banner').hidden = false;
    setText($('bannerText'), 'Administrator rights are needed to change settings (steps 2–6).');
    $('bannerBtn').addEventListener('click', () => window.wizard.relaunchAdmin());
  }
  renderStep();
  runStep(true);   // hardware detection runs automatically
}

init();
