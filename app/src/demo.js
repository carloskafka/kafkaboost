'use strict';
// Demo mode (WIZARD_DEMO=1): canned step results so the UI can be exercised and screenshotted for the docs without
// touching the machine. WIZARD_DEMO_SCENARIO: "ok" (default) or "updated" (a Windows update undid part of the tuning).
// Results carry the same language-neutral codes as scripts/Steps.ps1, so the screenshots can be taken in any language.

const HW = {
  os: 'windows', osVersion: 'Microsoft Windows 11 Home (build 26300)', manufacturer: 'LENOVO', model: '83DE',
  cpu: 'Intel(R) Core(TM) i9-14900HX', cpuSupported: true, modelVerified: true, isAdmin: true, hypervisorPresent: false,
  gpu: 'NVIDIA GeForce RTX 4090 Laptop GPU', ramGB: 32, ramSpeedMHz: 5600, ramModules: 2, cpuCores: 24, cpuThreads: 32, powerPlan: 'Legion Balance Mode',
  disks: [{ model: 'Demo NVMe SSD 1TB', sizeGB: 1024, type: 'nvme' }, { model: 'Demo NVMe SSD 1TB', sizeGB: 1024, type: 'nvme' }],
  throttleStopFound: true, throttleStopRunning: true, taskInstalled: true
};

// telemetry: 'live' (HWiNFO shares its sensors) or 'unavailable' (it does not, or this process cannot read it: the Dashboard then asks for
// administrator rights or points to the HWiNFO card, depending on whether the app is elevated).
const state = { scenario: process.env.WIZARD_DEMO_SCENARIO || 'ok', fixed: false, telemetry: 'live' };
let telemetryTick = 0;

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


// Sensors (demo): canned readings that wobble a little on every read. Marked demo:true so the page says they are not from this PC.
// sensorsInstalled starts false so the consent card can be exercised; shots.js sets it true.
state.sensorsInstalled = false;
const SENSORS_CFG = { name: 'LibreHardwareMonitor', version: '0.9.6', license: 'MPL-2.0', sizeBytes: 6632626, url: 'https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases/download/v0.9.6/LibreHardwareMonitor.zip' };
let sensorTick = 0;
function sensorGroups() {
  sensorTick++;
  const w = (base, amp) => Math.round((base + Math.sin(sensorTick / 2 + base) * amp) * 10) / 10;
  const S = (name, type, unit, value, min, max) => ({ name, type, unit, value, min, max });
  const cores = [];
  for (let i = 1; i <= 8; i++) cores.push(S('CPU Core #' + i, 'Temperature', 'C', w(60 + i, 2.5), 48, 79));
  return [
    { id: 'cpu', hardware: [{ name: 'Intel Core i9-14900HX', type: 'Cpu', sensors: [
      S('CPU Package', 'Temperature', 'C', w(68, 3), 45, 84), ...cores,
      S('CPU Package', 'Power', 'W', w(31.5, 2), 12, 85), S('CPU Cores', 'Power', 'W', w(26, 2), 9, 78),
      S('CPU Core #1 P', 'Clock', 'MHz', w(4600, 60), 800, 4700), S('CPU Core #9 E', 'Clock', 'MHz', w(3500, 50), 800, 3600),
      S('CPU Total', 'Load', 'pct', w(14, 6), 2, 61), S('CPU Core Max', 'Load', 'pct', w(41, 10), 5, 96),
      S('CPU Core', 'Voltage', 'V', w(1.05, 0.02), 0.65, 1.2)] }] },
    { id: 'gpu', hardware: [{ name: 'NVIDIA GeForce RTX 4090 Laptop GPU', type: 'GpuNvidia', sensors: [
      S('GPU Core', 'Temperature', 'C', w(55, 2), 42, 71), S('GPU Hot Spot', 'Temperature', 'C', w(63, 2), 47, 79),
      S('GPU Package', 'Power', 'W', w(46, 5), 9, 150), S('GPU Core', 'Clock', 'MHz', w(1980, 40), 210, 2400),
      S('GPU Memory', 'Clock', 'MHz', 9000, 810, 9000), S('GPU Core', 'Load', 'pct', w(38, 8), 0, 99),
      S('GPU Memory Used', 'SmallData', 'MB', w(2100, 30), 1500, 6800)] }] },
    { id: 'motherboard', hardware: [{ name: 'LENOVO 83DE', type: 'Motherboard', sensors: [
      S('CPU Fan', 'Fan', 'RPM', w(2650, 120), 0, 5200), S('GPU Fan', 'Fan', 'RPM', w(2400, 100), 0, 5100),
      S('System', 'Temperature', 'C', w(41, 1), 33, 52)] }] },
    { id: 'memory', hardware: [{ name: 'Total Memory', type: 'Memory', sensors: [
      S('Memory Used', 'Data', 'GB', w(19.2, 0.3), 14, 27), S('Memory Available', 'Data', 'GB', w(12.4, 0.3), 5, 18), S('Memory', 'Load', 'pct', w(60, 1), 44, 85)] }] },
    { id: 'storage', hardware: [{ name: 'Samsung SSD 990 PRO 2TB', type: 'Storage', sensors: [
      S('Temperature', 'Temperature', 'C', w(44, 1.5), 36, 58), S('Used Space', 'Load', 'pct', 47.3, 47.3, 47.3)] }] }
  ];
}
function sensorStep(step) {
  const ok = (code, args, message, data) => ({ logs: [], res: { ok: true, code, args: args || {}, message, data } });
  if (step === 'sensors-state') return ok(state.sensorsInstalled ? 'msg.sensors.installed' : 'msg.sensors.missing', { version: SENSORS_CFG.version }, 'demo', { ...SENSORS_CFG, installed: state.sensorsInstalled, homepage: 'https://github.com/LibreHardwareMonitor/LibreHardwareMonitor' });
  if (step === 'sensors-get') { state.sensorsInstalled = true; return { logs: ['downloading LibreHardwareMonitor 0.9.6 (demo: nothing is downloaded)'], res: ok('msg.sensors.installed', { version: SENSORS_CFG.version }, 'demo').res }; }
  if (!state.sensorsInstalled) return { logs: [], res: { ok: false, code: 'msg.sensors.missing', args: {}, message: 'not installed', data: { installed: false, admin: true } } };
  const groups = sensorGroups(); let count = 0; groups.forEach((g) => g.hardware.forEach((h) => { count += h.sensors.length; }));
  return ok('msg.sensors.ok', {}, 'demo', { installed: true, admin: true, pawnio: true, cpuTemperature: true, count, source: 'Demo data', takenAt: new Date().toISOString().slice(0, 19), demo: true, groups });
}

