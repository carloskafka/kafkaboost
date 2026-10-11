const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const repoRoot = path.join(__dirname, '..', '..');
const scriptsDir = app.isPackaged ? path.join(process.resourcesPath, 'scripts') : path.join(repoRoot, 'scripts');
const configDir = app.isPackaged ? path.join(process.resourcesPath, 'config') : path.join(repoRoot, 'config');
// Single source of truth shared with the PowerShell scripts: config/defaults.json
const DEFAULTS = JSON.parse(fs.readFileSync(path.join(configDir, 'defaults.json'), 'utf8'));
const DEFAULT_INSTALL_DIR = DEFAULTS.installDir;
const DEMO = process.env.WIZARD_DEMO === '1';
const demo = DEMO ? require('./demo') : null;
const ICON = path.join(__dirname, '..', 'build', 'icon.png');

app.setAppUserModelId('dev.carloskafka.legion-tuning-wizard');

function isAdmin() {
  if (DEMO) return true;
  if (process.platform !== 'win32') return false;
  try { execFileSync('net', ['session'], { stdio: 'ignore' }); return true; } catch { return false; }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1080, height: 740, minWidth: 900, minHeight: 640,
    backgroundColor: '#0d1017', title: 'Legion Tuning', icon: fs.existsSync(ICON) ? ICON : undefined,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  return win;
}

ipcMain.handle('app:info', () => ({
  platform: process.env.WIZARD_FAKE_PLATFORM || process.platform,   // win32 | linux | darwin (override is for UI tests only)
  arch: process.arch,
  isAdmin: isAdmin(),
  demo: DEMO,
  cpu: (os.cpus()[0] || {}).model || 'unknown',
  defaultInstallDir: DEFAULT_INSTALL_DIR
}));

// Runs scripts\Steps.ps1 -Step <id>. Streams "LOG:" lines to the renderer, resolves with the parsed "RESULT:" json.
ipcMain.handle('step:run', (event, step, opts = {}) => new Promise((resolve) => {
  if (DEMO) {
    const d = demo.demoStep(step);
    d.logs.forEach((l) => event.sender.send('step:log', step, l));
    return setTimeout(() => resolve(d.res), 350);
  }
  if (process.platform !== 'win32') return resolve({ ok: false, message: 'Tuning steps are only available on Windows.' });
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(scriptsDir, 'Steps.ps1'), '-Step', step,
                '-InstallDir', opts.installDir || DEFAULT_INSTALL_DIR];
  if (opts.zipPath) args.push('-ZipPath', opts.zipPath);
  if (opts.disableVbs) args.push('-DisableVBS');
  if (opts.restoreVbs) args.push('-RestoreVbs');
  const ps = spawn('powershell.exe', args, { windowsHide: true });
  let buf = '', result = null, stderr = '';
  const handle = (line) => {
    line = line.replace(/\r$/, '');
    if (line.startsWith('LOG: ')) event.sender.send('step:log', step, line.slice(5));
    else if (line.startsWith('RESULT: ')) { try { result = JSON.parse(line.slice(8)); } catch { /* ignore */ } }
    else if (line.trim()) event.sender.send('step:log', step, line);
  };
  ps.stdout.on('data', (d) => { buf += d.toString('utf8'); let i; while ((i = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); } });
  ps.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
  ps.on('close', () => {
    if (buf.trim()) handle(buf);
    resolve(result || { ok: false, message: stderr.trim() || 'The step produced no result.' });
  });
  ps.on('error', (e) => resolve({ ok: false, message: e.message }));
}));

ipcMain.handle('dialog:zip', async () => {
  const r = await dialog.showOpenDialog({ title: 'Select the ThrottleStop zip', properties: ['openFile'], filters: [{ name: 'Zip', extensions: ['zip'] }] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('app:relaunchAdmin', () => {
  if (process.platform !== 'win32') return false;
  const argList = app.isPackaged ? '' : `-ArgumentList '"${app.getAppPath()}"'`;
  spawn('powershell.exe', ['-NoProfile', '-Command', `Start-Process -FilePath '${process.execPath}' ${argList} -Verb RunAs`], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
  app.quit();
  return true;
});

ipcMain.handle('app:openExternal', (e, url) => { if (/^https:\/\/www\.techpowerup\.com\//.test(url)) return require('electron').shell.openExternal(url); });

// ---- Test helpers (not used in normal runs) -------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function shot(win, file) { fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG()); }
const js = (win, code) => win.webContents.executeJavaScript(code);
const waitIdle = async (win) => { for (let i = 0; i < 80; i++) { if (await js(win, "!document.getElementById('run').disabled && !document.getElementById('check').disabled")) return; await sleep(100); } };

// WIZARD_SCREENSHOT=<file.png>: saves the window after the first load and quits.
// WIZARD_SHOTS=<dir>: walks the whole UI in demo mode and saves one PNG per state (used for docs/assets).
app.whenReady().then(() => {
  const win = createWindow();
  if (process.env.WIZARD_SCREENSHOT) {
    win.webContents.once('did-finish-load', () => setTimeout(async () => { await shot(win, process.env.WIZARD_SCREENSHOT); app.quit(); }, 6000));
  }
  if (process.env.WIZARD_SHOTS) {
    const dir = process.env.WIZARD_SHOTS; fs.mkdirSync(dir, { recursive: true });
    win.webContents.once('did-finish-load', async () => {
      await sleep(1500);
      if ((process.env.WIZARD_FAKE_PLATFORM || process.platform) !== 'win32') { await shot(win, path.join(dir, 'unsupported.png')); return app.quit(); }
      await shot(win, path.join(dir, 'health-ok.png'));
      if (DEMO) {
        demo.state.scenario = 'updated'; demo.state.fixed = false;
        await js(win, "document.getElementById('check').click()"); await sleep(700); await shot(win, path.join(dir, 'health-attention.png'));
        await js(win, "document.getElementById('fix').click()"); await sleep(1200); await shot(win, path.join(dir, 'health-fixed.png'));
      }
      await js(win, "document.querySelector('[data-view=wizard]').click()"); await sleep(800);
      const ids = ['detect', 'backup', 'get', 'vbs', 'apply', 'task', 'verify'];
      for (let i = 0; i < ids.length; i++) {
        if (i > 0) await js(win, "document.getElementById('run').click()");
        await waitIdle(win); await sleep(300);
        await shot(win, path.join(dir, `step-${i}-${ids[i]}.png`));
        await js(win, "document.getElementById('next').click()"); await sleep(400);
      }
      await shot(win, path.join(dir, 'finish.png'));
      app.quit();
    });
  }
});
app.on('window-all-closed', () => app.quit());
