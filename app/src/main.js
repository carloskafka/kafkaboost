const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { createTray, LABEL } = require('./tray');

const repoRoot = path.join(__dirname, '..', '..');
const scriptsDir = app.isPackaged ? path.join(process.resourcesPath, 'scripts') : path.join(repoRoot, 'scripts');
const configDir = app.isPackaged ? path.join(process.resourcesPath, 'config') : path.join(repoRoot, 'config');
// Single source of truth shared with the PowerShell scripts: config/defaults.json
const DEFAULTS = JSON.parse(fs.readFileSync(path.join(configDir, 'defaults.json'), 'utf8'));
const DEFAULT_INSTALL_DIR = DEFAULTS.installDir;
const DEMO = process.env.WIZARD_DEMO === '1';
const demo = DEMO ? require('./demo') : null;
const ICON = path.join(__dirname, '..', 'build', 'icon.png');
const BACKGROUND_CHECK_MS = 30 * 60 * 1000;      // health check while the app sits in the tray
const FIRST_CHECK_DELAY_MS = 20 * 1000;
// Test helpers (WIZARD_SCREENSHOT / WIZARD_SHOTS / WIZARD_TRAYTEST) must not leave a tray app behind or show toasts.
const TEST_MODE = !!(process.env.WIZARD_SCREENSHOT || process.env.WIZARD_SHOTS);
const START_HIDDEN = process.argv.includes('--hidden');

app.setAppUserModelId('dev.carloskafka.legion-tuning-wizard');

// One instance only: a second launch (shortcut, startup task) just brings the first one forward.
if (!app.requestSingleInstanceLock() && !TEST_MODE) { app.quit(); }

let mainWindow = null;
let tray = null;
let quitting = false;
let lastChecks = null;

function isAdmin() {
  if (DEMO) return true;
  if (process.platform !== 'win32') return false;
  try { execFileSync('net', ['session'], { stdio: 'ignore' }); return true; } catch { return false; }
}

