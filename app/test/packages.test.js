'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createService, loadCatalog } = require('../src/packages');
const { validId, validQuery, ID_PATTERNS } = require('../src/packages/ids');
const { validateCatalog, resolve, LINUX_MANAGERS } = require('../src/packages/catalog');
const { defaultRunner } = require('../src/packages/runner');
const { loadDictionaries } = require('../src/i18n');
const winget = require('../src/packages/winget');
const makeWinget = winget;
const makeBrew = require('../src/packages/brew');
const linux = require('../src/packages/linux');
const bloat = require('../src/packages/bloat');

const catalog = loadCatalog(path.join(__dirname, '..', '..', 'config', 'apps.json'));

// A fake runner: records every call and answers from a table of (command line -> result), default "command not found".
function fake(answers = {}) {
  const calls = [];
  const run = async (cmd, args) => {
    calls.push([cmd, ...args]);
    const line = [cmd, ...args].join(' ');
    for (const [k, v] of Object.entries(answers)) if (line.startsWith(k)) return typeof v === 'function' ? v(args) : v;
    return { code: -1, stdout: '', stderr: '', error: 'ENOENT' };
  };
  run.calls = calls; run.lines = () => calls.map((c) => c.join(' '));
  return run;
}
const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });

// ---- ids ---------------------------------------------------------------------------------------------------------
test('package ids: real ids pass, shell metacharacters and option look-alikes are rejected', () => {
  const good = { winget: ['Microsoft.VisualStudioCode', '7zip.7zip', 'Notepad++.Notepad++'], brew: ['visual-studio-code', 'sevenzip', 'gcc@13'],
    flatpak: ['org.videolan.VLC', 'com.valvesoftware.Steam'], apt: ['vlc', 'obs-studio', 'libstdc++6'], dnf: ['qbittorrent', 'gcc-c++'], pacman: ['telegram-desktop', 'lib32-mesa'] };
  for (const [m, ids] of Object.entries(good)) for (const id of ids) assert.ok(validId(m, id), `${m} ${id}`);
  const evil = ['', '-rf', '--force', 'a b', 'a;b', 'a&b', 'a|b', '$(calc)', '`calc`', 'a\nb', 'a"b', "a'b", 'a>b', '../x', 'a/b', 'a\\b', 'x'.repeat(200), 'ünï', null, undefined, 5];
  for (const m of Object.keys(ID_PATTERNS)) for (const id of evil) assert.ok(!validId(m, id), `${m} must reject ${JSON.stringify(id)}`);
  assert.ok(!validId('flatpak', 'vlc'), 'flatpak ids need the reverse-DNS form');
});

test('search queries: letters, digits and a few separators only, never a leading dash', () => {
  for (const q of ['vlc', 'visual studio', 'c++', 'node.js', 'café']) assert.ok(validQuery(q), q);
  for (const q of ['', '-x', '--help', 'a;b', 'a|b', '$(x)', 'a`b', 'a\nb', 'a'.repeat(65), 'a/b', 5, null]) assert.ok(!validQuery(q), JSON.stringify(q));
});

// ---- catalog -----------------------------------------------------------------------------------------------------
test('catalog: valid, unique ids, every shown OS id passes its manager pattern', () => {
  assert.deepEqual(validateCatalog(catalog), []);
  assert.ok(catalog.apps.length >= 18);
  assert.equal(new Set(catalog.apps.map((a) => a.id)).size, catalog.apps.length);
  for (const a of catalog.apps) {
    if (a.ids.win32) assert.ok(validId('winget', a.ids.win32), a.id);
    for (const [k, v] of Object.entries(a.ids.darwin || {})) assert.ok(['cask', 'formula'].includes(k) && validId('brew', v), `${a.id} ${k}`);
    for (const [m, v] of Object.entries(a.ids.linux || {})) assert.ok(LINUX_MANAGERS.includes(m) && validId(m, v), `${a.id} ${m}`);
  }
});