// Counter-Strike 2 (demo): found through "Steam", a user autoexec.cfg already exists (so the backup path is exercised), nothing is written to disk.
// state.cs2.found = false shows the "not found" screen. Messages carry the same codes and args as scripts/lib/Cs2.ps1.
const CS2_DEMO_EXE = 'D:\\SteamLibrary\\steamapps\\common\\Counter-Strike Global Offensive\\game\\bin\\win64\\cs2.exe';
const CS2_DEMO_CFG = 'D:\\SteamLibrary\\steamapps\\common\\Counter-Strike Global Offensive\\game\\csgo\\cfg';
function resetCs2() { state.cs2 = { found: true, gpuHigh: false, exists: true, ours: false, backups: 0, hasOriginal: false }; }
resetCs2();
function cs2Catalog(configDir) { const c = JSON.parse(require('fs').readFileSync(require('path').join(configDir, 'cs2.json'), 'utf8')); return { autoexec: c.autoexec, launch: c.launch }; }
function cs2Overview(opts, configDir) {
  const c = state.cs2; const user = !!opts.cs2Exe;
  const catalog = cs2Catalog(configDir);
  if (!c.found && !user) return { found: false, source: 'steam', exe: null, others: [], steamPath: 'c:\\program files (x86)\\steam', libraryCount: 2, cfgDir: null, userExeInvalid: false, gpu: null, autoexec: null, catalog };
  return {
    found: true, source: user ? 'user' : 'steam', exe: opts.cs2Exe || CS2_DEMO_EXE, others: [], steamPath: user ? null : 'c:\\program files (x86)\\steam', libraryCount: user ? 0 : 2, cfgDir: CS2_DEMO_CFG, userExeInvalid: false,
    gpu: { pref: c.gpuHigh ? 2 : null, high: c.gpuHigh, entry: true, recorded: c.gpuHigh, data: c.gpuHigh ? 'AppStatus=0;AutoHDREnable=2097;GpuPreference=2;' : 'AppStatus=0;AutoHDREnable=2097;' },
    autoexec: { available: true, exists: c.exists, ours: c.ours, foreign: c.exists && !c.ours, backups: c.backups, hasOriginal: c.hasOriginal, file: CS2_DEMO_CFG + '\\autoexec.cfg' },
    catalog
  };
}
function cs2Step(step, opts, configDir) {
  const c = state.cs2;
  const res = (ok, code, args, message, data) => ({ logs: [code], res: { ok, code, args: args || {}, message, data } });
  if (step === 'cs2-state') { const o = cs2Overview(opts, configDir); return res(true, o.found ? 'msg.cs2.found' : 'msg.cs2.notFound', {}, 'demo', o); }
  if (!c.found && !opts.cs2Exe) return res(false, 'msg.cs2.badExe', {}, 'Choose the cs2.exe file.', null);
  if (step === 'cs2-gpu') {
    if (opts.cs2Mode === 'off') {
      if (!c.gpuHigh) return res(false, 'msg.cs2.gpuNotOurs', {}, 'not ours', cs2Overview(opts, configDir).gpu);
      c.gpuHigh = false; return res(true, 'msg.cs2.gpuReverted', {}, 'reverted', cs2Overview(opts, configDir).gpu);
    }
    if (c.gpuHigh) return res(true, 'msg.cs2.gpuAlready', {}, 'already', cs2Overview(opts, configDir).gpu);
    c.gpuHigh = true; return res(true, 'msg.cs2.gpuApplied', {}, 'applied', cs2Overview(opts, configDir).gpu);
  }
  // cs2-autoexec
  if (opts.cs2Mode === 'off') {
    if (c.exists && !c.ours) return res(false, 'msg.cs2.autoexecNotOurs', {}, 'not ours', cs2Overview(opts, configDir).autoexec);
    if (c.hasOriginal) { c.ours = false; c.exists = true; return res(true, 'msg.cs2.autoexecRestored', { backup: 'autoexec.cfg.bak_20261012_101500' }, 'restored', cs2Overview(opts, configDir).autoexec); }
    if (c.exists) { c.exists = false; c.ours = false; return res(true, 'msg.cs2.autoexecRemoved', {}, 'removed', cs2Overview(opts, configDir).autoexec); }
    return res(true, 'msg.cs2.autoexecNothing', {}, 'nothing', cs2Overview(opts, configDir).autoexec);
  }
  const cat = cs2Catalog(configDir).autoexec;
  const ids = String(opts.cs2Options || '').split(',').filter(Boolean);
  const bad = !ids.length || ids.some((id) => !cat.find((o) => o.id === id)) || (ids.includes('fpsmax') && !(Number(opts.cs2FpsMax) >= 30 && Number(opts.cs2FpsMax) <= 1000));
  if (bad) return res(false, 'msg.cs2.badOptions', { detail: 'Choose at least one valid option.' }, 'bad options', null);
  const backup = c.exists ? 'autoexec.cfg.bak_20261012_101500' : null;
  if (c.exists) { c.backups++; if (!c.ours) c.hasOriginal = true; }
  c.exists = true; c.ours = true;
  return res(true, backup ? 'msg.cs2.autoexecWrittenBackup' : 'msg.cs2.autoexecWritten', { backup }, 'written', cs2Overview(opts, configDir).autoexec);
}

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

