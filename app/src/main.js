const { app, BrowserWindow, ipcMain, dialog, nativeTheme, shell, session, net } = require('electron');
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const DEMO = process.env.WIZARD_DEMO === '1';
// Test helpers (WIZARD_SCREENSHOT / WIZARD_SHOTS / WIZARD_TRAYTEST) use a throw-away profile so they never touch the
// user's real settings and never clash with a running copy of the app.
const TEST_MODE = !!(process.env.WIZARD_SCREENSHOT || process.env.WIZARD_SHOTS || process.env.WIZARD_UITEST);
if (DEMO || TEST_MODE || process.env.WIZARD_TRAYTEST) app.setPath('userData', path.join(os.tmpdir(), 'kafkaboost-test-profile'));

const { createStore } = require('./settings');
const { createI18n, resolveLanguage } = require('./i18n');
const { createTray } = require('./tray');
const { linuxAutostartPath, linuxDesktopEntry } = require('./autostart');
const demo = DEMO ? require('./demo') : null;

const repoRoot = path.join(__dirname, '..', '..');
const scriptsDir = app.isPackaged ? path.join(process.resourcesPath, 'scripts') : path.join(repoRoot, 'scripts');
const configDir = app.isPackaged ? path.join(process.resourcesPath, 'config') : path.join(repoRoot, 'config');
// Single source of truth shared with the PowerShell scripts: config/defaults.json
const DEFAULTS = JSON.parse(fs.readFileSync(path.join(configDir, 'defaults.json'), 'utf8'));
const ICON = path.join(__dirname, '..', 'build', 'icon.png');
const REPO = 'carloskafka/legion-14900hx-throttlestop';
const FIRST_CHECK_DELAY_MS = 20 * 1000;
const START_HIDDEN_ARG = process.argv.includes('--hidden');

const PLATFORM = process.env.WIZARD_FAKE_PLATFORM || process.platform;      // win32 | linux | darwin (override is for UI tests only)
const IS_WIN = PLATFORM === 'win32';
const OS_NAME = PLATFORM === 'darwin' ? 'macOS' : PLATFORM === 'linux' ? 'Linux' : 'Windows';

// Which sections exist on this OS. Windows has everything; elsewhere the Windows-only ones show an explanation.
const FEATURES = {
  dashboard: true, analysis: true, optimizations: IS_WIN, cleanup: IS_WIN, restore: IS_WIN, apps: true, settings: true, help: true
};

app.setAppUserModelId('dev.carloskafka.legion-tuning-wizard');
if (!app.requestSingleInstanceLock() && !TEST_MODE) { app.quit(); }

const settings = createStore(path.join(app.getPath('userData'), 'settings.json'));
const i18n = createI18n(path.join(__dirname, '..', 'renderer', 'i18n'));
const applyLanguage = () => i18n.setLang(resolveLanguage(settings.get().language, app.getLocale()));
applyLanguage();
nativeTheme.themeSource = settings.get().theme;

let mainWindow = null;
let tray = null;
let quitting = false;
let lastChecks = null;
let backgroundTimer = null;
let updateTimer = null;

function isAdmin() {
  if (DEMO) return true;
  if (process.platform !== 'win32') return false;
  try { execFileSync('net', ['session'], { stdio: 'ignore' }); return true; } catch { return false; }
}

