'use strict';
// Demo mode (WIZARD_DEMO=1): canned step results so the UI can be exercised and screenshotted for the docs without
// touching the machine. WIZARD_DEMO_SCENARIO: "ok" (default) or "updated" (a Windows update undid part of the tuning).

const HW = { os: 'windows', osVersion: 'Microsoft Windows 11 Home (build 26300)', manufacturer: 'LENOVO', model: '83DE',
  cpu: 'Intel(R) Core(TM) i9-14900HX', cpuSupported: true, modelVerified: true, isAdmin: true, hypervisorPresent: false,
  gpu: 'NVIDIA GeForce RTX 4090 Laptop GPU', ramGB: 32, powerPlan: 'Legion Balance Mode', throttleStopFound: true, throttleStopRunning: true, taskInstalled: true };

const state = { scenario: process.env.WIZARD_DEMO_SCENARIO || 'ok', fixed: false };

function healthReport() {
  const updated = state.scenario === 'updated' && !state.fixed;
  const checks = [
    { id: 'settings', name: 'Tuning settings', ok: !updated, severity: 'fail', fix: 'settings',
      detail: updated ? 'Changed or missing: OneAD_EAX0 (want 0x2F2F2F2F, found 0x34343636); PowerLimitEAX0 (want 0x00DF8208, found 0x00DF8460)' : 'Undervolt, boost caps and power limits are in the INI.' },
    { id: 'running', name: 'ThrottleStop is running', ok: true, severity: 'warn', detail: 'PID 9176', fix: 'start' },
    { id: 'task', name: 'Always-on startup', ok: true, severity: 'fail', detail: 'Starts at logon and a 5-minute watchdog keeps it running.', fix: 'task' },
    { id: 'vbs', name: 'Virtualization-based security off', ok: !updated, severity: 'fail', fix: 'vbs',
      detail: updated ? 'VBS/hypervisor is back ON (a Windows update can do this). Voltage changes are locked while it is on.' : 'Off, so voltage changes can be applied.' },
    { id: 'windows', name: 'Windows build since setup', ok: !updated, severity: 'info', fix: null,
      detail: updated ? 'Windows was updated: build 26300 -> 26311 since the tuning was applied on 2026-10-10T22:30:00.' : 'Unchanged (build 26300, applied 2026-10-10T22:30:00).' },
    { id: 'cap', name: 'Boost cap is active', ok: !updated, severity: 'warn', fix: 'settings',
      detail: updated ? 'A P-core is at 5387 MHz, above the 4700 MHz cap.' : 'Highest P-core clock right now: 4689 MHz (cap 4700 MHz).' }
  ];
  const bad = checks.filter((c) => !c.ok);
  const verdict = bad.some((c) => c.severity === 'fail') ? 'fail' : bad.some((c) => c.severity === 'warn') ? 'warn' : 'ok';
  return { verdict, checks, installed: true, windows: 'Microsoft Windows 11 Home (build ' + (updated ? 26311 : 26300) + ')', checkedAt: '2026-10-10T22:40:00',
    live: { pClockMaxMHz: updated ? 5387 : 4689, eClockMaxMHz: updated ? 4090 : 3591, packageTempC: updated ? 91 : 68, packagePowerW: updated ? 118.4 : 31.5 } };
}

const STEP = {
  detect: { logs: ['LENOVO 83DE - Intel(R) Core(TM) i9-14900HX', 'Microsoft Windows 11 Home (build 26300)'], res: { ok: true, message: 'Supported: Lenovo 83DE with i9-14900HX.', data: HW } },
  backup: { logs: ['backup: C:\\Tools\\ThrottleStop\\ThrottleStop.ini.bak_20261010_223012'], res: { ok: true, message: 'ThrottleStop.ini backed up.' } },
  get: { logs: ['C:\\Tools\\ThrottleStop\\ThrottleStop.exe'], res: { ok: true, message: 'ThrottleStop is ready.' } },
  vbs: { logs: ['hypervisorlaunchtype=off, VBS=0, HVCI=0'], res: { ok: true, message: 'VBS/hypervisor disabled. Reboot required (also switch Memory integrity off in Windows Security).' } },
  apply: { logs: ['settings: <repo>\\config\\ThrottleStop.settings.ini'], res: { ok: true, message: '17 settings written to ThrottleStop.ini.' } },
  task: { logs: ['ThrottleStop started', 'baseline saved (Windows build at setup time)'], res: { ok: true, message: 'Autostart + 5-minute watchdog registered for KAFKA\\carlo.' } },
  verify: { logs: ['ThrottleStop.ini settings: OK (17/17 keys match)', 'ThrottleStop running: OK (PID 9176)', 'Autostart + watchdog task: OK (state Ready)', 'Hypervisor/VBS off (needed for undervolt): OK (off)'],
    res: { ok: true, message: 'Everything checks out.' } },
  rollback: { logs: ['task removed', 'ThrottleStop.ini restored from ThrottleStop.ini.bak_20261010_223012'], res: { ok: true, message: 'Rolled back.', data: ['task removed', 'ThrottleStop.ini restored'] } }
};

// Returns { logs, res } for a step.
function demoStep(step) {
  if (step === 'health') { const h = healthReport(); return { logs: h.checks.map((c) => `${c.name}: ${c.ok ? 'OK' : 'ATTENTION'} - ${c.detail}`),
    res: { ok: h.verdict !== 'fail', message: h.verdict === 'ok' ? 'Your PC is still optimized.' : h.verdict === 'warn' ? 'Mostly fine, one thing needs a look.' : 'The optimization is not fully in place.', data: h } }; }
  if (step === 'fix') { state.fixed = true; const h = healthReport();
    return { logs: ['backup: ThrottleStop.ini.bak_20261010_224012', '17 settings re-applied', 'VBS/hypervisor disabled - reboot required', 'ThrottleStop started'],
      res: { ok: true, message: 'Fixed. Your PC is optimized again.', data: h } }; }
  return STEP[step];
}

module.exports = { demoStep, state };