// tweak-preview (demo): the same shape as scripts/lib/Tweaks.ps1 Get-TweakPreview. Current values are invented but believable: the value the
// tweak undoes (its catalog "off"), or "not set" when the catalog off is null.
function tweakPreview(ids, configDir) {
  const cat = catalog(configDir); tweakList(configDir);
  const want = ids.length ? ids : cat.filter((t) => t.risk === 'safe' && t.recommended && !tweakState[t.id]).map((t) => t.id);
  return want.map((id) => cat.find((t) => t.id === id)).filter(Boolean).map((t) => ({
    id: t.id, risk: t.risk, recommended: !!t.recommended, needsReboot: !!t.needsReboot,
    needsAdmin: t.actions.some((a) => a.path ? a.path.startsWith('HKLM') : a.type !== 'powerplan' && a.type !== 'regkey'),
    status: tweakState[t.id] ? 'active' : 'inactive',
    actions: t.actions.map((a) => {
      if (a.type === 'registry') {
        const set = a.off !== null && a.off !== undefined; const u = (v) => String(Number(v) >>> 0);
        return { type: 'registry', path: a.path, name: a.name, kind: a.kind, currentSet: set, current: set ? (a.kind === 'DWord' ? u(a.off) : String(a.off)) : null,
          new: a.kind === 'DWord' ? u(a.on) : String(a.on), alreadyInPlace: false, restoreDeletes: !set, restore: set ? (a.kind === 'DWord' ? u(a.off) : String(a.off)) : null };
      }
      if (a.type === 'regkey') return { type: 'regkey', path: a.path, currentSet: false, alreadyInPlace: false, restoreDeletes: true };
      if (a.type === 'service') return { type: 'service', name: a.name, found: true, current: 'Auto', running: true, new: a.on, restore: 'Auto' };
      if (a.type === 'powerplan') return { type: 'powerplan', current: 'Balanced', currentGuid: '381b4222-f694-41f0-9685-ff5bb260df2e', new: 'Ultimate Performance / High performance', restore: 'Balanced' };
      if (a.type === 'dns') return { type: 'dns', servers: a.servers.join(', '), adapters: [{ name: 'Ethernet', current: '', restoreAutomatic: true }] };
      if (a.type === 'defender') return { type: 'defender', currentOn: true };
      return { type: 'vbs', currentOn: false };
    })
  }));
}

