'use strict';
// Demo mode (WIZARD_DEMO=1): canned step results so the UI can be exercised and screenshotted for the docs without
// touching the machine. WIZARD_DEMO_SCENARIO: "ok" (default) or "updated" (a Windows update undid part of the tuning).
// Results carry the same language-neutral codes as scripts/Steps.ps1, so the screenshots can be taken in any language.

const HW = {
  os: 'windows', osVersion: 'Microsoft Windows 11 Home (build 26300)', manufacturer: 'LENOVO', model: '83DE',
  cpu: 'Intel(R) Core(TM) i9-14900HX', cpuSupported: true, modelVerified: true, isAdmin: true, hypervisorPresent: false,
  gpu: 'NVIDIA GeForce RTX 4090 Laptop GPU', ramGB: 32, powerPlan: 'Legion Balance Mode',
  throttleStopFound: true, throttleStopRunning: true, taskInstalled: true
};

const state = { scenario: process.env.WIZARD_DEMO_SCENARIO || 'ok', fixed: false };

function healthReport() {
  const updated = state.scenario === 'updated' && !state.fixed;
  const checks = [
    { id: 'settings', name: 'Tuning settings', ok: !updated, severity: 'fail', fix: 'settings',
      code: updated ? 'check.settings.drift' : 'check.settings.ok', args: { keys: 'OneAD_EAX0, PowerLimitEAX0' },
      detail: updated ? 'Changed or missing: OneAD_EAX0, PowerLimitEAX0' : 'Undervolt, boost caps and power limits are in the INI.' },
    { id: 'running', name: 'ThrottleStop is running', ok: true, severity: 'warn', fix: 'start', code: 'check.running.ok', args: { pid: 9176 }, detail: 'PID 9176' },
    { id: 'task', name: 'Always-on startup', ok: true, severity: 'fail', fix: 'task', code: 'check.task.ok', args: {}, detail: 'Starts at logon and a 5-minute watchdog keeps it running.' },
    { id: 'vbs', name: 'Virtualization-based security off', ok: !updated, severity: 'fail', fix: 'vbs',
      code: updated ? 'check.vbs.no' : 'check.vbs.ok', args: {},
      detail: updated ? 'VBS/hypervisor is back ON (a Windows update can do this). Voltage changes are locked while it is on.' : 'Off, so voltage changes can be applied.' },
    { id: 'windows', name: 'Windows build since setup', ok: !updated, severity: 'info', fix: null,
      code: updated ? 'check.windows.no' : 'check.windows.ok',
      args: updated ? { from: 26300, to: 26311, applied: '2026-10-10T22:30:00' } : { build: 26300, applied: '2026-10-10T22:30:00' },
      detail: updated ? 'Windows was updated: build 26300 -> 26311.' : 'Unchanged (build 26300).' },
    { id: 'cap', name: 'Boost cap is active', ok: !updated, severity: 'warn', fix: 'settings',
      code: updated ? 'check.cap.no' : 'check.cap.ok', args: { clock: updated ? 5387 : 4689, cap: 4700 },
      detail: updated ? 'A P-core is at 5387 MHz, above the 4700 MHz cap.' : 'Highest P-core clock right now: 4689 MHz (cap 4700 MHz).' }
  ];
  const bad = checks.filter((c) => !c.ok);
  const verdict = bad.some((c) => c.severity === 'fail') ? 'fail' : bad.some((c) => c.severity === 'warn') ? 'warn' : 'ok';
  return { verdict, checks, installed: true, windows: 'Microsoft Windows 11 Home (build ' + (updated ? 26311 : 26300) + ')', checkedAt: '2026-10-10T22:40:00',
    live: { pClockMaxMHz: updated ? 5387 : 4689, eClockMaxMHz: updated ? 4090 : 3591, packageTempC: updated ? 91 : 68, packagePowerW: updated ? 118.4 : 31.5 } };
}