function createWindow({ show = true } = {}) {
  const win = new BrowserWindow({
    width: 1120, height: 780, minWidth: 920, minHeight: 640, show,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d1017' : '#f4f6fb', title: 'KafkaBoost', icon: fs.existsSync(ICON) ? ICON : undefined,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  // Closing the window keeps the app running in the system tray when the setting allows it; "Quit" in the tray menu really exits.
  win.on('close', (e) => { if (!quitting && tray && tray.exists && settings.get().closeToTray) { e.preventDefault(); win.hide(); } });
  win.on('closed', () => { if (win === mainWindow) mainWindow = null; });
  return win;
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show(); mainWindow.focus();
}

const broadcast = (channel, payload) => BrowserWindow.getAllWindows().forEach((w) => { if (!w.isDestroyed()) w.webContents.send(channel, payload); });

// ---- Steps.ps1 runner ---------------------------------------------------------------------------------------
// Runs scripts\Steps.ps1 -Step <id>. Calls onLog for each "LOG:" line and resolves with the parsed "RESULT:" json.
function runStep(step, opts = {}, onLog = () => {}) {
  return new Promise((resolve) => {
    if (DEMO) {
      const d = demo.demoStep(step, opts);
      d.logs.forEach((l) => onLog(l));
      return setTimeout(() => resolve(d.res), 350);
    }
    if (process.platform !== 'win32') return resolve({ ok: false, message: 'This step is only available on Windows.' });
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(scriptsDir, 'Steps.ps1'), '-Step', step];
    const installDir = opts.installDir || settings.get().installDir;
    if (installDir) args.push('-InstallDir', installDir);
    if (opts.zipPath) args.push('-ZipPath', opts.zipPath);
    if (opts.disableVbs) args.push('-DisableVBS');
    if (opts.restoreVbs) args.push('-RestoreVbs');
    if (opts.mode) args.push('-Mode', opts.mode);
    if (opts.appExe) args.push('-AppExe', opts.appExe);
    if (opts.appArgs) args.push('-AppArgs', opts.appArgs);
    const ps = spawn('powershell.exe', args, { windowsHide: true });
    let buf = '', result = null, stderr = '';
    const handle = (line) => {
      line = line.replace(/\r$/, '');
      if (line.startsWith('LOG: ')) onLog(line.slice(5));
      else if (line.startsWith('RESULT: ')) { try { result = JSON.parse(line.slice(8)); } catch { /* ignore */ } }
      else if (line.trim()) onLog(line);
    };
    ps.stdout.on('data', (d) => { buf += d.toString('utf8'); let i; while ((i = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); } });
    ps.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
    ps.on('close', () => { if (buf.trim()) handle(buf); resolve(result || { ok: false, message: stderr.trim() || 'The step produced no result.' }); });
    ps.on('error', (e) => resolve({ ok: false, message: e.message }));
  });
}

// ---- tray status from any health/fix result ------------------------------------------------------------------
function notify(titleKey, bodyKey, onClick) {
  if (!tray || !settings.get().notifications) return;
  tray.notify(i18n.t(titleKey), i18n.t(bodyKey), onClick);
}

function applyHealthToTray(res) {
  const h = res && res.data;
  if (!tray || !h || !h.checks) return;
  const bad = h.checks.filter((c) => !c.ok && c.severity !== 'info');
  const worse = tray.setStatus(h.verdict, bad.length ? bad.map((c) => i18n.t(`check.${c.id}.name`)).join(', ') : '');
  const updated = h.checks.find((c) => c.id === 'windows' && !c.ok);
  const windowsJustChanged = updated && lastChecks && lastChecks.windowsOk !== false;
  lastChecks = { windowsOk: !updated };
  if (worse) {
    if (updated) notify('notify.worse.title', 'notify.worse.windows', showWindow);
    else if (tray && settings.get().notifications) tray.notify(i18n.t('notify.worse.title'), bad.map((c) => i18n.t(`check.${c.id}.name`)).join(', ') || i18n.t(`tray.verdict.${h.verdict}`), showWindow);
  } else if (windowsJustChanged && h.verdict === 'ok') {
    notify('notify.windowsOk.title', 'notify.windowsOk.body', showWindow);
  }
}

async function backgroundCheck() {
  if (!IS_WIN) return null;
  const res = await runStep('health', {});
  applyHealthToTray(res);
  return res;
}

function scheduleBackground() {
  if (backgroundTimer) clearInterval(backgroundTimer);
  if (!tray || !IS_WIN) return;
  backgroundTimer = setInterval(backgroundCheck, settings.get().checkIntervalMin * 60 * 1000);
}

// ---- updates (GitHub releases + changelog) -------------------------------------------------------------------
// Looks at the repository's GitHub Releases. When newer ones exist the page shows their notes (the changelog).
// The installed Windows build can download and install by itself (electron-updater); a portable exe or a source
// checkout only gets the notes and a link, because it has nothing to replace in place.
const updates = require('./updates');
const selfUpdate = () => updates.canSelfUpdate({ isPackaged: app.isPackaged, platform: process.platform, portable: !!process.env.PORTABLE_EXECUTABLE_DIR }) && !DEMO;
let lastUpdate = null;      // last successful check result (also what the "Update available" banner shows)

async function fetchReleases() {
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await net.fetch(`https://api.github.com/repos/${REPO}/releases?per_page=15`, { headers: { 'User-Agent': 'KafkaBoost', Accept: 'application/vnd.github+json' }, signal: ctl.signal });
    if (r.status === 404) return [];
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}

async function checkUpdate() {
  const current = app.getVersion();
  try {
    const list = updates.newerReleases(await fetchReleases(), current);
    const latest = list.length ? list[0] : null;
    lastUpdate = {
      ok: true, current, latest: latest ? latest.version : current, newer: !!latest,
      url: latest ? latest.url : `https://github.com/${REPO}/releases`,
      releases: list.map((r) => ({ version: r.version, name: r.name, date: r.date, notes: updates.parseNotes(r.body) })),
      canInstall: selfUpdate()
    };
    return lastUpdate;
  } catch (e) { return { ok: false, error: e.name === 'AbortError' ? 'timeout' : e.message }; }
}

// "What's new": after the app was updated, show the notes of the version now running, once.
async function whatsNew() {
  const current = app.getVersion(); const seen = settings.get().lastSeenVersion;
  if (seen === current) return { show: false };
  settings.set({ lastSeenVersion: current });
  if (!seen) return { show: false };                       // first run ever: nothing was "updated"
  try {
    const rel = updates.releaseFor(await fetchReleases(), current);
    if (!rel) return { show: false };
    return { show: true, current, releases: [{ version: rel.version, name: rel.name, date: rel.date, notes: updates.parseNotes(rel.body) }] };
  } catch { return { show: false }; }
}

let updaterWired = false;
function wireUpdater(send) {
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = false; autoUpdater.autoInstallOnAppQuit = true;
  if (!updaterWired) {
    updaterWired = true;
    autoUpdater.on('download-progress', (p) => send({ stage: 'downloading', percent: Math.round(p.percent || 0) }));
    autoUpdater.on('update-downloaded', () => { send({ stage: 'ready' }); setTimeout(() => { quitting = true; autoUpdater.quitAndInstall(false, true); }, 1500); });
    autoUpdater.on('error', (e) => send({ stage: 'error', error: e && e.message ? e.message : String(e) }));
  }
  return autoUpdater;
}
async function installUpdate(send) {
  if (!selfUpdate()) return { ok: false, error: 'not-installable' };
  try {
    const au = wireUpdater(send);
    const r = await au.checkForUpdates();
    if (!r || !r.updateInfo || !updates.isNewer(r.updateInfo.version, app.getVersion())) return { ok: false, error: 'no-update-file' };
    send({ stage: 'downloading', percent: 0 });
    au.downloadUpdate();
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

function scheduleUpdateCheck() {
  if (updateTimer) clearInterval(updateTimer);
  if (!settings.get().checkForUpdates || TEST_MODE || DEMO) return;
  const run = async () => {
    const before = lastUpdate && lastUpdate.latest;
    const r = await checkUpdate();
    if (!(r.ok && r.newer)) return;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:available', r);
    if (r.latest !== before && tray && settings.get().notifications) tray.notify('KafkaBoost', i18n.t('settings.newer', { latest: r.latest, current: r.current }), () => { showWindow(); if (mainWindow) mainWindow.webContents.send('update:show', r); });
  };
  setTimeout(run, 15 * 1000); updateTimer = setInterval(run, 6 * 3600 * 1000);
}

// ---- start with the system ----------------------------------------------------------------------------------
const hiddenArg = () => (settings.get().startHidden ? ' --hidden' : '');
const appLaunch = () => ({ appExe: process.execPath, appArgs: (app.isPackaged ? '' : `"${app.getAppPath()}"`) + hiddenArg() });

async function getAutostart() {
  if (IS_WIN) { const res = await runStep('autostart', { mode: 'status' }); return !!(res.data && res.data.enabled); }
  if (PLATFORM === 'darwin') return app.getLoginItemSettings().openAtLogin;
  return fs.existsSync(linuxAutostartPath());
}
async function setAutostart(on) {
  let enabled = on, message = '', ok = true, code = null;
  if (IS_WIN) {
    const res = await runStep('autostart', { mode: on ? 'on' : 'off', ...appLaunch() });
    ok = res.ok; enabled = !!(res.data && res.data.enabled); message = res.message; code = res.code;
  } else if (PLATFORM === 'darwin') {
    app.setLoginItemSettings({ openAtLogin: on, args: settings.get().startHidden ? ['--hidden'] : [] });
  } else {
    const file = linuxAutostartPath();
    try {
      if (on) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, linuxDesktopEntry(process.execPath, [...(app.isPackaged ? [] : [app.getAppPath()]), ...(settings.get().startHidden ? ['--hidden'] : [])])); }
      else if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch (e) { ok = false; message = e.message; enabled = fs.existsSync(file); }
  }
  if (tray) tray.setAutostart(enabled);
  return { ok, enabled, message, code };
}

// ---- IPC ----------------------------------------------------------------------------------------------------
ipcMain.handle('app:info', () => ({
  platform: PLATFORM,
  osName: OS_NAME,
  arch: process.arch,
  isAdmin: isAdmin(),
  demo: DEMO,
  version: app.getVersion(),
  cpu: (os.cpus()[0] || {}).model || 'unknown',
  cores: os.cpus().length,
  ramGB: Math.round(os.totalmem() / 1024 ** 3),
  osRelease: `${os.type()} ${os.release()}`,
  tray: !!(tray && tray.exists),
  features: FEATURES
}));

ipcMain.handle('settings:get', () => settings.get());
ipcMain.handle('settings:set', (_e, patch) => settings.set(patch));
ipcMain.handle('settings:reset', () => settings.reset());
ipcMain.handle('i18n:get', () => i18n.payload());

ipcMain.handle('step:run', async (event, step, opts = {}) => {
  const res = await runStep(step, opts, (line) => event.sender.send('step:log', step, line));
  if (step === 'health' || step === 'fix') applyHealthToTray(res);
  return res;
});

ipcMain.handle('app:autostart', async (_e, mode) => (mode === 'status' ? { enabled: await getAutostart() } : setAutostart(mode === 'on')));
ipcMain.handle('app:checkUpdate', () => checkUpdate());
ipcMain.handle('app:whatsNew', () => whatsNew());
ipcMain.handle('app:installUpdate', (event) => installUpdate((p) => { if (!event.sender.isDestroyed()) event.sender.send('update:progress', p); }));

ipcMain.handle('app:openPath', async (_e, which) => {
  const dir = which === 'logs' ? path.join(app.getPath('userData'), 'logs') : which === 'data' ? app.getPath('userData') : null;
  if (!dir) return { ok: false };
  fs.mkdirSync(dir, { recursive: true });
  return { ok: !(await shell.openPath(dir)) };
});
ipcMain.handle('app:openInstallDir', async () => {
  const res = await runStep('paths', {});
  const dir = res.data && res.data.installDir;
  if (!dir || !fs.existsSync(dir)) return { ok: false };
  return { ok: !(await shell.openPath(dir)) };
});
ipcMain.handle('app:clearCache', async () => { await session.defaultSession.clearCache(); await session.defaultSession.clearStorageData({ storages: ['cachestorage', 'serviceworkers'] }); return { ok: true }; });

ipcMain.handle('dialog:zip', async () => {
  const r = await dialog.showOpenDialog({ title: 'ThrottleStop zip', properties: ['openFile'], filters: [{ name: 'Zip', extensions: ['zip'] }] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('dialog:folder', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('app:relaunchAdmin', () => {
  if (process.platform !== 'win32') return false;
  const argList = app.isPackaged ? '' : `-ArgumentList '"${app.getAppPath()}"'`;
  spawn('powershell.exe', ['-NoProfile', '-Command', `Start-Process -FilePath '${process.execPath}' ${argList} -Verb RunAs`], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
  quitting = true; app.quit();
  return true;
});

const EXTERNAL_OK = /^https:\/\/(www\.techpowerup\.com\/|carloskafka\.github\.io\/legion-14900hx-throttlestop|github\.com\/carloskafka\/legion-14900hx-throttlestop)/;
ipcMain.handle('app:openExternal', (_e, url) => { if (EXTERNAL_OK.test(url)) return shell.openExternal(url); });

// Settings side effects: theme, language (tray + renderer), tray timers, autostart arguments.
settings.onChange((s) => {
  nativeTheme.themeSource = s.theme;
  const before = i18n.lang; applyLanguage();
  if (i18n.lang !== before && tray) tray.refreshLanguage();
  scheduleBackground(); scheduleUpdateCheck();
  broadcast('settings:changed', { settings: s, i18n: i18n.payload() });
});

// ---- Test helpers (not used in normal runs) -------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function shot(win, file) { fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG()); }
const js = (win, code) => win.webContents.executeJavaScript(code);

app.on('second-instance', () => showWindow());
app.on('before-quit', () => { quitting = true; });
// The app stays alive in the tray when the window is closed; in test modes there is no tray, so quit as before.
app.on('window-all-closed', () => { if (TEST_MODE || !tray) app.quit(); });

app.whenReady().then(async () => {
  if (!app.requestSingleInstanceLock() && !TEST_MODE) return;
  mainWindow = createWindow({ show: !(START_HIDDEN_ARG || (process.argv.includes('--hidden'))) || TEST_MODE });

  if (!TEST_MODE) {
    try {
      tray = createTray({
        t: i18n.t,
        onOpen: showWindow,
        onCheck: async () => { showWindow(); await backgroundCheck(); },
        onQuit: () => { quitting = true; app.quit(); },
        onToggleAutostart: (on) => setAutostart(on)
      });
      getAutostart().then((on) => tray && tray.setAutostart(on));
      if (IS_WIN) setTimeout(backgroundCheck, FIRST_CHECK_DELAY_MS);
      scheduleBackground(); scheduleUpdateCheck();
    } catch (e) { tray = null; console.error('tray unavailable:', e.message); }   // e.g. Linux without an appindicator
  }

  // WIZARD_TRAYTEST=<file.json>: closes the window, then records that the process and the tray survive it and the window can be reopened.
  if (process.env.WIZARD_TRAYTEST) {
    const file = process.env.WIZARD_TRAYTEST;
    mainWindow.webContents.once('did-finish-load', async () => {
      for (let i = 0; i < 200 && tray && tray.verdict === 'unknown'; i++) await sleep(100);   // wait for the first health check
      const before = { windowVisible: mainWindow.isVisible() };
      mainWindow.close(); await sleep(1500);
      const after = { windowVisible: mainWindow.isDestroyed() ? false : mainWindow.isVisible(), windowDestroyed: mainWindow.isDestroyed(), trayExists: !!(tray && tray.exists), verdict: tray ? tray.verdict : null };
      showWindow(); await sleep(500);
      fs.writeFileSync(file, JSON.stringify({ before, afterClose: after, afterOpenFromTray: { windowVisible: mainWindow.isVisible() } }, null, 2));
      quitting = true; app.quit();
    });
  }

  // WIZARD_SCREENSHOT=<file.png>: saves the window after the first load and quits.
  if (process.env.WIZARD_SCREENSHOT) {
    mainWindow.webContents.once('did-finish-load', () => setTimeout(async () => { await shot(mainWindow, process.env.WIZARD_SCREENSHOT); app.quit(); }, 6000));
  }

  // WIZARD_UITEST=<result.json>: clicks through Settings and the Optimizations flow in demo mode and records pass/fail (tools/uitest.js).
  if (process.env.WIZARD_UITEST) {
    mainWindow.webContents.once('did-finish-load', async () => {
      await sleep(1800);
      try { await require('../../tools/uitest').run({ win: mainWindow, js, sleep, settings, outFile: process.env.WIZARD_UITEST, platform: PLATFORM }); }
      catch (e) { fs.writeFileSync(process.env.WIZARD_UITEST, JSON.stringify({ passed: 0, failed: 1, results: [{ name: 'harness', ok: false, detail: String(e) }] })); }
      settings.reset(); quitting = true; app.quit();
    });
  }

  // WIZARD_SHOTS=<dir>: walks the whole UI in demo mode and saves one PNG per state (see tools/shots.js; used for docs/assets).
  if (process.env.WIZARD_SHOTS) {
    const win = mainWindow;
    win.webContents.once('did-finish-load', async () => {
      await sleep(1500);
      try { await require('../../tools/shots').run({ win, dir: process.env.WIZARD_SHOTS, shot, js, sleep, demo, settings, PLATFORM }); }
      catch (e) { console.error('shots failed:', e); }
      app.quit();
    });
  }
});