const cleanState = { 'user-temp': [428e6, 1224], 'win-temp': [64e6, 310], prefetch: [38e6, 212], 'update-cache': [1.6e9, 41], thumbnails: [11e6, 15], 'recycle-bin': [1.2e6, 57] };
function cleanTargets() { return Object.entries(cleanState).map(([id, [bytes, files]]) => ({ id, danger: id === 'recycle-bin', bytes, files })); }

const restorePoints = [
  { id: 12, description: 'KafkaBoost: before the first tweak', created: '2026-10-10T22:31:00', type: 'settings' },
  { id: 11, description: 'Windows Update', created: '2026-10-08T03:12:00', type: 'install' }
];

// HWiNFO on demand (demo): nothing is downloaded or started. The card walks through missing -> checked -> installed -> running.
state.hwinfo = { installed: false, running: false };
const HW_DIR = 'C:\\ProgramData\\LegionTuning\\hwinfo\\8.54';
function hwinfoStep(step, opts) {
  const ok = (code, args, message, data) => ({ logs: [], res: { ok: true, code, args: args || {}, message, data } });
  const h = state.hwinfo;
  if (step === 'hwinfo-state') {
    return ok(h.installed ? 'msg.hwinfo.state.installed' : 'msg.hwinfo.state.missing', { version: '8.54-6090' }, 'demo', {
      installed: h.installed, source: h.installed ? 'own' : null, dir: h.installed ? HW_DIR : null, version: h.installed ? '8.54-6090' : null,
      running: h.running, runningHere: h.running, sharedMemory: h.running && !h.noSm, ini: h.installed ? (h.iniOff ? 'noSharedMemory' : 'ok') : 'none',
      name: 'HWiNFO', homepage: 'https://www.hwinfo.com/', downloadPage: 'https://www.hwinfo.com/download/', signer: 'REALiX',
      license: 'non-commercial use only', installRoot: 'C:\\ProgramData\\LegionTuning\\hwinfo'
    });
  }
  if (step === 'hwinfo-check') {
    return ok('msg.hwinfo.checked', { version: '8.54' }, 'demo', { name: 'HWiNFO', version: '8.54', url: 'https://www.hwinfo.com/files/hwi_854.zip', source: 'https://www.hwinfo.com/download/', signer: 'REALiX', license: 'non-commercial use only' });
  }
  if (step === 'hwinfo-get') {
    if (!opts.download && !opts.zipPath) return { logs: [], res: { ok: false, code: 'msg.hwinfo.consentNeeded', args: {}, message: 'consent needed', data: null } };
    h.installed = true;
    return { logs: ['downloading HWiNFO (demo: nothing is downloaded)', 'signature OK (REALiX, s.r.o.)'], res: ok('msg.hwinfo.installed', { version: '8.54' }, 'demo', { dir: HW_DIR, version: '8.54' }).res };
  }
  if (step === 'hwinfo-start') {
    if (h.iniOff && !opts.updateIni) return { logs: [], res: { ok: false, code: 'msg.hwinfo.iniNoSharedMemory', args: {}, message: 'ini', data: null } };
    h.iniOff = false; h.running = true;
    return ok('msg.hwinfo.started', {}, 'demo', { dir: HW_DIR });
  }
  h.running = false;
  return ok('msg.hwinfo.stopped', {}, 'demo', { stopped: 1 });
}