function createWindow({ show = true } = {}) {
  const win = new BrowserWindow({
    width: 1080, height: 740, minWidth: 900, minHeight: 640, show,
    backgroundColor: '#0d1017', title: 'Legion Tuning', icon: fs.existsSync(ICON) ? ICON : undefined,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  // Closing the window keeps the app running in the system tray; "Quit" in the tray menu really exits.
  win.on('close', (e) => { if (!quitting && tray && tray.exists) { e.preventDefault(); win.hide(); } });
  return win;
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show(); mainWindow.focus();
}

// ---- Steps.ps1 runner ---------------------------------------------------------------------------------------
// Runs scripts\Steps.ps1 -Step <id>. Calls onLog for each "LOG:" line and resolves with the parsed "RESULT:" json.
function runStep(step, opts = {}, onLog = () => {}) {
  return new Promise((resolve) => {
    if (DEMO) {
      const d = demo.demoStep(step);
      d.logs.forEach((l) => onLog(l));
      return setTimeout(() => resolve(d.res), 350);
    }
    if (process.platform !== 'win32') return resolve({ ok: false, message: 'Tuning steps are only available on Windows.' });
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(scriptsDir, 'Steps.ps1'), '-Step', step,
                  '-InstallDir', opts.installDir || DEFAULT_INSTALL_DIR];
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
function applyHealthToTray(res) {
  const h = res && res.data;
  if (!tray || !h || !h.checks) return;
  const bad = h.checks.filter((c) => !c.ok && c.severity !== 'info');
  const worse = tray.setStatus(h.verdict, bad.length ? bad.map((c) => c.name).join(', ') : '');
  const updated = h.checks.find((c) => c.id === 'windows' && !c.ok);
  const windowsJustChanged = updated && lastChecks && lastChecks.windowsOk !== false;
  lastChecks = { windowsOk: !updated };
  if (worse) {
    tray.notify('Legion Tuning: optimization needs attention',
      updated ? 'Windows was updated and the tuning is no longer fully in place. Click to review and fix it.' : (bad.map((c) => c.name).join(', ') || LABEL[h.verdict]), showWindow);
  } else if (windowsJustChanged && h.verdict === 'ok') {
    tray.notify('Legion Tuning', 'Windows was updated. Your optimization is still in place.', showWindow);
  }
}

async function backgroundCheck() {
  const res = await runStep('health', { installDir: DEFAULT_INSTALL_DIR });
  applyHealthToTray(res);
  return res;
}

// ---- start with Windows (scheduled task that opens the app hidden in the tray) -------------------------------
const appLaunch = () => ({ appExe: process.execPath, appArgs: app.isPackaged ? '--hidden' : `"${app.getAppPath()}" --hidden` });
async function queryAutostart() {
  const res = await runStep('autostart', { mode: 'status' });
  return !!(res.data && res.data.enabled);
}
async function setAutostart(on) {
  const res = await runStep('autostart', { mode: on ? 'on' : 'off', ...appLaunch() });
  const enabled = !!(res.data && res.data.enabled);
  if (tray) tray.setAutostart(enabled);
  return { ok: res.ok, enabled, message: res.message };
}

// ---- IPC ----------------------------------------------------------------------------------------------------
ipcMain.handle('app:info', () => ({
  platform: process.env.WIZARD_FAKE_PLATFORM || process.platform,   // win32 | linux | darwin (override is for UI tests only)
  arch: process.arch,
  isAdmin: isAdmin(),
  demo: DEMO,
  version: app.getVersion(),
  cpu: (os.cpus()[0] || {}).model || 'unknown',
  defaultInstallDir: DEFAULT_INSTALL_DIR,
  tray: !!(tray && tray.exists)
}));

ipcMain.handle('step:run', async (event, step, opts = {}) => {
  const res = await runStep(step, opts, (line) => event.sender.send('step:log', step, line));
  if (step === 'health' || step === 'fix') applyHealthToTray(res);
  return res;
});

ipcMain.handle('app:autostart', async (_e, mode) => (mode === 'status' ? { enabled: await queryAutostart() } : setAutostart(mode === 'on')));

ipcMain.handle('dialog:zip', async () => {
  const r = await dialog.showOpenDialog({ title: 'Select the ThrottleStop zip', properties: ['openFile'], filters: [{ name: 'Zip', extensions: ['zip'] }] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('app:relaunchAdmin', () => {
  if (process.platform !== 'win32') return false;
  const argList = app.isPackaged ? '' : `-ArgumentList '"${app.getAppPath()}"'`;
  spawn('powershell.exe', ['-NoProfile', '-Command', `Start-Process -FilePath '${process.execPath}' ${argList} -Verb RunAs`], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
  quitting = true; app.quit();
  return true;
});

ipcMain.handle('app:openExternal', (e, url) => { if (/^https:\/\/(www\.techpowerup\.com\/|carloskafka\.github\.io\/legion-14900hx-throttlestop|github\.com\/carloskafka\/legion-14900hx-throttlestop)/.test(url)) return require('electron').shell.openExternal(url); });

// ---- Test helpers (not used in normal runs) -------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function shot(win, file) { fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG()); }
const js = (win, code) => win.webContents.executeJavaScript(code);
const waitIdle = async (win) => { for (let i = 0; i < 80; i++) { if (await js(win, "!document.getElementById('run').disabled && !document.getElementById('check').disabled")) return; await sleep(100); } };

app.on('second-instance', () => showWindow());
app.on('before-quit', () => { quitting = true; });
// The app stays alive in the tray when the window is closed; in test modes there is no tray, so quit as before.
app.on('window-all-closed', () => { if (TEST_MODE || !tray) app.quit(); });

app.whenReady().then(async () => {
  if (!app.requestSingleInstanceLock() && !TEST_MODE) return;
  const supported = (process.env.WIZARD_FAKE_PLATFORM || process.platform) === 'win32';
  mainWindow = createWindow({ show: !START_HIDDEN || TEST_MODE });

  if (!TEST_MODE && supported) {
    tray = createTray({
      onOpen: showWindow,
      onCheck: async () => { showWindow(); await backgroundCheck(); },
      onQuit: () => { quitting = true; app.quit(); },
      onToggleAutostart: (on) => setAutostart(on)
    });
    queryAutostart().then((on) => tray && tray.setAutostart(on));
    setTimeout(backgroundCheck, FIRST_CHECK_DELAY_MS);
    setInterval(backgroundCheck, BACKGROUND_CHECK_MS);
  }

  // WIZARD_TRAYTEST=<file.json>: closes the window and records that the process and the tray survive it.
  if (process.env.WIZARD_TRAYTEST) {
    const file = process.env.WIZARD_TRAYTEST;
    mainWindow.webContents.once('did-finish-load', async () => {
      for (let i = 0; i < 200 && tray && tray.verdict === 'unknown'; i++) await sleep(100);   // wait for the first health check
      const before = { windowVisible: mainWindow.isVisible() };
      mainWindow.close(); await sleep(1500);
      const after = { windowVisible: mainWindow.isDestroyed() ? false : mainWindow.isVisible(), windowDestroyed: mainWindow.isDestroyed(), trayExists: !!(tray && tray.exists), verdict: tray ? tray.verdict : null };
      showWindow(); await sleep(500);
      const reopened = { windowVisible: mainWindow.isVisible() };
      fs.writeFileSync(file, JSON.stringify({ before, afterClose: after, afterOpenFromTray: reopened }, null, 2));
      quitting = true; app.quit();
    });
  }

  // WIZARD_SCREENSHOT=<file.png>: saves the window after the first load and quits.
  if (process.env.WIZARD_SCREENSHOT) {
    mainWindow.webContents.once('did-finish-load', () => setTimeout(async () => { await shot(mainWindow, process.env.WIZARD_SCREENSHOT); app.quit(); }, 6000));
  }
  // WIZARD_SHOTS=<dir>: walks the whole UI in demo mode and saves one PNG per state (used for docs/assets).
  if (process.env.WIZARD_SHOTS) {
    const win = mainWindow;
    const dir = process.env.WIZARD_SHOTS; fs.mkdirSync(dir, { recursive: true });
    win.webContents.once('did-finish-load', async () => {
      await sleep(1500);
      if (!supported) { await shot(win, path.join(dir, 'unsupported.png')); return app.quit(); }
      const click = (sel) => js(win, `document.querySelector(${JSON.stringify(sel)}).click()`);
      await shot(win, path.join(dir, 'health-ok.png'));
      if (DEMO) {
        demo.state.scenario = 'updated'; demo.state.fixed = false;
        await click('#check'); await sleep(700); await shot(win, path.join(dir, 'health-attention.png'));
        await click('#fix'); await sleep(1200); await shot(win, path.join(dir, 'health-fixed.png'));
      }
      await click('[data-view=analysis]'); await sleep(1200); await shot(win, path.join(dir, 'analysis.png'));
      await click('[data-view=optimizations]'); await sleep(600); await shot(win, path.join(dir, 'optimizations.png'));
      await click('#openThrottle'); await sleep(800);
      const ids = ['detect', 'backup', 'get', 'vbs', 'apply', 'task', 'verify'];
      for (let i = 0; i < ids.length; i++) {
        if (i > 0) await click('#run');
        await waitIdle(win); await sleep(300);
        await shot(win, path.join(dir, `step-${i}-${ids[i]}.png`));
        await click('#next'); await sleep(400);
      }
      await shot(win, path.join(dir, 'finish.png'));
      await click('[data-view=restore]'); await sleep(500); await shot(win, path.join(dir, 'restore.png'));
      await click('[data-view=help]'); await sleep(500); await js(win, "document.querySelector('.faq details').open = true"); await shot(win, path.join(dir, 'help.png'));
      app.quit();
    });
  }
});
