'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../renderer/js/cs2logic');
const demo = require('../src/demo');
const { RULES, sanitize, DEFAULTS } = require('../src/settings');
const { loadDictionaries } = require('../src/i18n');

const root = path.join(__dirname, '..', '..');
const configDir = path.join(root, 'config');
const cfg = JSON.parse(fs.readFileSync(path.join(configDir, 'cs2.json'), 'utf8'));
const dicts = loadDictionaries(path.join(__dirname, '..', 'renderer', 'i18n'));
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

test('the launch string holds only catalog text, in catalog order, and ignores unknown ids', () => {
  assert.equal(L.buildLaunchOptions(cfg.launch, ['console', 'exec']), '+exec autoexec -console');
  assert.equal(L.buildLaunchOptions(cfg.launch, ['exec', 'rm -rf', '__proto__', 'constructor']), '+exec autoexec');
  assert.equal(L.buildLaunchOptions(cfg.launch, []), '');
  assert.equal(L.buildLaunchOptions(cfg.launch, null), '');
  assert.equal(L.buildLaunchOptions(null, ['exec']), '');
});

test('only the harmless option is ticked by default; disputed and placebo options never are', () => {
  assert.deepEqual(L.defaultLaunchSelection(cfg.launch), ['exec']);
  for (const o of cfg.launch.filter((x) => x.tier !== 'suggested')) assert.equal(!!o.default, false, o.id);
});

test('the catalog is small, valid and honest: known tiers, plain option text, unique ids', () => {
  const ids = (a) => a.map((o) => o.id);
  assert.equal(new Set(ids(cfg.launch)).size, cfg.launch.length);
  assert.equal(new Set(ids(cfg.autoexec)).size, cfg.autoexec.length);
  for (const o of cfg.launch) {
    assert.ok(['suggested', 'disputed', 'placebo'].includes(o.tier), o.id);
    assert.match(o.text, /^[+-][a-z]+( [a-z]+)?$/, `launch option ${o.id} looks odd`);
  }
  for (const o of cfg.autoexec) { assert.match(o.line, /^[a-z_]+( [0-9]+|\s\{value\})$/, o.id); assert.ok(!/[\r\n;]/.test(o.line)); }
  assert.ok(cfg.autoexec.length <= 3 && cfg.launch.length <= 8, 'the preset stays short');
});

test('every catalog id has an explanation in both languages, and nothing promises FPS or anti-cheat safety', () => {
  const need = [];
  for (const o of cfg.autoexec) need.push(`cs2.cfg.opt.${o.id}`);
  for (const o of cfg.launch) need.push(`cs2.launch.opt.${o.id}`);
  for (const lang of ['en', 'pt-BR']) for (const k of need) assert.ok(dicts[lang][k] && dicts[lang][k].length > 20, `${lang} ${k}`);
  for (const lang of ['en', 'pt-BR']) for (const o of cfg.launch) assert.ok(dicts[lang][`cs2.launch.tier.${o.tier}`], `${lang} tier ${o.tier}`);
  const banned = /(\d+\s?%\s?(more )?fps|more fps|higher fps|fps boost|boosts? (your )?fps|increase(s)? (your )?fps|ganhe fps|mais fps|aumenta o fps|100 ?% safe|vac[- ]safe|vac[- ]proof|undetect|garantid)/i;
  for (const lang of ['en', 'pt-BR']) for (const [k, v] of Object.entries(dicts[lang])) {
    if (k === 'cs2.honest.1') continue;        // the one sentence that says, in so many words, that nothing here promises more FPS
    if (/^(cs2|opt\.cs2|msg\.cs2)\./.test(k)) assert.ok(!banned.test(v), `${lang} ${k}: ${v}`);
  }
  assert.match(dicts.en['cs2.honest.3'], /did not test/i);
  assert.match(dicts['pt-BR']['cs2.honest.3'], /não testamos/i);
  assert.match(dicts.en['cs2.honest.1'], /Nothing here promises more FPS/);
});