test('catalog: validation catches duplicates, bad ids and unknown categories', () => {
  const bad = { categories: ['x'], apps: [
    { id: 'a', name: 'A', desc: 'd', category: 'x', ids: { win32: 'Ok.Id' } },
    { id: 'a', name: 'A', desc: 'd', category: 'nope', ids: { win32: 'bad id; calc' } },
    { id: 'b', name: 'B', desc: 'd', category: 'x', ids: {} }
  ], bloatware: [{ id: 'z', appx: "x'; calc" }] };
  const errors = validateCatalog(bad).join('\n');
  assert.match(errors, /duplicate app id a/); assert.match(errors, /bad winget id/); assert.match(errors, /unknown category/);
  assert.match(errors, /b: no id for any OS/); assert.match(errors, /bad appx name/);
});

test('catalog: every app, category and bloatware entry has text in both languages', () => {
  const d = loadDictionaries(path.join(__dirname, '..', 'renderer', 'i18n'));
  for (const lang of ['en', 'pt-BR']) {
    for (const c of ['all', ...catalog.categories]) assert.ok(d[lang][`apps.cat.${c}`], `${lang} apps.cat.${c}`);
    for (const a of catalog.apps) assert.ok(d[lang][`apps.app.${a.id}.desc`], `${lang} apps.app.${a.id}.desc`);
    for (const b of catalog.bloatware) for (const part of ['name', 'desc']) assert.ok(d[lang][`apps.bloat.${b.id}.${part}`], `${lang} apps.bloat.${b.id}.${part}`);
  }
});

test('catalog: resolve gives the id of the active manager, or null when the app is absent there', () => {
  const vlc = catalog.apps.find((a) => a.id === 'vlc'), steam = catalog.apps.find((a) => a.id === 'steam'), npp = catalog.apps.find((a) => a.id === 'notepadpp'), zip = catalog.apps.find((a) => a.id === '7zip');
  assert.deepEqual(resolve(vlc, 'win32', 'winget'), { id: 'VideoLAN.VLC' });
  assert.deepEqual(resolve(vlc, 'darwin', 'brew'), { id: 'vlc', kind: 'cask' });
  assert.deepEqual(resolve(zip, 'darwin', 'brew'), { id: 'sevenzip', kind: 'formula' });
  assert.deepEqual(resolve(vlc, 'linux', 'flatpak'), { id: 'org.videolan.VLC' });
  assert.deepEqual(resolve(vlc, 'linux', 'apt'), { id: 'vlc' });
  assert.equal(resolve(vlc, 'linux', 'dnf'), null, 'not offered where the id was not verified');
  assert.equal(resolve(steam, 'linux', 'apt'), null);
  assert.equal(resolve(npp, 'linux', 'flatpak'), null);
  assert.equal(resolve(npp, 'darwin', 'brew'), null);
  assert.equal(resolve(vlc, 'win32', 'brew'), null);
});

// ---- winget ------------------------------------------------------------------------------------------------------
const PT_TABLE = [
  '   - ', 'Nome                          ID                              Versão      Origem',
  '-----------------------------------------------------------------------------------------',
  'VLC media player              VideoLAN.VLC                    3.0.24      winget',
  'Discord                       ARP\\User\\X64\\Discord           1.0.9234',
  'Calculadora Windows           MSIX\\Microsoft.WindowsCalculator_11.0_x64__8wekyb3d8bbwe 11.0',
  'Steam                         Valve.Steam                     2.10.91.91  winget', ''
].join('\r\n');

test('winget: parses a localized table and keeps only installable Publisher.Package ids', async () => {
  const run = fake({ winget: ok(PT_TABLE) });
  const list = await makeWinget(run).list();
  assert.deepEqual(list.map((x) => x.id), ['VideoLAN.VLC', 'Valve.Steam']);
  assert.equal(list[0].name, 'VLC media player'); assert.equal(list[0].version, '3.0.24');
  assert.deepEqual(run.calls[0], ['winget', 'list', '--accept-source-agreements', '--disable-interactivity']);
  assert.deepEqual(winget.parseTable('no table here'), []);
});