const ok = (code, args, message, data) => ({ ok: true, code, args: args || {}, message, data });
const STEP = {
  detect: { logs: ['LENOVO 83DE - Intel(R) Core(TM) i9-14900HX', 'Microsoft Windows 11 Home (build 26300)'], res: ok('msg.detect.supported', { manufacturer: 'LENOVO', model: '83DE' }, 'Supported: LENOVO 83DE with i9-14900HX.', HW) },
  backup: { logs: ['backup: C:\\Tools\\ThrottleStop\\ThrottleStop.ini.bak_20261010_223012'], res: ok('msg.backup.done', {}, 'ThrottleStop.ini backed up.') },
  get: { logs: ['C:\\Tools\\ThrottleStop\\ThrottleStop.exe'], res: ok('msg.get.ready', {}, 'ThrottleStop is ready.') },
  vbs: { logs: ['hypervisorlaunchtype=off, VBS=0, HVCI=0'], res: ok('msg.vbs.disabled', {}, 'VBS/hypervisor disabled.') },
  apply: { logs: ['settings: <repo>\\config\\ThrottleStop.settings.ini'], res: ok('msg.apply.done', { keys: 17 }, '17 settings written to ThrottleStop.ini.') },
  task: { logs: ['ThrottleStop started', 'baseline saved (Windows build at setup time)'], res: ok('msg.task.done', { user: 'KAFKA\\carlo' }, 'Autostart + 5-minute watchdog registered.') },
  verify: { logs: ['ThrottleStop.ini settings: OK (17/17 keys match)', 'ThrottleStop running: OK (PID 9176)', 'Autostart + watchdog task: OK (state Ready)', 'Hypervisor/VBS off (needed for undervolt): OK (off)'],
    res: ok('msg.verify.ok', {}, 'Everything checks out.') },
  autostart: { logs: [], res: ok('msg.autostart.statusOff', {}, 'Does not start with Windows.', { enabled: false }) },
  paths: { logs: [], res: ok('msg.paths.ok', { dir: 'C:\\Tools\\ThrottleStop' }, 'C:\\Tools\\ThrottleStop', { installDir: 'C:\\Tools\\ThrottleStop', found: true }) },
  cleanbackups: { logs: [], res: ok('msg.backups.deleted', { count: 2 }, 'Deleted 2 old backup(s); the newest 3 were kept.', { count: 2 }) },
  rollback: { logs: ['task removed', 'ThrottleStop.ini restored from ThrottleStop.ini.bak_20261010_223012'], res: ok('msg.rollback.done', {}, 'Rolled back.', ['task removed', 'ThrottleStop.ini restored']) }
};

// Returns { logs, res } for a step.
// Tweaks in demo mode: the real catalog, with a believable starting state (most recommended ones already on).
const tweakState = {};
function catalog(configDir) { return JSON.parse(require('fs').readFileSync(require('path').join(configDir, 'tweaks.json'), 'utf8')).tweaks; }
function tweakList(configDir) {
  const cat = catalog(configDir);
  return cat.map((t) => {
    if (!(t.id in tweakState)) tweakState[t.id] = (t.recommended && t.id.length % 3 !== 0) || t.id === 'file-extensions-on';
    const unavailable = t.minBuild && t.minBuild > 26300;
    return { id: t.id, category: t.category, risk: t.risk, recommended: !!t.recommended, needsReboot: !!t.needsReboot,
      needsAdmin: t.actions.some((a) => a.path ? a.path.startsWith('HKLM') : a.type !== 'powerplan' && a.type !== 'regkey'),
      status: unavailable ? 'unavailable' : (tweakState[t.id] ? 'active' : 'inactive') };
  });
}

const cleanState = { 'user-temp': [428e6, 1224], 'win-temp': [64e6, 310], prefetch: [38e6, 212], 'update-cache': [1.6e9, 41], thumbnails: [11e6, 15], 'recycle-bin': [1.2e6, 57] };
function cleanTargets() { return Object.entries(cleanState).map(([id, [bytes, files]]) => ({ id, danger: id === 'recycle-bin', bytes, files })); }

const restorePoints = [
  { id: 12, description: 'KafkaBoost: before the first tweak', created: '2026-10-10T22:31:00', type: 'settings' },
  { id: 11, description: 'Windows Update', created: '2026-10-08T03:12:00', type: 'install' }
];