test('the number option takes a whole number inside the catalog bounds only', () => {
  const o = cfg.autoexec.find((x) => x.param);
  for (const v of ['30', '144', '1000', ' 240 ']) assert.equal(L.validParam(o, v), true, v);
  for (const v of ['', '29', '1001', 'abc', '1e3', '-5', '100; quit', '12.5', null, undefined]) assert.equal(L.validParam(o, v), false, String(v));
  assert.equal(L.validParam(cfg.autoexec.find((x) => !x.param), ''), true, 'an option without a number needs none');
});

test('GPU part: which status and which buttons for each state', () => {
  const m = (g, busy) => L.gpuModel(g, busy);
  assert.deepEqual(m({ pref: null, high: false, recorded: false }), { status: 'cs2.gpu.status.notSet', canApply: true, canRevert: false });
  assert.deepEqual(m({ pref: 2, high: true, recorded: true }), { status: 'cs2.gpu.status.ours', canApply: false, canRevert: true });
  assert.deepEqual(m({ pref: 2, high: true, recorded: false }), { status: 'cs2.gpu.status.theirs', canApply: false, canRevert: false });
  assert.equal(m({ pref: 1, high: false, recorded: false }).status, 'cs2.gpu.status.saving');
  assert.equal(m({ pref: 0, high: false, recorded: false }).status, 'cs2.gpu.status.windows');
  assert.deepEqual(m({ pref: 2, high: true, recorded: true }, true), { status: 'cs2.gpu.status.ours', canApply: false, canRevert: false }, 'busy disables both');
  assert.equal(m(null).canApply, false);
});

test('autoexec part: write needs a valid choice, restore only for our file or a missing one with an original backup', () => {
  const opts = cfg.autoexec;
  const a = (o, ids, fps, busy) => L.autoexecModel(o, { ids, fps }, opts, busy);
  const none = { available: true, exists: false, ours: false, foreign: false, hasOriginal: false };
  assert.equal(a(none, [], '').canWrite, false, 'nothing chosen');
  assert.equal(a(none, ['showfps'], '').canWrite, true);
  assert.equal(a(none, ['showfps', 'fpsmax'], '').canWrite, false, 'fps_max needs its number');
  assert.equal(a(none, ['fpsmax'], '144').canWrite, true);
  assert.equal(a(none, ['bogus'], '').canWrite, false, 'unknown ids do not count');
  assert.equal(a(none, ['showfps'], '', true).canWrite, false, 'busy');
  assert.equal(a(none, ['showfps']).status, 'cs2.cfg.status.none');
  assert.equal(a(none, ['showfps']).canRestore, false);
  const foreign = { ...none, exists: true, foreign: true };
  assert.equal(a(foreign, ['showfps']).willBackup, true);
  assert.equal(a(foreign, ['showfps']).status, 'cs2.cfg.status.foreign');
  assert.equal(a(foreign, ['showfps']).canRestore, false, 'a file that is not ours is never restored over');
  const ours = { ...none, exists: true, ours: true, hasOriginal: true };
  assert.equal(a(ours, ['showfps']).canRestore, true);
  assert.equal(a({ ...none, hasOriginal: true }, []).canRestore, true, 'the file is gone but the original backup exists');
  assert.equal(a({ available: false }, ['showfps']).canWrite, false);
  assert.equal(a({ available: false }, ['showfps']).status, 'cs2.cfg.status.unavailable');
  assert.equal(a(null, ['showfps']).canWrite, false);
});

test('location part', () => {
  assert.deepEqual(L.locationModel({ found: false }), { status: 'cs2.loc.notFound', source: null });
  assert.equal(L.locationModel({ found: true, source: 'steam' }).source, 'cs2.loc.fromSteam');
  assert.equal(L.locationModel({ found: true, source: 'user' }).source, 'cs2.loc.userPicked');
  assert.equal(L.locationModel(null).status, 'cs2.loc.notFound');
});