function demoStep(step, opts = {}, configDir) {
  if (step === 'telemetry') {
    telemetryTick++;
    const takenAt = new Date().toISOString().slice(0, 19);
    if (state.telemetry !== 'live') return { logs: [], res: { ok: true, code: 'msg.telemetry.unavailable', args: {}, message: 'No live readings', data: { available: false, live: null, takenAt } } };
    const l = healthReport().live;
    return { logs: [], res: { ok: true, code: 'msg.telemetry.ok', args: {}, message: 'read', data: { available: true, takenAt, live: { ...l, packageTempC: l.packageTempC + (telemetryTick % 4) } } } };
  }
  if (step.startsWith('cs2-')) return cs2Step(step, opts, configDir);
  if (step.startsWith('sensors-')) return sensorStep(step);
  if (step.startsWith('hwinfo-')) return hwinfoStep(step, opts);
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
  if (step === 'tweak-preview') {
    if (state.previewFails) return { logs: [], res: { ok: false, code: null, args: {}, message: 'preview failed' } };
    const ids = String(opts.tweakIds || '').split(',').filter(Boolean); const l = tweakPreview(ids, configDir);
    return { logs: [], res: { ok: true, code: 'msg.tweaks.previewed', args: { count: l.length }, message: l.length + ' previewed.', data: { tweaks: l, admin: true, build: 26300 } } };
  }
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

// Update flow (demo): kind = 'installed' (electron-updater path) | 'clone' (download + checksum ok) | 'clone-mismatch' | 'clone-nosums' | 'noinstaller'.
// Nothing is downloaded or started; the flags record what the UI asked for (the UI test reads them).
function resetUpdate(kind) { state.update = { kind: kind || 'clone', installerStarted: false, restarted: false, folderShown: false, downloads: 0 }; }
resetUpdate('clone');
function updateCheck() {
  const k = state.update.kind;
  const r = {
    ok: true, current: '1.0.0', latest: '1.1.0', newer: true, url: 'https://github.com/carloskafka/legion-14900hx-throttlestop/releases/tag/v1.1.0',
    releases: [{ version: '1.1.0', name: 'v1.1.0', date: '2026-10-20T00:00:00Z', notes: [{ type: 'h', text: "What's new" }, { type: 'li', text: 'A demo release note' }] }],
    canInstall: k === 'installed', mode: k === 'installed' ? 'auto' : k === 'noinstaller' ? 'manual' : 'download',
    explain: k === 'installed' ? [] : k === 'noinstaller' ? ['update.why.source', 'update.why.noInstaller', 'update.why.clone'] : ['update.why.source', 'update.why.clone'],
    installer: k === 'noinstaller' ? null : { name: 'KafkaBoost-Setup-1.1.0.exe', size: 98 * 1048576 }, checksum: k !== 'noinstaller' && k !== 'clone-nosums'
  };
  return r;
}
async function updateDownload(send, sleep, signal) {
  const k = state.update.kind; state.update.downloads++;
  for (let p = 0; p <= 100; p += 10) {
    if (signal && signal.aborted) return { ok: false, state: 'cancelled' };
    send({ stage: 'downloading', percent: p }); await sleep(200);
  }
  if (k === 'clone-mismatch') return { ok: false, state: 'mismatch', name: 'KafkaBoost-Setup-1.1.0.exe' };
  if (k === 'clone-nosums') return { ok: true, state: 'nochecksum', name: 'KafkaBoost-Setup-1.1.0.exe' };
  return { ok: true, state: 'verified', name: 'KafkaBoost-Setup-1.1.0.exe' };
}

const { appsService, demoAppsFile } = require('./demo-apps');

module.exports = { demoStep, state, updateCheck, updateDownload, resetUpdate, appsService, demoAppsFile, resetCs2, CS2_DEMO_EXE };