function demoStep(step, opts = {}, configDir) {
  if (step === 'restore-list') return { logs: [], res: { ok: true, code: 'msg.restore.listed', args: { count: restorePoints.length }, message: 'ok', data: { admin: true, points: restorePoints.slice() } } };
  if (step === 'restore-create') {
    const id = restorePoints[0].id + 1; restorePoints.unshift({ id, description: String(opts.restoreName || 'KafkaBoost'), created: new Date().toISOString().slice(0, 19), type: 'settings' });
    return { logs: [], res: { ok: true, code: 'msg.restore.created', args: {}, message: 'ok', data: { ok: true, created: true, id, code: 'msg.restore.created' } } };
  }
  if (step === 'restore-open') return { logs: [], res: { ok: true, code: 'msg.restore.opened', args: {}, message: 'ok', data: null } };
  if (step === 'cleanup-scan') { const l = cleanTargets(); const mb = Math.round(l.filter((x) => !x.danger).reduce((s, x) => s + x.bytes, 0) / 1048576); return { logs: [], res: { ok: true, code: 'msg.cleanup.scanned', args: { mb }, message: mb + ' MB', data: { targets: l, admin: true } } }; }
  if (step === 'cleanup-run') {
    const ids = String(opts.cleanupIds || '').split(',').filter(Boolean); let bytes = 0, files = 0;
    ids.forEach((id) => { if (cleanState[id]) { bytes += cleanState[id][0]; files += cleanState[id][1]; cleanState[id] = [0, 0]; } });
    return { logs: ids.map((i) => i + ': cleaned'), res: { ok: true, code: 'msg.cleanup.done', args: { mb: Math.round(bytes / 104857.6) / 10, files, skipped: 0 }, message: 'ok', data: { bytes, files, skipped: 0 } } };
  }
  if (step === 'tweaks-list') { const l = tweakList(configDir); return { logs: [], res: { ok: true, code: 'msg.tweaks.listed', args: { count: l.length }, message: l.length + ' tweaks.', data: { tweaks: l, admin: true, build: 26300 } } }; }
  if (step === 'tweak-set') {
    const t = catalog(configDir).find((x) => x.id === opts.tweakId);
    if (!t) return { logs: [], res: { ok: false, code: 'tweak.error.unknown', args: { id: opts.tweakId }, message: 'Unknown tweak' } };
    if (opts.tweakMode !== 'off' && t.risk === 'risky' && !opts.allowRisky) return { logs: [], res: { ok: false, code: 'tweak.error.riskyNeedsConsent', args: {}, message: 'needs consent' } };
    tweakList(configDir); tweakState[t.id] = opts.tweakMode !== 'off';
    return { logs: [t.id + ' -> ' + (opts.tweakMode || 'on')], res: { ok: true, code: tweakState[t.id] ? 'tweak.msg.applied' : 'tweak.msg.reverted', args: { id: t.id }, message: 'ok', data: { id: t.id, enabled: tweakState[t.id], needsReboot: !!t.needsReboot } } };
  }
  if (step === 'tweaks-recommended') {
    const todo = tweakList(configDir).filter((t) => t.risk === 'safe' && t.recommended && t.status === 'inactive');
    todo.forEach((t) => { tweakState[t.id] = true; });
    return { logs: todo.map((t) => t.id + ': applied'), res: { ok: true, code: 'msg.tweaks.recommendedOk', args: { ok: todo.length, failed: 0 }, message: 'ok', data: { results: todo.map((t) => ({ ok: true, id: t.id })) } } };
  }
  if (step === 'health') {
    const h = healthReport();
    return { logs: h.checks.map((c) => `${c.name}: ${c.ok ? 'OK' : 'ATTENTION'} - ${c.detail}`),
      res: { ok: h.verdict !== 'fail', code: 'msg.health.' + h.verdict, args: {}, message: h.verdict, data: h } };
  }
  if (step === 'fix') {
    state.fixed = true; const h = healthReport();
    return { logs: ['backup: ThrottleStop.ini.bak_20261010_224012', '17 settings re-applied', 'VBS/hypervisor disabled - reboot required', 'ThrottleStop started'],
      res: { ok: true, code: 'msg.fix.ok', args: {}, message: 'Fixed. Your PC is optimized again.', data: h } };
  }
  return STEP[step] || { logs: [], res: { ok: false, message: 'Not available in demo mode: ' + step } };
}

module.exports = { demoStep, state };