test('demo walk-through: apply and revert the GPU preference, write with a backup, restore, refuse bad options', () => {
  demo.resetCs2();
  const step = (s, o) => demo.demoStep(s, o || {}, configDir).res;
  let st = step('cs2-state');
  assert.equal(st.code, 'msg.cs2.found'); assert.equal(st.data.source, 'steam'); assert.equal(st.data.gpu.high, false);
  assert.equal(st.data.autoexec.foreign, true, 'the demo user already has an autoexec.cfg');
  assert.deepEqual(st.data.catalog.launch.map((o) => o.id), cfg.launch.map((o) => o.id));
  assert.equal(step('cs2-gpu', { cs2Mode: 'on' }).code, 'msg.cs2.gpuApplied');
  assert.equal(step('cs2-gpu', { cs2Mode: 'on' }).code, 'msg.cs2.gpuAlready');
  assert.equal(step('cs2-state').data.gpu.recorded, true);
  assert.equal(step('cs2-gpu', { cs2Mode: 'off' }).code, 'msg.cs2.gpuReverted');
  assert.equal(step('cs2-gpu', { cs2Mode: 'off' }).ok, false, 'nothing of ours to revert');
  assert.equal(step('cs2-autoexec', { cs2Mode: 'off' }).code, 'msg.cs2.autoexecNotOurs', 'the user file is never restored over');
  assert.equal(step('cs2-autoexec', { cs2Mode: 'on', cs2Options: 'bogus' }).code, 'msg.cs2.badOptions');
  assert.equal(step('cs2-autoexec', { cs2Mode: 'on', cs2Options: 'fpsmax', cs2FpsMax: '5' }).code, 'msg.cs2.badOptions');
  const w = step('cs2-autoexec', { cs2Mode: 'on', cs2Options: 'showfps,fpsmax', cs2FpsMax: '144' });
  assert.equal(w.code, 'msg.cs2.autoexecWrittenBackup'); assert.match(w.args.backup, /^autoexec\.cfg\.bak_\d{8}_\d{6}$/);
  assert.equal(w.data.ours, true);
  const r = step('cs2-autoexec', { cs2Mode: 'off' });
  assert.equal(r.code, 'msg.cs2.autoexecRestored'); assert.equal(r.data.foreign, true, 'the original is back');
  demo.resetCs2(); demo.state.cs2.exists = false;
  assert.equal(step('cs2-autoexec', { cs2Mode: 'on', cs2Options: 'showfps' }).code, 'msg.cs2.autoexecWritten');
  assert.equal(step('cs2-autoexec', { cs2Mode: 'off' }).code, 'msg.cs2.autoexecRemoved');
  demo.state.cs2.found = false;
  assert.equal(step('cs2-state').data.found, false);
  assert.equal(step('cs2-state', { cs2Exe: demo.CS2_DEMO_EXE }).data.source, 'user');
  demo.resetCs2();
});

test('every message code the steps and the demo can return is translated', () => {
  const ps = read('scripts', 'lib', 'Cs2.ps1');
  const codes = new Set([...ps.matchAll(/'(msg\.cs2\.[A-Za-z]+)'/g)].map((m) => m[1]));
  codes.add('msg.cs2.found'); codes.add('msg.cs2.notFound');
  assert.ok(codes.size >= 15, `found only ${codes.size} codes`);
  for (const lang of ['en', 'pt-BR']) for (const c of codes) assert.ok(dicts[lang][c], `${lang} ${c}`);
  const d = read('app', 'src', 'demo.js');
  for (const m of d.matchAll(/'(msg\.cs2\.[A-Za-z]+)'/g)) assert.ok(dicts.en[m[1]], m[1]);
});

test('Steps.ps1 declares the cs2 steps, they need no administrator rights, and the app validates every argument', () => {
  const ps = read('scripts', 'Steps.ps1');
  for (const s of ['cs2-state', 'cs2-gpu', 'cs2-autoexec']) {
    assert.ok(ps.includes(`'${s}'`), s);
    assert.ok(new RegExp(`\\$readOnly = [^\\n]*'${s}'`).test(ps), `${s} is in the no-admin list`);
  }
  assert.ok(ps.includes("lib\\Cs2.ps1"));
  const main = read('app', 'src', 'main.js');
  assert.ok(main.includes("SETTING_RULES.cs2Exe(opts.cs2Exe)"), 'cs2Exe is validated before it becomes an argument');
  assert.ok(main.includes("/^[a-z0-9,]{1,200}$/.test(opts.cs2Options)"));
  assert.ok(main.includes("/^[0-9]{1,4}$/.test(String(opts.cs2FpsMax))"));
  assert.ok(main.includes("opts.cs2Mode === 'on' || opts.cs2Mode === 'off'"));
  assert.ok(main.includes("ipcMain.handle('dialog:cs2exe'") && main.includes("toLowerCase() !== 'cs2.exe'"));
  assert.ok(read('app', 'src', 'preload.js').includes("pickExe: () => ipcRenderer.invoke('dialog:cs2exe')"));
});

