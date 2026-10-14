'use strict';
// UI interaction test for WIZARD_UITEST=<result.json> (see app/src/main.js). Drives the real renderer in demo mode and records
// pass/fail per check. Run it with tools/run-uitest.ps1. Local only (needs a desktop session, so CI does not run it).
const fs = require('fs');

// The clipboard is shared with the user: keep their text and put it back when the run ends, whatever happens.
async function run(ctx) {
  const { clipboard } = require('electron');
  let saved = null;
  try { saved = await clipboard.readText(); } catch { /* no clipboard: nothing to restore */ }
  try { await runChecks(ctx); }
  finally { if (saved !== null) { try { await clipboard.writeText(saved); } catch { /* best effort */ } } }
}

async function runChecks({ win, js, sleep, settings, demo, startHwinfoWithApp, outFile, platform }) {
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  const q = (sel) => js(win, `(()=>{const e=document.querySelector(${JSON.stringify(sel)});return e?e.textContent.trim():null})()`);
  const visible = (id) => js(win, `(()=>{const e=document.getElementById(${JSON.stringify(id)});return !!e && !e.hidden})()`);
  const click = (sel) => js(win, `document.querySelector(${JSON.stringify(sel)}).click()`);
  const setVal = (id, v) => js(win, `(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await js(win, 'window.confirm = () => true; 0');                      // the Reset button asks first

  // Polling helpers. Effects that arrive by a timer (the 2 s telemetry/sensor polls) or from the main process are waited for,
  // never slept for: a busy machine only makes the wait longer, it cannot make a check fail early.
  const WAIT_MS = 15000;
  const waitFor = async (expr, ms = WAIT_MS) => { const end = Date.now() + ms; let v = await js(win, expr); while (!v && Date.now() < end) { await sleep(150); v = await js(win, expr); } return v; };
  // until(fn): polls an async function until it returns something truthy, returns the last value either way (put it in the detail).
  const until = async (fn, ms = WAIT_MS) => { const end = Date.now() + ms; let v = await fn(); while (!v && Date.now() < end) { await sleep(150); v = await fn(); } return v; };
  // Polling pauses on a hidden page and the clipboard API needs a focused document, so the test window must really be in front.
  const foreground = async () => {
    try {
      if (win.isMinimized()) win.restore();
      win.show(); win.setAlwaysOnTop(true); win.focus(); win.moveTop();
      await until(() => js(win, 'document.hasFocus() && !document.hidden'), 5000);
      win.setAlwaysOnTop(false);
    } catch { /* best effort: the checks that need it say so in their detail */ }
  };
  await foreground();

  if (platform !== 'win32') {
    await click('[data-view=optimizations]'); await sleep(400);
    check('windows-only panel replaces Optimizations', await visible('windowsOnly') && !(await visible('optimizations')));
    check('windows-only panel names the OS', (await q('#windowsOnlyText')).includes('Linux') || (await q('#windowsOnlyText')).includes('macOS'), await q('#windowsOnlyText'));
    await click('[data-view=sensors]'); await sleep(400);
    check('windows-only panel replaces Sensors', await visible('windowsOnly') && !(await visible('sensors')));
    await js(win, "KB.showView('cs2')"); await sleep(300);
    check('the Counter-Strike 2 page is Windows only too', await visible('windowsOnly') && !(await visible('cs2')));
    await js(win, "KB.showView('rammap')"); await sleep(300);
    check('the RAMMap page is Windows only too', await visible('windowsOnly') && !(await visible('rammap')));
    await js(win, "KB.showView('memory')"); await sleep(300);
    check('the Memory page is Windows only too', await visible('windowsOnly') && !(await visible('memory')));
    await click('[data-view=settings]'); await sleep(400);
    check('Settings still works on this OS', await visible('settings'));
    check('Windows-only settings are hidden', !(await visible('thermalCard')) && !(await visible('sStartHwinfoRow')) && !(await visible('sAutoRecordRow')));
    await click('[data-view=apps]'); await sleep(1500);
    const cnt = (sel) => js(win, `document.querySelectorAll(${JSON.stringify(sel)}).length`);
    check('Apps works on this OS (no Windows-only panel)', await visible('apps') && !(await visible('windowsOnly')));
    check('Apps names the active package manager', (await q('#appsManager')).includes('Flatpak'), await q('#appsManager'));
    check('Apps offers only the apps with a verified Flatpak id', (await cnt('.app-card')) === 15, await cnt('.app-card'));
    check('the Windows bloatware remover is hidden on Linux', !(await visible('bloatCard')));
    await click('[data-view=health]'); await sleep(400);
    check('Dashboard shows basic system info', (await q('#heroTitle')).length > 0, await q('#heroTitle'));
    check('Dashboard hardware cards: CPU, memory, system (no live tiles, no level)', (await js(win, "document.querySelectorAll('.hw-card').length")) === 3 && !(await visible('tiles')) && !(await visible('optLevel')) && !(await visible('tilesNotice')) && !(await visible('sessCard')) && !(await visible('advCard')));
    return finish();
  }

  await click('[data-view=settings]'); await sleep(500);
  check('Settings screen opens', await visible('settings'));

  await click('[data-theme-value=light]'); await sleep(400);
  check('theme: Light applies at once', (await js(win, 'document.documentElement.dataset.theme')) === 'light');
  check('theme: Light is saved', settings.get().theme === 'light');
  await click('[data-theme-value=dark]'); await sleep(300);
  check('theme: Dark applies at once', (await js(win, 'document.documentElement.dataset.theme')) === 'dark');
  await click('#themeBtn'); await sleep(300);
  check('sidebar theme button toggles dark -> light', (await js(win, 'document.documentElement.dataset.theme')) === 'light' && settings.get().theme === 'light');
  await click('[data-theme-value=system]'); await sleep(300);
  check('theme: system is saved', settings.get().theme === 'system');

  await setVal('langSel', 'pt-BR'); await sleep(700);
  check('language: Portuguese saved', settings.get().language === 'pt-BR');
  check('language: sidebar is translated', (await q('[data-view=health] span:last-child')) === 'Painel', await q('[data-view=health] span:last-child'));
  check('language: Settings page is translated', (await q('#settings h1')) === 'Preferências', await q('#settings h1'));
  await setVal('langSel', 'en'); await sleep(700);
  check('language: back to English', (await q('[data-view=health] span:last-child')) === 'Dashboard');

  await click('#sCloseToTray'); await sleep(300);
  check('toggle: close-to-tray off is saved', settings.get().closeToTray === false);
  await click('#sNotifications'); await sleep(300);
  check('toggle: notifications off is saved', settings.get().notifications === false);
  await click('#sStartHidden'); await sleep(300);
  check('toggle: start hidden on is saved', settings.get().startHidden === true);
  check('Settings has the "Start HWiNFO with KafkaBoost" switch, off by default, with a plain hint', (await visible('sStartHwinfoRow')) && (await js(win, "document.getElementById('sStartHwinfo').checked")) === false && settings.get().startHwinfoWithApp === false && (await q('#sStartHwinfoRow .row-hint')).includes('never changed'), await q('#sStartHwinfoRow .row-hint'));
  await click('#sStartHwinfo'); await sleep(300);
  check('turning it on is saved', settings.get().startHwinfoWithApp === true);
  await click('#sStartHwinfo'); await sleep(300);
  check('turning it off is saved', settings.get().startHwinfoWithApp === false);
  // the start-with-the-app logic of main.js (runs through the demo steps; the real timer is not used in test mode)
  const autoRun = async (st) => { demo.state.hwinfo = st; return startHwinfoWithApp(); };
  check('auto-start: setting off -> nothing happens', (await autoRun({ installed: true, running: false })).skipped === 'off' && demo.state.hwinfo.running === false);
  settings.set({ startHwinfoWithApp: true });
  check('auto-start: not installed -> nothing happens', (await autoRun({ installed: false, running: false })).skipped === 'notInstalled');
  check('auto-start: INI without shared memory -> never edited, never started', (await autoRun({ installed: true, running: false, iniOff: true })).skipped === 'iniNoSharedMemory' && demo.state.hwinfo.running === false && demo.state.hwinfo.iniOff === true);
  check('auto-start: already running -> no second copy', (await autoRun({ installed: true, running: true })).skipped === 'running');
  const started = await autoRun({ installed: true, running: false });
  check('auto-start: installed, stopped, shared memory on -> started once, no INI consent passed', started.started === true && demo.state.hwinfo.running === true && demo.state.hwinfo.iniOff !== true, JSON.stringify(started));
  settings.set({ startHwinfoWithApp: false });
  demo.state.hwinfo = { installed: false, running: false };

  await setVal('sInterval', '45'); await sleep(300);
  check('interval: 45 minutes saved', settings.get().checkIntervalMin === 45);
  await setVal('sInterval', '2'); await sleep(300);
  check('interval: too small is raised to 5', settings.get().checkIntervalMin === 5, settings.get().checkIntervalMin);
  await setVal('sInstallDir', 'C:\\Tools\\MyThrottleStop'); await sleep(300);
  check('install folder is saved', settings.get().installDir === 'C:\\Tools\\MyThrottleStop');

  await click('#mReset'); await sleep(500);
  const s = settings.get();
  check('reset restores every default', s.startHwinfoWithApp === false && s.autoRecord === false && s.theme === 'system' && s.language === 'auto' && s.closeToTray === true && s.notifications === true && s.checkIntervalMin === 30 && s.installDir === '');
  check('reset refreshes the form', (await js(win, "document.getElementById('sInterval').value")) === '30');

  // after Reset the language is 'auto' = the OS language (Portuguese on a pt-BR PC); the checks below read English text
  await setVal('langSel', 'en'); await sleep(600);
  // Dashboard (demo): live tiles, hardware cards, optimization level, Apply recommended, and the "why are the tiles empty" notice
  const treads = () => js(win, 'KB.telemetryReads || 0');
  const tileTemp = () => js(win, "document.getElementById('tTemp').textContent");
  await click('[data-view=health]'); await waitFor("document.getElementById('tTemp').textContent.includes('°C')");
  check('Dashboard live tiles show real demo readings and when they were read', (await tileTemp()).includes('°C') && (await q('#tClock')).includes('GHz') && (await q('#tPower')).endsWith(' W') && (await visible('tilesWhen')) && (await q('#tilesWhen')).includes('Last read'), await q('#tilesWhen'));
  check('no notice while the readings work', !(await visible('tilesNotice')));
  await click('[data-view=insights]'); await waitFor("document.getElementById('insights') && !document.getElementById('insights').hidden");
  check('Insights offers the play session recorder', (await visible('sessCard')) && (await visible('sessStart')) && !(await visible('sessStop')));
  await click('#sessStart'); await waitFor("document.getElementById('sessSummary') && !document.getElementById('sessSummary').hidden");
  check('a recorded session shows duration, temperature, power and WHEA from real (demo) readings', (await q('#sessSummary')).includes('Duration') && (await q('#sessSummary')).includes('84 °C') && (await q('#sessSummary')).includes('WHEA'), await q('#sessSummary'));
  check('the summary says throttle flags are not measured instead of claiming none', (await q('#sessSummary')).includes('does not say whether the CPU throttled'));
  check('Insights offers the boost clock advice, empty until asked', (await visible('advCard')) && !(await visible('advVerdict')));
  await click('#advAnalyze'); await waitFor("!document.getElementById('advVerdict').hidden");
  check('the advice names the cap, the measured temperature, and never promises stability', (await q('#advVerdict')).includes('Keep 47x') && (await q('#advVerdict')).includes('90 °C') && !(await q('#advVerdict')).toLowerCase().includes('stable') && (await q('#advEvidence')).includes('4689 MHz'), await q('#advVerdict'));
  await click('[data-view=health]'); await sleep(400);
  const tt0 = await tileTemp(); let tt1 = tt0;
  await until(async () => (tt1 = await tileTemp()) !== tt0);
  check('the live tiles refresh by themselves', tt1 !== tt0, tt0 + ' -> ' + tt1 + ' | hidden=' + await js(win, 'document.hidden') + ' focus=' + await js(win, 'document.hasFocus()'));
  check('hardware cards: CPU, graphics, memory, storage, system', (await js(win, "document.querySelectorAll('.hw-card').length")) === 5 && (await q('.hw-card:nth-child(2)')).includes('RTX 4090') && (await q('.hw-card:nth-child(4)')).includes('NVMe') && (await q('.hw-card:nth-child(4)')).includes('1 TB'), await js(win, "[...document.querySelectorAll('.hw-card h3')].map((e) => e.textContent).join('|')"));
  check('no serial number on the hardware cards', !/serial/i.test(await js(win, "document.getElementById('hwCards').textContent")));
  await waitFor("/%$/.test(document.getElementById('levelPct').textContent)");
  const pct0 = await q('#levelPct');
  check('optimization level shows a percentage, "X of Y" and the formula', /^\d+%$/.test(pct0) && /\d+ of \d+ recommended tweaks active/.test(await q('#levelLine')) && (await q('#levelFormula')).includes('÷'), pct0 + ' | ' + await q('#levelLine'));
  check('Apply recommended is offered while some safe recommended tweaks are off', (await js(win, "document.getElementById('applyReco').disabled")) === false);
  await click('#applyReco'); await waitFor("document.getElementById('confirmDlg').open");
  const reco = await js(win, 'document.getElementById("cfBody").textContent');
  check('Apply recommended on the Dashboard asks first (same dialog), with one heading per tweak', (await js(win, 'document.getElementById("confirmDlg").open')) && (await js(win, 'document.querySelectorAll("#cfBody h4").length')) >= 3, await js(win, 'document.querySelectorAll("#cfBody h4").length'));
  check('the dialog shows the registry path, the value name, the current value ("not set" or a number) and the new value', /HK(CU|LM)\\[A-Za-z]+\\/.test(reco) && /\w+ \(DWord\): (not set|\d+) → \d+/.test(reco), reco.slice(0, 400));
  check('it says what turning off restores ("deleted again" or "set back to")', reco.includes('turning it off: the value is deleted again') || reco.includes('turning it off: set back to'));
  check('it says whether administrator rights and a restart are needed, per tweak', (reco.match(/Administrator rights: (needed|not needed)/g) || []).length >= 3 && reco.includes('Restart: not needed'));
  check('it says a restore point is tried first (one per 24 h) and that nothing is installed or deleted', reco.includes('restore point') && reco.includes('24 hours') && reco.includes('Nothing is installed and nothing is deleted'));
  check('it has a "you may notice" sentence for the tweaks and the technical lines are in a monospace block', reco.includes('You may notice:') && (await js(win, 'document.querySelectorAll("#cfBody pre.cf-mono").length')) >= 3 && (await js(win, 'getComputedStyle(document.querySelector("#cfBody pre.cf-mono")).fontFamily')).toLowerCase().includes('mono'));
  check('the body scrolls inside the dialog and the dialog stays on screen', (await js(win, '(()=>{const b=document.getElementById("cfBody"),d=document.getElementById("confirmDlg").getBoundingClientRect();return getComputedStyle(b).overflowY==="auto" && b.scrollHeight>b.clientHeight && d.top>=0 && d.bottom<=innerHeight})()')));
  await click('#cfCancel'); await sleep(400);
  check('cancelling changes nothing', (await q('#levelPct')) === pct0 && (await js(win, "document.getElementById('applyReco').disabled")) === false);
  await click('#applyReco'); await waitFor("document.getElementById('confirmDlg').open"); await click('#cfOk');
  await waitFor("document.getElementById('levelPct').textContent === '100%'");
  check('confirming applies them: level 100% and the button is off', (await q('#levelPct')) === '100%' && (await js(win, "document.getElementById('applyReco').disabled")) === true && (await visible('levelResult')), await q('#levelPct') + ' ' + await q('#levelResult'));
  // why the tiles are empty
  demo.state.telemetry = 'unavailable'; await js(win, 'KB.state.info.isAdmin = false; 0');
  await waitFor("!document.getElementById('tilesNotice').hidden");
  check('not elevated + no readings: the notice asks to run as administrator, with a restart button', (await visible('tilesNotice')) && (await q('#tilesNoticeText')).includes('as administrator') && (await visible('tilesRestart')) && (await q('#tTemp')) === '–' && !(await visible('tilesWhen')), await q('#tilesNoticeText'));
  await js(win, 'KB.state.info.isAdmin = true; 0');
  await waitFor("document.getElementById('tilesNoticeText').textContent.includes('HWiNFO card')");
  check('elevated + no readings: the notice points to the HWiNFO card instead, no restart button', (await q('#tilesNoticeText')).includes('HWiNFO card') && !(await visible('tilesRestart')), await q('#tilesNoticeText'));
  // elevated + no readings, HWiNFO installed: the notice says what is wrong in words and offers the one-click start
  const hwNow = async (st) => { demo.state.hwinfo = st; await js(win, 'KB.hwinfoRefresh(); 0'); };
  const noticeIs = (part) => waitFor("document.getElementById('tilesNoticeText').textContent.includes(" + JSON.stringify(part) + ")");
  await hwNow({ installed: true, running: false });
  await noticeIs('installed on this PC but not running');
  check('HWiNFO installed but not running: the notice says so and offers Start HWiNFO', (await visible('tilesStart')) && (await q('#tilesStart')) === 'Start HWiNFO' && !(await visible('tilesIniRow')) && (await js(win, "document.getElementById('tilesStart').disabled")) === false && !(await visible('tilesRestart')), await q('#tilesNoticeText'));
  await hwNow({ installed: true, running: false, iniOff: true });
  await noticeIs('Shared Memory Support is off in its HWiNFO64.INI');
  check('its INI has shared memory off: an explicit consent box, Start disabled until ticked', (await visible('tilesIniRow')) && (await q('#tilesIniRow')).includes('backup') && (await js(win, "document.getElementById('tilesStart').disabled")) === true && (await js(win, "document.getElementById('tilesIniBox').checked")) === false, await q('#tilesNoticeText'));
  await click('#tilesIniBox');
  await waitFor("!document.getElementById('tilesStart').disabled");
  check('ticking the consent box enables Start', (await js(win, "document.getElementById('tilesStart').disabled")) === false);
  await click('#tilesStart');
  await waitFor("document.getElementById('tilesStartResult') && !document.getElementById('tilesStartResult').hidden");
  check('Start from the notice runs the same step with the INI consent: HWiNFO runs, the INI is on, the result is shown', demo.state.hwinfo.running === true && demo.state.hwinfo.iniOff === false && (await q('#tilesStartResult')).includes('started'), await q('#tilesStartResult'));
  await waitFor("!document.getElementById('tilesStart') || document.getElementById('tilesStart').hidden");
  check('once HWiNFO runs the Start button is gone (no second copy is offered)', !(await visible('tilesStart')) && !(await visible('tilesIniRow')) && (await js(win, "document.getElementById('tilesIniBox').checked")) === false);
  await hwNow({ installed: true, running: true, noSm: true });
  await noticeIs('Shared Memory Support is off in its settings');
  check('HWiNFO running without shared memory: explanation, nothing to start', !(await visible('tilesStart')) && (await q('#tilesNoticeText')).includes('is running'), await q('#tilesNoticeText'));
  demo.state.hwinfo = { installed: false, running: false };
  demo.state.telemetry = 'live';
  await waitFor("document.getElementById('tilesNotice').hidden && document.getElementById('tTemp').textContent.includes('°C')");
  check('readings come back: notice gone, values back', !(await visible('tilesNotice')) && (await tileTemp()).includes('°C'));
  await click('[data-view=settings]'); await sleep(300);
  await sleep(600);                                                      // a read that was already in flight may still land
  const dashPoll = await js(win, 'window.KBDash.REFRESH_MS');
  const tr0 = await treads(); await sleep(2 * dashPoll + 1000);          // spans at least two poll periods
  check('leaving the Dashboard stops the live readings', (await treads()) === tr0, tr0 + ' -> ' + await treads());
  await click('[data-view=health]');
  await until(async () => (await treads()) > tr0);
  check('coming back to the Dashboard reads again', (await treads()) > tr0, tr0 + ' -> ' + await treads());

  await click('[data-view=optimizations]'); await sleep(500);
  check('Optimizations shows the CPU tuning card', await visible('optimizations') && (await q('#optThrottle h3')) === 'CPU thermal tuning');
  // tweak catalog (demo data = the real catalog)
  const count = (sel) => js(win, `document.querySelectorAll(${JSON.stringify(sel)}).length`);
  const isOn = (id) => js(win, `document.querySelector('.tweak[data-id="${id}"] input').checked`);
  const input = (id, v) => js(win, `(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  check('tweak catalog shows all 31 cards', (await count('.tweak')) === 31, await count('.tweak'));
  check('category chips exist (all + 7)', (await count('#tweakChips .chip-btn')) === 8, await count('#tweakChips .chip-btn'));
  await click('#tweakChips [data-cat=privacy]'); await sleep(200);
  check('a category chip filters the cards', (await count('.tweak')) === 6, await count('.tweak'));
  await click('#tweakChips [data-cat=all]'); await input('tweakSearch', 'mouse'); await sleep(200);
  check('search filters by title or description', (await count('.tweak')) >= 1 && (await count('.tweak')) < 5, await count('.tweak'));
  await input('tweakSearch', 'zzzz-nothing'); await sleep(200);
  check('search with no match shows the empty message', (await count('.tweak')) === 0 && (await q('#tweakSummary')).length > 0);
  await input('tweakSearch', ''); await sleep(200);
  const before = await isOn('transparency-off');
  await js(win, "document.querySelector('.tweak[data-id=\"transparency-off\"] input').click(); 0"); await sleep(900);
  check('a safe tweak toggles at once (no confirmation)', (await isOn('transparency-off')) === !before && !(await js(win, 'document.getElementById("confirmDlg").open')));
  await js(win, "document.querySelector('.tweak[data-id=\"sysmain-off\"] input').click(); 0"); await waitFor("document.getElementById('confirmDlg').open");
  check('an advanced tweak asks first', await js(win, 'document.getElementById("confirmDlg").open'));
  check('the advanced tweak dialog also shows the exact change (service start type) and what turning off restores', (await q('#cfBody')).includes('Service SysMain: start type Auto → Disabled') && (await q('#cfBody')).includes('turning it off: start type set back to Auto'), await q('#cfBody'));
  await click('#cfCancel'); await sleep(300);
  check('cancelling leaves the advanced tweak off', (await isOn('sysmain-off')) === false);
  await js(win, "document.querySelector('.tweak[data-id=\"defender-realtime-off\"] input').click(); 0"); await waitFor("document.getElementById('confirmDlg').open");
  check('the risky tweak dialog shows Defender now -> off and the existing warnings', (await q('#cfBody')).includes('real-time protection: on → off') && (await q('#cfBody')).includes('lowers your PC'), await q('#cfBody'));
  await click('#cfOk'); await waitFor("document.getElementById('cfTitle').textContent === 'Final confirmation'");
  check('a risky tweak asks a second, final time', (await js(win, 'document.getElementById("confirmDlg").open')) && (await q('#cfTitle')).length > 0 && (await js(win, 'document.getElementById("cfTitle").textContent')) === 'Final confirmation', await q('#cfTitle'));
  await click('#cfCancel'); await sleep(300);
  check('stopping at the second risky confirmation changes nothing', (await isOn('defender-realtime-off')) === false);
  await js(win, "document.querySelector('.tweak[data-id=\"defender-realtime-off\"] input').click(); 0"); await waitFor("document.getElementById('confirmDlg').open");
  await click('#cfOk'); await waitFor("document.getElementById('cfTitle').textContent === 'Final confirmation'"); await click('#cfOk'); await sleep(1200);
  check('a risky tweak applies after both confirmations', (await isOn('defender-realtime-off')) === true);
  await js(win, "document.querySelector('.tweak[data-id=\"defender-realtime-off\"] input').click(); 0"); await sleep(900);
  check('a risky tweak reverts without confirmation', (await isOn('defender-realtime-off')) === false);
  await click('#tweakRecommended'); await sleep(300);
  const recoOpen = await waitFor("document.getElementById('confirmDlg').open || document.getElementById('tweakResult').textContent.length > 0", 6000);
  if (await js(win, 'document.getElementById("confirmDlg").open')) { await click('#cfOk'); await sleep(900); }
  void recoOpen;
  check('after Apply recommended the safe recommended ones are on', await js(win, "['fast-startup-off','background-apps-off','game-dvr-off','mouse-accel-off','advertising-id-off'].every(id => document.querySelector('.tweak[data-id=' + id + '] input').checked)"));

  // restore points
  await click('[data-view=restore]'); await sleep(900);
  check('restore lists the 2 demo points', (await js(win, "document.querySelectorAll('.rp-row').length")) === 2);
  await click('#rpCreate'); await sleep(900);
  check('creating a restore point shows it first and says so', (await js(win, "document.querySelectorAll('.rp-row').length")) === 3 && (await js(win, "document.getElementById('rpResult').hidden")) === false);

  // last result at once + shimmer, then the fresh result (the cache is a per-viewer convenience in localStorage)
  const cachedNow = await js(win, "(()=>{ KB.lastSet('restore', { admin: true, points: [{ id: 999, description: 'cached point', created: '2026-01-01T10:00:00', type: 'settings' }] }); KB.showView('restore'); const l = document.getElementById('rpList'); return l.textContent.includes('cached point') && l.classList.contains('refreshing') && l.getAttribute('aria-busy') === 'true'; })()");
  check('Restore shows the last list at once, with the shimmer on', cachedNow === true);
  await sleep(1000);
  check('then the fresh list replaces it and the shimmer stops', (await js(win, "(()=>{ const l = document.getElementById('rpList'); return !l.textContent.includes('cached point') && !l.classList.contains('refreshing') && document.querySelectorAll('.rp-row').length === 3; })()")) === true);
  const skeletonNow = await js(win, "(()=>{ KB.lastDrop('restore'); KB.showView('restore'); const n = document.querySelectorAll('#rpList .skel').length; return n; })()");
  check('with nothing cached, placeholder rows show while it loads', skeletonNow === 3, String(skeletonNow));
  await sleep(1000);
  check('the placeholders are replaced by the real list', (await js(win, "document.querySelectorAll('#rpList .skel').length")) === 0 && (await js(win, "document.querySelectorAll('.rp-row').length")) === 3);
  check('the last answers are stored for the next start (Restore, hardware, tweaks)', (await js(win, "!!KB.lastGet('restore') && !!KB.lastGet('tweaks')")) === true);

  // cleanup
  await click('[data-view=cleanup]'); await sleep(900);
  check('cleanup lists 6 targets', (await js(win, "document.querySelectorAll('.clean-row').length")) === 6);
  check('the Recycle Bin starts unticked, safe targets ticked', (await js(win, "document.querySelector('.clean-row[data-id=recycle-bin] input').checked")) === false && (await js(win, "document.querySelector('.clean-row[data-id=user-temp] input').checked")) === true);
  await click('#cleanRun'); await sleep(300);
  check('cleaning asks for confirmation first', await js(win, 'document.getElementById("confirmDlg").open'));
  await click('#cfCancel'); await sleep(200);
  check('cancelling cleans nothing', (await js(win, "document.querySelector('.clean-row[data-id=user-temp] .clean-size').textContent")).startsWith('4'));
  await js(win, "document.querySelector('.clean-row[data-id=recycle-bin] input').click(); 0"); await sleep(200);
  await click('#cleanRun'); await sleep(300); await click('#cfOk'); await sleep(300);
  check('the Recycle Bin needs a second confirmation', (await js(win, 'document.getElementById("confirmDlg").open')) && (await js(win, 'document.getElementById("cfTitle").textContent')) === 'Empty the Recycle Bin?', await q('#cfTitle'));
  await click('#cfOk'); await sleep(1500);
  check('cleaning reports what was freed', (await q('#cleanResult')).startsWith('Freed'), await q('#cleanResult'));
  check('last cleanup time is saved', !!settings.get().lastCleanup);
  check('sizes read zero after cleaning', (await js(win, "document.querySelector('.clean-row[data-id=user-temp] .clean-size').textContent")).startsWith('0'));

  // Counter-Strike 2 preset (demo: nothing is read from Steam and nothing is written; the same codes as scripts/lib/Cs2.ps1)
  const ckey = require('electron').clipboard;
  const num = (id, v) => js(win, `(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  const dis = (id) => js(win, `document.getElementById(${JSON.stringify(id)}).disabled`);
  const ccount = (sel) => js(win, `document.querySelectorAll(${JSON.stringify(sel)}).length`);
  demo.resetCs2(); await click('[data-view=optimizations]'); await sleep(400);
  check('Optimizations has the Counter-Strike 2 card next to the CPU tuning', (await q('#optCs2 h3')) === 'Counter-Strike 2' && (await q('#optCs2 .muted')).includes('No promises'), await q('#optCs2 .muted'));
  await click('#openCs2'); await sleep(900);
  check('the card opens the Counter-Strike 2 page, and Optimizations stays the active menu item', await visible('cs2') && !(await visible('optimizations')) && (await js(win, "document.querySelector('.nav-btn.active').dataset.view")) === 'optimizations');
  check('the page says in plain words what it does not promise (FPS, anti-cheat not tested, Steam files untouched)', (await q('#cs2 .changes')).includes('Nothing here promises more FPS') && (await q('#cs2 .changes')).includes('did not test how VAC') && (await q('#cs2 .changes')).includes('never edits Steam'), await q('#cs2 .changes'));
  check('the game is found through Steam and its exe path is shown', (await q('#cs2Loc')).includes('Found through Steam') && (await q('#cs2Exe')).endsWith('cs2.exe') && !(await visible('cs2Forget')), await q('#cs2Loc'));
  check('GPU: not set yet, apply is offered and revert is not', (await q('#cs2GpuStatus')) === 'Not set' && !(await dis('cs2GpuApply')) && (await dis('cs2GpuRevert')), await q('#cs2GpuStatus'));
  await click('#cs2GpuApply'); await sleep(1300);
  check('GPU: applying shows it as set by KafkaBoost and flips the buttons', (await q('#cs2GpuStatus')).includes('set by KafkaBoost') && (await dis('cs2GpuApply')) && !(await dis('cs2GpuRevert')) && (await visible('cs2GpuResult')), await q('#cs2GpuStatus'));
  await click('#cs2GpuRevert'); await sleep(1300);
  check('GPU: reverting puts the status back to Not set', (await q('#cs2GpuStatus')) === 'Not set' && !(await dis('cs2GpuApply')) && (await dis('cs2GpuRevert')), await q('#cs2GpuStatus'));
  check('autoexec: an existing user file is recognised, nothing is ticked, writing and restoring are off', (await q('#cs2CfgStatus')) === 'Your own file is there' && (await dis('cs2CfgWrite')) && (await dis('cs2CfgRestore')) && (await ccount('#cs2CfgList .clean-row')) === 2, await q('#cs2CfgStatus'));
  await click('#cs2CfgList [data-id=showfps] input'); await sleep(150);
  check('autoexec: ticking a line enables Write', !(await dis('cs2CfgWrite')));
  await click('#cs2CfgList [data-id=fpsmax] input'); await sleep(150);
  check('autoexec: the frame limit needs a valid number first', (await dis('cs2CfgWrite')));
  await num('cs2Fps', '5'); await sleep(100);
  check('autoexec: a number outside the allowed range keeps Write off', (await dis('cs2CfgWrite')));
  await num('cs2Fps', '144'); await sleep(100);
  check('autoexec: a valid number enables Write and shows in the line', !(await dis('cs2CfgWrite')) && (await q('#cs2CfgList [data-id=fpsmax] code')) === 'fps_max 144', await q('#cs2CfgList [data-id=fpsmax] code'));
  await click('#cs2CfgWrite'); await sleep(400);
  check('autoexec: Write asks first, lists the lines and says the old file is backed up', (await js(win, 'document.getElementById("confirmDlg").open')) && (await q('#cfBody')).includes('cl_showfps 1') && (await q('#cfBody')).includes('fps_max 144') && (await q('#cfBody')).includes('copied to autoexec.cfg.bak_') && (await q('#cfBody')).includes('exec autoexec'), await q('#cfBody'));
  await click('#cfCancel'); await sleep(300);
  check('autoexec: cancelling writes nothing', (await q('#cs2CfgStatus')) === 'Your own file is there' && !demo.state.cs2.ours);
  await click('#cs2CfgWrite'); await sleep(300); await click('#cfOk'); await sleep(1500);
  check('autoexec: confirming writes it, names the backup and flips to "Written by KafkaBoost"', (await q('#cs2CfgResult')).includes('autoexec.cfg.bak_') && (await q('#cs2CfgStatus')) === 'Written by KafkaBoost' && !(await dis('cs2CfgRestore')), await q('#cs2CfgResult'));
  await click('#cs2CfgRestore'); await sleep(300);
  check('autoexec: Restore asks first and explains that an edited file is never touched', (await js(win, 'document.getElementById("confirmDlg").open')) && (await q('#cfBody')).includes('is never touched'), await q('#cfBody'));
  await click('#cfOk'); await sleep(1500);
  check('autoexec: restoring puts the user file back (status Your own file, restore off)', (await q('#cs2CfgResult')).includes('previous autoexec.cfg was put back') && (await q('#cs2CfgStatus')) === 'Your own file is there' && (await dis('cs2CfgRestore')), await q('#cs2CfgResult'));
  check('launch options: only +exec autoexec is ticked at first, and that is the whole string', (await js(win, "document.getElementById('cs2LaunchStr').value")) === '+exec autoexec' && (await ccount('#cs2LaunchList .clean-row')) === 6);
  check('launch options: the disputed and placebo ones say so', (await js(win, "[...document.querySelectorAll('#cs2LaunchList .chip')].map(c => c.textContent).join(',')")) === 'Suggested,Suggested,Disputed,Disputed,Placebo,Placebo');
  await click('#cs2LaunchList [data-id=console] input'); await sleep(150);
  check('launch options: ticking adds the option to the string', (await js(win, "document.getElementById('cs2LaunchStr').value")) === '+exec autoexec -console');
  await foreground();                                                    // navigator.clipboard.writeText needs a focused document
  // Is the OS clipboard usable from this session at all? (a locked-down or non-interactive desktop session accepts writes and reads back
  // nothing, for every program). Only then can the content be compared; the app's own report is still checked either way.
  await ckey.writeText('kb-probe');
  const clipWorks = !!(await until(async () => (await ckey.readText()) === 'kb-probe', 2000));
  await click('#cs2Copy');
  await until(() => visible('cs2CopyResult'));                           // the app reports only after its write finished: read the clipboard after that
  if (clipWorks) await until(async () => (await ckey.readText()) === '+exec autoexec -console', 5000);
  const clipNow = clipWorks ? await ckey.readText() : '(clipboard not usable in this session: content not compared)';
  check('launch options: Copy reports success and the clipboard holds the string', (await visible('cs2CopyResult')) && (await q('#cs2CopyResult')).startsWith('Copied') && (!clipWorks || clipNow === '+exec autoexec -console'), (await q('#cs2CopyResult')) + ' | ' + clipNow + ' | focused: ' + await js(win, 'document.hasFocus()'));
  await click('#cs2LaunchList [data-id=exec] input'); await click('#cs2LaunchList [data-id=console] input'); await sleep(150);
  check('launch options: with nothing ticked the string is empty and Copy is off', (await js(win, "document.getElementById('cs2LaunchStr').value")) === '' && (await dis('cs2Copy')));
  // Steam did not reveal the game: the page says so, hides the two parts that need it, keeps the launch options, and lets the user pick cs2.exe
  demo.state.cs2.found = false; await click('#cs2Rescan'); await sleep(900);
  check('not found: says so, GPU and autoexec are hidden, launch options stay', (await q('#cs2Loc')).includes('not found through Steam') && !(await visible('cs2Gpu')) && !(await visible('cs2Cfg')) && (await visible('cs2Launch')), await q('#cs2Loc'));
  await click('#cs2Pick'); await sleep(1500);
  check('picking cs2.exe saves it and shows the parts again, marked as chosen by the user', settings.get().cs2Exe === demo.CS2_DEMO_EXE && (await visible('cs2Gpu')) && (await q('#cs2Loc')).includes('you chose') && (await visible('cs2Forget')), settings.get().cs2Exe);
  await click('#cs2Forget'); await sleep(1000);
  check('"Use the location from Steam" forgets the pick', settings.get().cs2Exe === '' && !(await visible('cs2Gpu')));
  demo.resetCs2();
  await click('#backFromCs2'); await sleep(400);
  check('Back returns to Optimizations', await visible('optimizations') && !(await visible('cs2')));

  // Memory page (demo: three canned readings; the real step reads the Windows counters every 2 s while the page is open)
  await click('[data-view=memory]'); await sleep(1500);
  check('the Memory page opens from its own side-menu item', await visible('memory') && (await js(win, "document.querySelector('.nav-btn.active').dataset.view")) === 'memory');
  check('it shows six counters with real units and the installed memory (32.0 GB)', (await ccount('#memCards .memcard')) === 6 && (await q('#memCards')).includes('32.0 GB') && (await q('#memCards')).includes('GB'), await q('#memCards'));
  check('the stacked bar has the four segments and its legend', (await ccount('#memBar .memseg')) === 4 && (await ccount('#memLegend .memlegend-item')) === 4);
  check('it says Standby is droppable cache and that a missing counter is a dash', (await q('#memory .muted')).length > 0 && (await q('#memory')).includes('dash'), '');
  await click('#memOpenRammap'); await sleep(900);
  check('the button opens the Memory cleanup (RAMMap) page', await visible('rammap') && !(await visible('memory')));
  await click('[data-view=optimizations]'); await sleep(500);

  // Memory cleanup with RAMMap (demo: nothing is downloaded or run; canned memory counters)
  check('Optimizations has the Memory cleanup (RAMMap) card', (await q('#optRammap h3')).includes('RAMMap'), await q('#optRammap h3'));
  await click('#openRammap'); await sleep(1200);
  check('the card opens the RAMMap page, and Optimizations stays the active menu item', await visible('rammap') && !(await visible('optimizations')) && (await js(win, "document.querySelector('.nav-btn.active').dataset.view")) === 'optimizations');
  check('the page says it promises no FPS gain and that dropping the standby list can stutter', (await q('#rammap .changes')).includes('do not promise more FPS') && (await q('#rammap .changes')).includes('stutter'), await q('#rammap .changes'));
  check('RAMMap is missing: the download card shows and the actions card does not', await visible('rammapGet') && !(await visible('rammapActionsCard')) && (await q('#rammapStatus')) === 'Not installed', await q('#rammapStatus'));
  check('the live counters are listed (installed 32.0 GB, standby 13.6 GB)', (await q('#rammapMem')).includes('32.0 GB') && (await q('#rammapMem')).includes('13.6 GB'), await q('#rammapMem'));
  check('download stays disabled until the box is ticked', await dis('rammapDownload'));
  await click('#rammapAgree'); await sleep(200);
  check('ticking the box enables the download', !(await dis('rammapDownload')));
  await click('#rammapDownload'); await sleep(1500);
  check('after the demo install the actions card shows five actions, each with a Run button', !(await visible('rammapGet')) && await visible('rammapActionsCard') && (await ccount('#rammapActions .rammap-row')) === 5 && (await q('#rammapStatus')) === 'Ready', await q('#rammapStatus'));
  await js(win, "document.querySelectorAll('#rammapActions .rammap-row .btn')[4].click()"); await sleep(500);
  check('running an advanced action asks first, and says it promises no gain', (await js(win, "document.getElementById('confirmDlg').open")) && (await q('#cfBody')).includes('does not promise a performance gain'), await q('#cfBody'));
  await click('#cfOk'); await sleep(1800);
  check('the result shows what the counters did, and the history records the run', (await q('#rammapResult')).includes('standby -13.6 GB') && await visible('rammapHistoryCard') && (await q('#rammapTotals')).includes('1 run'), await q('#rammapResult'));
  await click('#backFromRammap'); await sleep(400);
  check('Back returns to Optimizations from RAMMap', await visible('optimizations') && !(await visible('rammap')));

  // HWiNFO on demand (Dashboard card; demo: nothing is downloaded or started)
  await click('[data-view=health]'); await sleep(1500);
  check('Dashboard has the live telemetry source card, HWiNFO not installed', await visible('hwCard') && (await q('#hwStatus')).includes('not on this PC'), await q('#hwStatus'));
  check('only "Check what will be downloaded" is offered at first', await visible('hwCheck') && !(await visible('hwGet')) && !(await visible('hwGetBtn')) && !(await visible('hwStart')) && !(await visible('hwStop')));
  await click('#hwCheck'); await sleep(900);
  check('checking shows the version, the official source and the expected signer', await visible('hwGet') && (await q('#hwRelease')).includes('8.54') && (await q('#hwRelease')).includes('https://www.hwinfo.com/files/hwi_854.zip') && (await q('#hwRelease')).includes('REALiX'), await q('#hwRelease'));
  check('the details say: signed by REALiX or deleted, admin-only folder, proprietary, not bundled', (await q('#hwDetails')).includes('REALiX') && (await q('#hwDetails')).includes('LegionTuning') && (await q('#hwDetails')).includes('proprietary') && (await q('#hwDetails')).includes('not part of KafkaBoost'), await q('#hwDetails'));
  check('Download stays disabled until the consent box is ticked', await visible('hwGetBtn') && (await js(win, "document.getElementById('hwGetBtn').disabled")) === true && (await q('#hwConsentText')).includes('8.54'));
  await click('#hwConsent'); await sleep(200);
  check('ticking the consent box enables Download', (await js(win, "document.getElementById('hwGetBtn').disabled")) === false);
  await click('#hwGetBtn'); await sleep(1300);
  check('after the install the card offers Start (no consent box left over)', await visible('hwStart') && !(await visible('hwGet')) && (await q('#hwResult')).includes('installed'), await q('#hwResult'));
  await click('#hwStart'); await sleep(900);
  check('Start turns into Stop and the status says the tiles are fed', await visible('hwStop') && !(await visible('hwStart')) && (await q('#hwStatus')).includes('sharing'), await q('#hwStatus'));
  await click('#hwStop'); await sleep(1200);
  check('Stop turns back into Start', await visible('hwStart') && !(await visible('hwStop')), await q('#hwStatus'));

  // sensors (demo: canned readings; support starts as not installed so the consent card can be exercised)
  const rows = (sel) => js(win, `document.querySelectorAll(${JSON.stringify(sel)}).length`);
  const reads = () => js(win, 'KB.sensorReads || 0');
  await click('[data-view=sensors]'); await sleep(1200);
  check('Sensors asks for consent before anything is downloaded', await visible('sensorsGet') && !(await visible('sensorsMain')) && (await js(win, "document.getElementById('sensorsGetBtn').disabled")) === true, await q('#sensorsGetWhat'));
  check('the consent text names the license, the fingerprint and the download folder', (await q('#sensorsGetWhat')).includes('MPL-2.0') && (await q('#sensorsGetDetails')).includes('SHA-256') && (await q('#sensorsGetDetails')).includes('LegionTuning'), await q('#sensorsGetDetails'));
  check('the intro says LatencyMon is still needed and the driver note names PawnIO', (await q('#sensors .page-head p')).includes('LatencyMon') && (await visible('sensorsDriver')) && (await q('#sensorsDriver p')).includes('PawnIO'));
  await click('#sensorsConsent'); await sleep(200);
  check('ticking the checkbox enables the download button', (await js(win, "document.getElementById('sensorsGetBtn').disabled")) === false);
  await click('#sensorsGetBtn'); await sleep(2600);
  check('after the download the live cards appear', await visible('sensorsMain') && !(await visible('sensorsGet')) && (await rows('.sensors-group')) === 5, await rows('.sensors-group'));
  check('sensors are grouped: CPU, graphics card, board, memory, disks', (await js(win, "[...document.querySelectorAll('.sensors-group')].map((e) => e.textContent).join('|')")) === 'CPU|Graphics card|Motherboard and fans|Memory|Disks');
  check('demo data is labelled as not from this PC', await visible('sensorsDemo'));
  const tempNow = () => js(win, "document.querySelector('.srow[data-type=Temperature] .sval').textContent");
  const t0 = await tempNow();
  check('temperatures show degrees and the min/max columns are filled', t0.includes('°C') && (await js(win, "document.querySelector('.srow[data-type=Temperature] .smin').textContent")).includes('°C'), t0);
  let t1 = t0;
  await until(async () => (t1 = await tempNow()) !== t0);   // demo values jitter; wait for any change
  check('the values refresh by themselves', t1 !== t0, t0 + ' -> ' + t1);
  check('a warm or hot temperature carries a word, not only a color', (await js(win, "[...document.querySelectorAll('.srow.t-warm .sval, .srow.t-hot .sval')].every((e) => /warm|hot/.test(e.textContent))")) === true);
  await click('#sensorsPause'); await sleep(300);
  await sleep(600);                                                      // a read that was already in flight may still land
  const sensPoll = await js(win, 'window.KBSensors.REFRESH_MS');
  const paused = await reads(); await sleep(2 * sensPoll + 1000);        // spans at least two poll periods
  check('Pause stops the readings', (await reads()) === paused && (await q('#sensorsPause')) === 'Resume', paused + ' -> ' + await reads());
  await click('#sensorsPause');
  await until(async () => (await reads()) > paused);
  check('Resume reads again', (await reads()) > paused, paused + ' -> ' + await reads());
  await foreground();
  await click('#sensorsCopy');
  await until(async () => (await q('#sensorsResult')).includes('copied'));
  check('Copy snapshot confirms', (await q('#sensorsResult')).includes('copied'), await q('#sensorsResult'));
  await click('#sensorsSave');
  await until(async () => (await q('#sensorsResult')).includes('kafkaboost-sensors.json'));
  check('Save snapshot confirms with a file name', (await q('#sensorsResult')).includes('kafkaboost-sensors.json'), await q('#sensorsResult'));
  await click('[data-view=settings]'); await sleep(600);
  const away = await reads(); await sleep(2 * sensPoll + 1000);
  check('leaving the Sensors screen stops the readings', (await reads()) === away, away + ' -> ' + await reads());
  await click('[data-view=sensors]');
  await until(async () => (await reads()) > away);
  check('coming back starts reading again', (await reads()) > away, away + ' -> ' + await reads());
  await click('[data-view=settings]'); await sleep(300);

  // apps manager (demo: a fake winget with 7 installed apps, 9 removable Store apps)
  const cardBtn = (id) => `document.querySelector('.app-card[data-id="${id}"] .btn')`;
  const cardChip = (id) => js(win, `document.querySelector('.app-card[data-id="${id}"] .chip').textContent`);
  await click('[data-view=apps]'); await sleep(1800);
  check('Apps lists the 21 catalog apps and names winget', (await js(win, "document.querySelectorAll('.app-card').length")) === 21 && (await q('#appsManager')).includes('winget'), await q('#appsManager'));
  check('Apps marks installed ones', (await cardChip('chrome')) === 'Installed' && (await cardChip('obs')) !== 'Installed');
  await click('#appsChips [data-cat=browsers]'); await sleep(200);
  check('an Apps category chip filters the cards', (await js(win, "document.querySelectorAll('.app-card').length")) === 3);
  await click('#appsChips [data-cat=all]'); await sleep(200);
  await js(win, `${cardBtn('obs')}.click(); 0`); await sleep(1800);
  check('installing an app updates its card and says so', (await cardChip('obs')) === 'Installed' && (await q('#appsResult')).includes('installed'), await q('#appsResult'));
  await js(win, `${cardBtn('vlc')}.click(); 0`); await sleep(300);
  check('removing an app asks for confirmation first', await js(win, 'document.getElementById("confirmDlg").open'));
  await click('#cfCancel'); await sleep(300);
  check('cancelling removes nothing', (await cardChip('vlc')) === 'Installed');
  await js(win, `${cardBtn('vlc')}.click(); 0`); await sleep(300); await click('#cfOk'); await sleep(1800);
  check('confirming removes the app', (await cardChip('vlc')) !== 'Installed');
  await js(win, "(()=>{const e=document.getElementById('appsSearch');e.value='obsid';document.getElementById('appsSearchBtn').click()})()"); await sleep(900);
  check('search shows results from the package manager', (await js(win, "document.querySelectorAll('#appsSearchOut .clean-row').length")) === 1);
  await js(win, "(()=>{const e=document.getElementById('appsSearch');e.value='';document.getElementById('appsSearchBtn').click()})()"); await sleep(300);
  await click('#appsImport'); await sleep(900);
  check('importing shows the list to confirm, without the malicious entry', (await js(win, 'document.getElementById("confirmDlg").open')) && (await js(win, 'document.getElementById("cfBody").textContent')).includes('Spotify') && !(await js(win, 'document.getElementById("cfBody").textContent')).includes('calc'), await q('#cfTitle'));
  await click('#cfCancel'); await sleep(300);
  check('cancelling the import installs nothing', (await cardChip('spotify')) !== 'Installed');
  await click('#appsImport'); await sleep(900); await click('#cfOk'); await sleep(3500);
  check('confirming the import installs the listed apps', (await cardChip('spotify')) === 'Installed' && (await cardChip('audacity')) === 'Installed', await q('#appsResult'));
  await click('#appsExport'); await sleep(600);
  check('export reports how many apps were saved', (await q('#appsResult')).startsWith('Saved'), await q('#appsResult'));
  check('Windows shows the bloatware list', await visible('bloatCard') && (await js(win, "document.querySelectorAll('#bloatList .clean-row').length")) === 9);
  await js(win, "document.querySelector('#bloatList .clean-row .btn').click(); 0"); await sleep(300);
  check('removing a Store app asks first', await js(win, 'document.getElementById("confirmDlg").open'));
  await click('#cfCancel'); await sleep(300);
  check('cancelling keeps all 9', (await js(win, "document.querySelectorAll('#bloatList .clean-row').length")) === 9);
  await js(win, "document.querySelector('#bloatList .clean-row .btn').click(); 0"); await sleep(300); await click('#cfOk'); await sleep(1800);
  check('confirming removes that one app only', (await js(win, "document.querySelectorAll('#bloatList .clean-row').length")) === 8);

  // ---- updates (demo: nothing is downloaded or installed; the flags in demo.state.update record what the UI asked for) ----
  const upd = () => demo.state.update;
  const panelText = () => js(win, "document.getElementById('updatePanel').textContent");
  const hasBtn = (id) => js(win, `!!document.getElementById('updatePanel-${id}')`);
  const checkNow = async (kind) => {
    demo.resetUpdate(kind); await click('[data-view=settings]'); await sleep(200);
    await js(win, "document.getElementById('updatePanel').hidden = true; document.getElementById('updatePanel').textContent = ''; 0");
    await click('#checkUpdate'); await waitFor("!document.getElementById('updatePanel').hidden && document.getElementById('updatePanel').textContent.length > 0");
  };
  const dlgOpen = () => js(win, "document.getElementById('confirmDlg').open");

  await checkNow('clone');
  check('Check for updates shows the new version with its Download and install button, version text first', (await panelText()).includes('Version 1.1.0 is available (you have 1.0.0)') && (await hasBtn('download')), await panelText());
  check('the Download button sits to the RIGHT of the version text, on the same row', await js(win, "(()=>{const t=document.querySelector('#updatePanel .upd-text').getBoundingClientRect(),b=document.getElementById('updatePanel-download').getBoundingClientRect();return b.left>=t.left+Math.min(t.width,100)&&b.top<t.bottom&&b.bottom>t.top&&b.left>t.left})()"));
  check('it says plainly why there is no automatic update, and how to update a clone', (await panelText()).includes('source folder') && (await panelText()).includes('Automatic updates only exist in the installed version') && (await panelText()).includes('git pull') && (await panelText()).includes('separate installed copy'), await panelText());
  check('there is no git pull button', !(await js(win, "[...document.querySelectorAll('#updatePanel button')].some((b) => /git/i.test(b.textContent))")));
  const bannerBtns = () => js(win, "[...document.querySelectorAll('#updateBanner button')].filter((b) => !b.hidden).map((b) => b.textContent.trim()).join(' | ')");
  check('the banner has exactly: Download and install, See what is new, Later (no download-page button)', (await visible('updateBanner')) && (await bannerBtns()) === 'Download and install | See what is new | Later', await bannerBtns());
  await click('#updatePanel-download');
  await waitFor("!!document.querySelector('#updatePanel progress.upd-bar') && !!document.getElementById('updatePanel-cancel')");
  check('while downloading: a progress bar, the percent and a Cancel button (nothing else to press)', (await panelText()).includes('Downloading the update') && !(await hasBtn('download')) && (await hasBtn('cancel')), await panelText());
  await click('#updatePanel-cancel'); await waitFor("document.getElementById('updatePanel').textContent.includes('Download cancelled')");
  check('Cancel stops it, says the partial file was deleted and installs nothing', (await panelText()).includes('partly downloaded file was deleted') && !upd().installerStarted && !(await dlgOpen()) && (await hasBtn('download')), await panelText());
  await click('#updatePanel-download'); await waitFor("document.getElementById('confirmDlg').open");
  const cbody = await q('#cfBody');
  check('after a verified download a confirmation is asked first: closes the window, admin permission, SmartScreen, clone is a separate copy', cbody.includes('closes this window') && cbody.includes('administrator permission') && cbody.includes('SmartScreen') && cbody.includes('separate installed copy') && (await q('#cfTitle')).includes('1.1.0') && !upd().installerStarted, cbody);
  await click('#cfCancel'); await waitFor("document.getElementById('updatePanel').textContent.includes('Nothing was installed')");
  check('declining installs nothing and says the downloaded file was deleted', !upd().installerStarted && (await panelText()).includes('downloaded file was deleted') && (await hasBtn('download')), await panelText());
  await click('#updatePanel-download'); await waitFor("document.getElementById('confirmDlg').open"); await click('#cfOk');
  await until(async () => upd().installerStarted);
  check('accepting starts the installer exactly once (a fake here) and says so', upd().installerStarted === true && (await panelText()).includes('Starting the installer') && upd().downloads === 3, 'downloads=' + upd().downloads);

  await checkNow('clone-mismatch'); await click('#updatePanel-download');
  await waitFor("document.getElementById('updatePanel').textContent.includes('does not match')");
  check('checksum mismatch: the file is deleted, an error is shown, no confirmation, nothing started', (await panelText()).includes('does not match the release') && (await panelText()).includes('deleted') && !(await dlgOpen()) && !upd().installerStarted && (await hasBtn('download')), await panelText());

  await checkNow('clone-nosums'); await click('#updatePanel-download');
  await waitFor("document.getElementById('updatePanel').textContent.includes('no usable checksum file')");
  check('no checksum file: says it could not verify, will not run it, offers the folder and the release page, no install button', (await panelText()).includes('KafkaBoost will not run it') && (await panelText()).includes('SmartScreen') && (await hasBtn('folder')) && (await hasBtn('release')) && !(await hasBtn('download')) && !(await dlgOpen()) && !upd().installerStarted, await panelText());
  await click('#updatePanel-folder'); await until(async () => upd().folderShown);
  check('Show in folder asks the app to reveal the file (still nothing started)', upd().folderShown === true && !upd().installerStarted);

  await checkNow('noinstaller');
  check('banner for a release without an installer: says so, only See what is new and Later', (await q('#updateBannerText')).includes('no installer file attached yet') && (await bannerBtns()) === 'See what is new | Later', await q('#updateBannerText') + ' / ' + await bannerBtns());
  check('release without an installer: no download button, the reason, the git pull hint and the release page', !(await hasBtn('download')) && (await hasBtn('release')) && (await panelText()).includes('no installer file attached yet') && (await panelText()).includes('git pull'), await panelText());

  await checkNow('installed');
  check('installed build: "Download the update", no explanation of why it cannot update', (await hasBtn('install')) && !(await hasBtn('download')) && !(await panelText()).includes('git pull'), await panelText());
  check('banner of the installed build: Update and restart, See what is new, Later', (await bannerBtns()) === 'Update and restart | See what is new | Later', await bannerBtns());
  await click('#updateBannerLater');
  check('Later hides the banner', !(await visible('updateBanner')));
  await click('#updatePanel-install'); await waitFor("!!document.getElementById('updatePanel-restart')");
  check('installed build: after the download the button becomes "Restart and update"', (await q('#updatePanel-restart')) === 'Restart and update' && (await panelText()).includes('downloaded and checked'), await panelText());
  await click('#updatePanel-restart'); await until(async () => upd().restarted);
  check('Restart and update asks the updater to restart (one path), nothing else is started', upd().restarted === true && !upd().installerStarted);
  demo.resetUpdate('clone');

  await click('#openThrottle'); await sleep(900);
  check('wizard opens on step 0', await visible('wizard') && (await q('#title')) === 'Detect your hardware', await q('#title'));
  check('Optimizations stays highlighted in the sidebar while in the wizard', (await js(win, "document.querySelector('.nav-btn.active').dataset.view")) === 'optimizations');

  // changelog dialog: notes render as text (a script tag in the notes must stay inert) and the buttons follow canInstall
  await js(win, `KB.updates.open({ current: '0.1.0', latest: '0.2.0', url: 'https://github.com/x/y/releases', canInstall: false, releases: [{ version: '0.2.0', date: '2026-10-12T00:00:00Z', notes: [{type:'h',text:'Added'},{type:'li',text:'Faster <b>check</b>'},{type:'p',text:'<img src=x onerror=window.__pwned=1>'}] }] }, 'available'); 0`);
  await sleep(300);
  check('changelog dialog opens with the version title', (await q('#clTitle')).includes('0.2.0'), await q('#clTitle'));
  check('changelog renders bullets and keeps HTML inert', (await js(win, "document.querySelectorAll('#clBody li').length")) === 1 && (await js(win, "document.querySelectorAll('#clBody img, #clBody b').length")) === 0 && !(await js(win, 'window.__pwned')));
  check('the dialog carries the same update panel: for a build without an installer only the release page button', (await js(win, "[...document.querySelectorAll('#clPanel button')].map((b) => b.dataset.act).join(',')")) === 'release' && !(await js(win, "document.getElementById('clPanel').hidden")));
  await click('#clLater'); await sleep(200);
  check('changelog closes', (await js(win, "document.getElementById('changelog').open")) === false);

  function finish() {
    fs.writeFileSync(outFile, JSON.stringify({ passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results }, null, 2));
  }
  finish();
}

module.exports = { run };