test('winget: install and uninstall build an args array with the exact id', async () => {
  const run = fake({ winget: ok() });
  const p = makeWinget(run);
  const r = await p.install('VideoLAN.VLC');
  assert.ok(r.ok); assert.equal(r.code, 'msg.apps.installed');
  assert.deepEqual(run.calls[0], ['winget', 'install', '--id', 'VideoLAN.VLC', '--exact', '--source', 'winget', '--silent', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity']);
  const u = await p.uninstall('VideoLAN.VLC');
  assert.ok(u.ok); assert.equal(u.code, 'msg.apps.removed');
  assert.deepEqual(run.calls[1], ['winget', 'uninstall', '--id', 'VideoLAN.VLC', '--exact', '--silent', '--accept-source-agreements', '--disable-interactivity']);
});

test('winget: "already installed" is a success, a real failure carries the exit code, a missing winget says so', async () => {
  assert.equal((await makeWinget(fake({ winget: { code: 0x8A150061, stdout: '', stderr: '' } })).install('A.B')).code, 'msg.apps.already');
  assert.equal((await makeWinget(fake({ winget: { code: -1978335135, stdout: '', stderr: '' } })).install('A.B')).code, 'msg.apps.already');
  const bad = await makeWinget(fake({ winget: { code: 5, stdout: '', stderr: 'Installer failed\nsecond line' } })).install('A.B');
  assert.equal(bad.ok, false); assert.equal(bad.args.exit, 5); assert.match(bad.detail, /second line/);
  assert.equal((await makeWinget(fake()).install('A.B')).code, 'msg.apps.noManager');
});

test('a bad id or query never reaches the command runner', async () => {
  for (const make of [makeWinget, makeBrew, linux.flatpak, linux.apt, linux.dnf, linux.pacman]) {
    const run = fake({ '': ok() });
    const p = make(run);
    for (const evil of ['x; calc', '--force', '$(id)', 'a b', '']) {
      assert.equal((await p.install(evil, { kind: 'cask' })).code, 'msg.apps.invalidId', `${p.name} install ${evil}`);
      assert.equal((await p.uninstall(evil, { kind: 'cask' })).code, 'msg.apps.invalidId');
    }
    assert.deepEqual(await p.search('a; calc'), []);
    assert.equal(run.calls.length, 0, `${p.name} ran something`);
  }
});

// ---- brew --------------------------------------------------------------------------------------------------------
test('brew: finds brew in the usual locations, installs casks and formulae with the right flag', async () => {
  const run = fake({ '/opt/homebrew/bin/brew --version': ok('Homebrew 4.5'), '/opt/homebrew/bin/brew': ok() });
  const p = makeBrew(run);
  assert.equal(await p.available(), true);
  assert.deepEqual(run.calls[0], ['/opt/homebrew/bin/brew', '--version']);
  await p.install('vlc', { kind: 'cask' }); await p.install('git', { kind: 'formula' }); await p.uninstall('vlc', { kind: 'cask' });
  assert.deepEqual(run.calls.slice(1), [['/opt/homebrew/bin/brew', 'install', '--cask', 'vlc'], ['/opt/homebrew/bin/brew', 'install', '--formula', 'git'], ['/opt/homebrew/bin/brew', 'uninstall', '--cask', 'vlc']]);
  assert.equal((await p.install('vlc')).code, 'msg.apps.invalidId', 'brew needs a kind');
  assert.equal((await p.install('vlc', { kind: 'tap' })).code, 'msg.apps.invalidId');
  const none = makeBrew(fake());
  assert.equal(await none.available(), false);
});

test('brew: list reads casks and leaf formulae, search both kinds', async () => {
  const run = fake({
    '/opt/homebrew/bin/brew --version': ok('x'),
    '/opt/homebrew/bin/brew list --cask --versions': ok('vlc 3.0.21\ngoogle-chrome 130.0\n'),
    '/opt/homebrew/bin/brew leaves': ok('git\nwget\n'),
    '/opt/homebrew/bin/brew search --cask': ok('==> Casks\nvlc\nvlc-nightly\n'),
    '/opt/homebrew/bin/brew search --formula': ok('vlc-plugin\n')
  });
  const p = makeBrew(run);
  assert.deepEqual((await p.list()).map((x) => `${x.kind}:${x.id}`), ['cask:vlc', 'cask:google-chrome', 'formula:git', 'formula:wget']);
  const found = await p.search('vlc');
  assert.deepEqual(found.map((x) => `${x.kind}:${x.id}`), ['cask:vlc', 'cask:vlc-nightly', 'formula:vlc-plugin']);
});

// ---- linux: flatpak ----------------------------------------------------------------------------------------------
test('flatpak: per-user install after adding Flathub, tab-separated list and search', async () => {
  const run = fake({
    flatpak: (args) => (args[0] === 'list' ? ok('org.videolan.VLC\tVLC\t3.0.21\ncom.valvesoftware.Steam\tSteam\t1.0\n')
      : args[0] === 'search' ? ok('org.gimp.GIMP\tGIMP\tImage editor\nnot an id\tx\ty\n') : ok())
  });
  const p = linux.flatpak(run);
  assert.deepEqual((await p.list()).map((x) => x.id), ['org.videolan.VLC', 'com.valvesoftware.Steam']);
  assert.deepEqual(run.calls[0], ['flatpak', 'list', '--app', '--columns=application,name,version']);
  assert.deepEqual((await p.search('gimp')).map((x) => x.id), ['org.gimp.GIMP']);
  run.calls.length = 0;
  assert.ok((await p.install('org.gimp.GIMP')).ok);
  assert.deepEqual(run.calls, [['flatpak', 'remote-add', '--user', '--if-not-exists', 'flathub', 'https://dl.flathub.org/repo/flathub.flatpakrepo'], ['flatpak', 'install', '--user', '-y', '--noninteractive', 'flathub', 'org.gimp.GIMP']]);
  run.calls.length = 0;
  assert.ok((await p.uninstall('org.gimp.GIMP')).ok);
  assert.deepEqual(run.calls, [['flatpak', 'uninstall', '-y', '--noninteractive', 'org.gimp.GIMP']]);
});

// ---- linux: apt / dnf / pacman ------------------------------------------------------------------------------------
test('apt: privileged through pkexec, plain when already root, parses manual list and search', async () => {
  const run = fake({
    pkexec: ok(), 'apt-mark': ok('vlc\nobs-studio\nbad;name\n'),
    'apt-cache': ok('vlc - multimedia player\nvlc-data - common data\n')
  });
  const p = linux.apt(run);
  assert.deepEqual((await p.list()).map((x) => x.id), ['vlc', 'obs-studio']);
  assert.deepEqual((await p.search('vlc')).map((x) => x.id), ['vlc', 'vlc-data']);
  assert.deepEqual(run.calls[1], ['apt-cache', 'search', '--names-only', 'vlc']);
  run.calls.length = 0;
  await p.install('vlc'); await p.uninstall('vlc');
  assert.deepEqual(run.calls, [['pkexec', 'env', 'DEBIAN_FRONTEND=noninteractive', 'apt-get', 'install', '-y', '--', 'vlc'], ['pkexec', 'env', 'DEBIAN_FRONTEND=noninteractive', 'apt-get', 'remove', '-y', '--', 'vlc']]);
  const root = fake({ env: ok() });
  await linux.apt(root, { isRoot: true }).install('vlc');
  assert.deepEqual(root.calls[0], ['env', 'DEBIAN_FRONTEND=noninteractive', 'apt-get', 'install', '-y', '--', 'vlc']);
});

test('pkexec: a dismissed or refused password dialog is reported as such', async () => {
  for (const code of [126, 127]) {
    const r = await linux.dnf(fake({ pkexec: { code, stdout: '', stderr: '' } })).install('gimp');
    assert.equal(r.ok, false); assert.equal(r.code, 'msg.apps.authFailed');
  }
  assert.equal((await linux.dnf(fake({ pkexec: { code: 1, stdout: '', stderr: 'No match' } })).install('gimp')).code, 'msg.apps.failed');
});

test('dnf: user-installed list, search parsing, privileged install and remove', async () => {
  const run = fake({
    pkexec: ok(), dnf: (args) => (args[0] === 'repoquery' ? ok('gimp\ngit\n') : ok('Matched fields: name\nqbittorrent.x86_64 : BitTorrent client\ngimp-help.noarch : Help\nweird line\n'))
  });
  const p = linux.dnf(run);
  assert.deepEqual((await p.list()).map((x) => x.id), ['gimp', 'git']);
  assert.deepEqual(run.calls[0], ['dnf', 'repoquery', '--userinstalled', '--queryformat', '%{name}\\n']);
  assert.deepEqual((await p.search('bit')).map((x) => x.id), ['qbittorrent', 'gimp-help']);
  run.calls.length = 0;
  await p.install('gimp'); await p.uninstall('gimp');
  assert.deepEqual(run.calls, [['pkexec', 'dnf', 'install', '-y', 'gimp'], ['pkexec', 'dnf', 'remove', '-y', 'gimp']]);
});

test('pacman: explicit list, -Ss search parsing, privileged install and remove', async () => {
  const run = fake({ pkexec: ok(), pacman: (args) => (args[0] === '-Qqe' ? ok('firefox\nvlc\n') : ok('extra/vlc 3.0.21-1\n    A multi-platform media player\nextra/vlc-plugins-all 3.0.21-1\n    Plugins\n')) });
  const p = linux.pacman(run);
  assert.deepEqual((await p.list()).map((x) => x.id), ['firefox', 'vlc']);
  const s = await p.search('vlc');
  assert.deepEqual(s.map((x) => x.id), ['vlc', 'vlc-plugins-all']); assert.equal(s[0].summary, 'A multi-platform media player');
  run.calls.length = 0;
  await p.install('vlc'); await p.uninstall('vlc');
  assert.deepEqual(run.calls, [['pkexec', 'pacman', '-S', '--noconfirm', '--needed', '--', 'vlc'], ['pkexec', 'pacman', '-R', '--noconfirm', '--', 'vlc']]);
});

// ---- service: provider choice, catalog, export / import ------------------------------------------------------------
test('provider is chosen by platform and by what is installed', async () => {
  const win = createService({ catalog, platform: 'win32', runner: fake({ 'winget --version': ok('v1') }) });
  assert.equal((await win.info()).manager, 'winget'); assert.equal((await win.info()).bloat, true);
  const mac = createService({ catalog, platform: 'darwin', runner: fake({ '/usr/local/bin/brew --version': ok('b') }) });
  assert.equal((await mac.info()).manager, 'brew'); assert.equal((await mac.info()).bloat, false);
  const both = createService({ catalog, platform: 'linux', runner: fake({ 'flatpak --version': ok('f'), 'apt-get --version': ok('a') }) });
  assert.equal((await both.info()).manager, 'flatpak', 'flatpak first');
  const apt = createService({ catalog, platform: 'linux', runner: fake({ 'apt-get --version': ok('a') }) });
  assert.equal((await apt.info()).manager, 'apt');
  const arch = createService({ catalog, platform: 'linux', runner: fake({ 'pacman --version': ok('p') }) });
  assert.equal((await arch.info()).manager, 'pacman');
  const none = createService({ catalog, platform: 'linux', runner: fake() });
  assert.deepEqual(await none.info(), { platform: 'linux', manager: null, label: null, bloat: false });
  assert.deepEqual((await none.apps()).apps, []);
  assert.equal((await none.install({ appId: 'vlc' })).code, 'msg.apps.noManager');
});

test('apps(): only apps with an id for the manager, flagged installed from the real list', async () => {
  const svc = createService({ catalog, platform: 'win32', runner: fake({ 'winget --version': ok('v'), 'winget list': ok(PT_TABLE) }) });
  const { apps } = await svc.apps();
  assert.equal(apps.find((a) => a.appId === 'vlc').installed, true);
  assert.equal(apps.find((a) => a.appId === 'steam').installed, true);
  assert.equal(apps.find((a) => a.appId === 'chrome').installed, false);
  assert.ok(apps.some((a) => a.appId === 'notepadpp'));
  const lin = createService({ catalog, platform: 'linux', runner: fake({ 'apt-get --version': ok('a'), 'apt-mark': ok('vlc\n') }) });
  const l = (await lin.apps()).apps;
  assert.ok(!l.some((a) => a.appId === 'notepadpp') && !l.some((a) => a.appId === 'steam'), 'absent apps are not offered');
  assert.equal(l.find((a) => a.appId === 'vlc').installed, true);
});

test('install by catalog id resolves the package id; unknown catalog ids and bad refs are refused', async () => {
  const run = fake({ 'winget --version': ok('v'), winget: ok() });
  const svc = createService({ catalog, platform: 'win32', runner: run });
  assert.ok((await svc.install({ appId: 'vlc' })).ok);
  assert.ok(run.lines().some((l) => l.startsWith('winget install --id VideoLAN.VLC ')));
  const n = run.calls.length;
  for (const ref of [{ appId: 'nope' }, { id: 'x; calc' }, { id: '--force' }, {}, null, undefined, { appId: 'chrome ' }]) assert.equal((await svc.install(ref)).code, 'msg.apps.invalidId', JSON.stringify(ref));
  assert.equal(run.calls.length, n, 'nothing ran for the refused refs');
  assert.ok((await svc.install({ id: 'Obsidian.Obsidian' })).ok, 'a search-result id that passes the pattern is allowed');
});

test('export lists installed packages and tags the ones that are in the catalog', async () => {
  const svc = createService({ catalog, platform: 'win32', runner: fake({ 'winget --version': ok('v'), 'winget list': ok(PT_TABLE) }) });
  const data = await svc.exportData();
  assert.equal(data.app, 'KafkaBoost'); assert.equal(data.format, 1); assert.equal(data.manager, 'winget'); assert.equal(data.platform, 'win32');
  assert.deepEqual(data.packages, [{ id: 'VideoLAN.VLC', catalogId: 'vlc' }, { id: 'Valve.Steam', catalogId: 'steam' }]);
});

test('import plan: catalog ids map across systems, invalid ids are dropped, installed ones skipped', async () => {
  const run = fake({ 'apt-get --version': ok('a'), 'apt-mark': ok('vlc\n'), pkexec: ok() });
  const svc = createService({ catalog, platform: 'linux', runner: run });
  const file = JSON.stringify({ app: 'KafkaBoost', format: 1, packages: [
    { id: 'VideoLAN.VLC', catalogId: 'vlc' },                        // from Windows, already installed here
    { id: 'OBSProject.OBSStudio', catalogId: 'obs' },                // mapped to obs-studio
    { id: 'Valve.Steam', catalogId: 'steam' },                       // no apt id for it: id does not pass the apt pattern either
    { id: 'qbittorrent' },                                           // plain id that passes the apt pattern
    { id: 'bad; rm -rf /' }, { id: '--force' }, { id: 'x', kind: 'cask' }, { id: 42 }, null,
    { id: 'qbittorrent' }
  ] });
  const plan = await svc.planImport(file);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.items.map((i) => i.id), ['obs-studio', 'qbittorrent']);
  assert.equal(plan.already, 1); assert.equal(plan.skipped, 6);
  run.calls.length = 0;
  const res = await svc.runImport(plan.items);
  assert.equal(res.ok, true); assert.equal(res.args.ok, 2);
  assert.deepEqual(run.lines(), ['pkexec env DEBIAN_FRONTEND=noninteractive apt-get install -y -- obs-studio', 'pkexec env DEBIAN_FRONTEND=noninteractive apt-get install -y -- qbittorrent']);
});

test('runImport re-validates: a forged item list cannot run anything unsafe', async () => {
  const run = fake({ 'winget --version': ok('v'), winget: ok() });
  const svc = createService({ catalog, platform: 'win32', runner: run });
  const res = await svc.runImport([{ id: 'Good.Id' }, { id: 'x; calc' }, { id: '--force' }, { id: 'A.B', kind: 'cask' }, null]);
  assert.equal(res.results.length, 1);
  assert.equal(run.lines().filter((l) => l.startsWith('winget install')).length, 1);
});

test('import plan rejects files that are not KafkaBoost lists, too big, or not JSON', async () => {
  const svc = createService({ catalog, platform: 'win32', runner: fake({ 'winget --version': ok('v'), 'winget list': ok('') }) });
  for (const text of ['not json', '[]', '{"app":"Other","format":1,"packages":[]}', '{"app":"KafkaBoost","format":2,"packages":[]}', '{"app":"KafkaBoost","format":1}', 'x'.repeat(1024 * 1024 + 1), 5]) {
    assert.equal((await svc.planImport(text)).code, 'msg.apps.badFile', String(text).slice(0, 30));
  }
  const many = JSON.stringify({ app: 'KafkaBoost', format: 1, packages: Array.from({ length: 1500 }, (_, i) => ({ id: `Pub.App${i}` })) });
  assert.equal((await svc.planImport(many)).items.length, 1000, 'capped');
});

// ---- bloatware remover -------------------------------------------------------------------------------------------
test('bloatware: only allow-listed Appx names are ever put in a command', async () => {
  const run = fake({ 'powershell.exe': ok('Microsoft.BingNews\nSomething.Else\n') });
  const svc = createService({ catalog, platform: 'win32', runner: run });
  assert.deepEqual((await svc.bloatList()).map((b) => b.id), ['bing-news']);
  const listCmd = run.calls[0][run.calls[0].length - 1];
  for (const b of catalog.bloatware) assert.ok(listCmd.includes(`'${b.appx}'`));
  const n = run.calls.length;
  for (const id of ['Microsoft.Windows.Photos', 'x; calc', '', '*', 'bing-news; calc', null, 5]) assert.equal((await svc.bloatRemove(id)).code, 'msg.apps.invalidId', String(id));
  assert.equal(run.calls.length, n, 'nothing ran for ids outside the list');
  const r = await svc.bloatRemove('bing-news');
  assert.ok(r.ok);
  assert.match(run.calls[n][run.calls[n].length - 1], /^Get-AppxPackage -Name 'Microsoft\.BingNews' \| Remove-AppxPackage/);
  assert.ok(!/AllUsers|Remove-AppxProvisionedPackage/.test(run.calls[n].join(' ')), 'current user only');
});

test('bloatware: the list never contains system-critical packages and only exists on Windows', async () => {
  for (const b of catalog.bloatware) assert.doesNotMatch(b.appx, /Store|Xbox|Gaming|NVIDIA|Windows\.(Photos|Calculator)|Edge|Terminal|ShellExperience|SecHealth|DesktopAppInstaller|VCLibs|NET\./i, b.appx);
  assert.ok(bloat.entries(catalog).length === catalog.bloatware.length);
  const lin = createService({ catalog, platform: 'linux', runner: fake() });
  assert.deepEqual(await lin.bloatList(), []);
  assert.equal((await lin.bloatRemove('bing-news')).ok, false);
});

// ---- the real runner ---------------------------------------------------------------------------------------------
test('default runner: arguments are passed as-is (no shell), a missing program is reported', async () => {
  const r = await defaultRunner(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', 'a; echo pwned & $(x) `y`']);
  assert.equal(r.code, 0); assert.equal(r.stdout, 'a; echo pwned & $(x) `y`');
  const bad = await defaultRunner(process.execPath, ['-e', 'process.exit(7)']);
  assert.equal(bad.code, 7);
  const missing = await defaultRunner('definitely-not-a-real-program-kb', []);
  assert.equal(missing.error, 'ENOENT');
});