test('the picked cs2.exe is a setting that only accepts a drive path ending in cs2.exe', () => {
  assert.equal(DEFAULTS.cs2Exe, '');
  const ok = ['', 'D:\\SteamLibrary\\steamapps\\common\\Counter-Strike Global Offensive\\game\\bin\\win64\\cs2.exe', 'C:/Games/cs2.exe', 'D:\\cs2.exe'];
  const bad = ['x', 'cs2.exe', 'D:\\a\\evil.exe', 'D:\\a\\..\\cs2.exe', 'D:\\a\\.\\cs2.exe', '\\\\server\\share\\cs2.exe', 'D:\\a[1]\\cs2.exe', 'D:\\a*\\cs2.exe', 'D:\\a\\xcs2.exe', 5, null, 'D:\\' + 'a'.repeat(300) + '\\cs2.exe'];
  for (const v of ok) assert.equal(RULES.cs2Exe(v), true, String(v));
  for (const v of bad) assert.equal(RULES.cs2Exe(v), false, String(v));
  assert.equal(sanitize({ cs2Exe: 'D:\\a\\evil.exe' }).cs2Exe, '');
});

test('the page: every id the script uses exists, the view is Windows-only and under Optimizations, nothing inline', () => {
  const html = read('app', 'renderer', 'index.html');
  const js = read('app', 'renderer', 'js', 'cs2.js');
  for (const m of js.matchAll(/\$\('([A-Za-z0-9]+)'\)/g)) assert.ok(html.includes(`id="${m[1]}"`), `missing #${m[1]} in index.html`);
  assert.ok(html.includes('js/cs2logic.js') && html.includes('js/cs2.js'));
  assert.ok(html.indexOf('js/cs2logic.js') < html.indexOf('js/cs2.js'), 'the logic loads first');
  const core = read('app', 'renderer', 'js', 'core.js');
  assert.match(core, /NAV_OF = \{[^}]*cs2: 'optimizations'/);
  assert.match(core, /WINDOWS_ONLY = \[[^\]]*'cs2'/);
  assert.match(core, /ALL_VIEWS = \[[^\]]*'cs2'/);
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(js), 'text is set with textContent only');
  assert.ok(!/\.style\.|setAttribute\('style'/.test(js), 'the CSP forbids inline styles: classes only');
  assert.match(html, /style-src 'self'; script-src 'self'/);
  assert.ok(/navigator\.clipboard\.writeText/.test(js) && /execCommand\('copy'\)/.test(js), 'clipboard API with a textarea fallback');
  for (const line of js.split('\n')) if (/navigator\.clipboard\.writeText/.test(line)) assert.ok(/try \{/.test(line), 'the clipboard call is guarded by try/catch');
});

test('Steam\'s own configuration is never written by any CS2 code', () => {
  for (const f of [['scripts', 'lib', 'Cs2.ps1'], ['app', 'renderer', 'js', 'cs2.js'], ['app', 'renderer', 'js', 'cs2logic.js']]) {
    const code = read(...f).split('\n').filter((l) => !/^\s*(#|\/\/)/.test(l)).join('\n');
    assert.ok(!/localconfig/i.test(code), `${f.join('/')} must not mention localconfig outside comments`);
  }
  const ps = read('scripts', 'lib', 'Cs2.ps1');
  // the only files it writes are the fixed autoexec names inside the cfg folder
  const writes = [...ps.matchAll(/(WriteAllText|Set-Content|Out-File|Add-Content|Copy-Item|Move-Item|Remove-Item)[^\n]*/g)].map((m) => m[0]);
  for (const w of writes) assert.ok(/\$c\.target|\$tmp|\$bak|\$orig\.FullName/.test(w), `unexpected write: ${w}`);
});
