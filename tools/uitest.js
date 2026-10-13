'use strict';
// UI interaction test for WIZARD_UITEST=<result.json> (see app/src/main.js). Drives the real renderer in demo mode and records
// pass/fail per check. Run it with tools/run-uitest.ps1. Local only (needs a desktop session, so CI does not run it).
const fs = require('fs');

async function run({ win, js, sleep, settings, demo, outFile, platform }) {
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  const q = (sel) => js(win, `(()=>{const e=document.querySelector(${JSON.stringify(sel)});return e?e.textContent.trim():null})()`);
  const visible = (id) => js(win, `(()=>{const e=document.getElementById(${JSON.stringify(id)});return !!e && !e.hidden})()`);
  const click = (sel) => js(win, `document.querySelector(${JSON.stringify(sel)}).click()`);
  const setVal = (id, v) => js(win, `(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await js(win, 'window.confirm = () => true; 0');                      // the Reset button asks first

  if (platform !== 'win32') {
    await click('[data-view=optimizations]'); await sleep(400);
    check('windows-only panel replaces Optimizations', await visible('windowsOnly') && !(await visible('optimizations')));
    check('windows-only panel names the OS', (await q('#windowsOnlyText')).includes('Linux') || (await q('#windowsOnlyText')).includes('macOS'), await q('#windowsOnlyText'));
    await click('[data-view=sensors]'); await sleep(400);
    check('windows-only panel replaces Sensors', await visible('windowsOnly') && !(await visible('sensors')));
    await js(win, "KB.showView('cs2')"); await sleep(300);
    check('the Counter-Strike 2 page is Windows only too', await visible('windowsOnly') && !(await visible('cs2')));
    await click('[data-view=settings]'); await sleep(400);
    check('Settings still works on this OS', await visible('settings'));
    check('Windows-only settings are hidden', !(await visible('thermalCard')));
    await click('[data-view=apps]'); await sleep(1500);
    const cnt = (sel) => js(win, `document.querySelectorAll(${JSON.stringify(sel)}).length`);
    check('Apps works on this OS (no Windows-only panel)', await visible('apps') && !(await visible('windowsOnly')));
    check('Apps names the active package manager', (await q('#appsManager')).includes('Flatpak'), await q('#appsManager'));
    check('Apps offers only the apps with a verified Flatpak id', (await cnt('.app-card')) === 15, await cnt('.app-card'));
    check('the Windows bloatware remover is hidden on Linux', !(await visible('bloatCard')));
    await click('[data-view=health]'); await sleep(400);
    check('Dashboard shows basic system info', (await q('#heroTitle')).length > 0, await q('#heroTitle'));
    check('Dashboard hardware cards: CPU, memory, system (no live tiles, no level)', (await js(win, "document.querySelectorAll('.hw-card').length")) === 3 && !(await visible('tiles')) && !(await visible('optLevel')) && !(await visible('tilesNotice')));
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

  await setVal('sInterval', '45'); await sleep(300);
  check('interval: 45 minutes saved', settings.get().checkIntervalMin === 45);
  await setVal('sInterval', '2'); await sleep(300);
  check('interval: too small is raised to 5', settings.get().checkIntervalMin === 5, settings.get().checkIntervalMin);
  await setVal('sInstallDir', 'C:\\Tools\\MyThrottleStop'); await sleep(300);
  check('install folder is saved', settings.get().installDir === 'C:\\Tools\\MyThrottleStop');

  await click('#mReset'); await sleep(500);
  const s = settings.get();
  check('reset restores every default', s.theme === 'system' && s.language === 'auto' && s.closeToTray === true && s.notifications === true && s.checkIntervalMin === 30 && s.installDir === '');
  check('reset refreshes the form', (await js(win, "document.getElementById('sInterval').value")) === '30');

  // after Reset the language is 'auto' = the OS language (Portuguese on a pt-BR PC); the checks below read English text
  await setVal('langSel', 'en'); await sleep(600);
  // Dashboard (demo): live tiles, hardware cards, optimization level, Apply recommended, and the "why are the tiles empty" notice
  const wasMin0 = win.isMinimized(); if (wasMin0) { win.restore(); await sleep(600); }   // a minimized page is hidden, and a hidden page does not poll
  const treads = () => js(win, 'KB.telemetryReads || 0');
  const tileTemp = () => js(win, "document.getElementById('tTemp').textContent");
  const waitFor = async (expr, ms = 8000) => { for (let i = 0; i < ms / 200 && !(await js(win, expr)); i++) await sleep(200); return js(win, expr); };
  await click('[data-view=health]'); await waitFor("document.getElementById('tTemp').textContent.includes('°C')");
  check('Dashboard live tiles show real demo readings and when they were read', (await tileTemp()).includes('°C') && (await q('#tClock')).includes('GHz') && (await q('#tPower')).endsWith(' W') && (await visible('tilesWhen')) && (await q('#tilesWhen')).includes('Last read'), await q('#tilesWhen'));
  check('no notice while the readings work', !(await visible('tilesNotice')));
  const tt0 = await tileTemp(); let tt1 = tt0;
  for (let i = 0; i < 30 && tt1 === tt0; i++) { await sleep(300); tt1 = await tileTemp(); }
  check('the live tiles refresh by themselves', tt1 !== tt0, tt0 + ' -> ' + tt1);
  check('hardware cards: CPU, graphics, memory, storage, system', (await js(win, "document.querySelectorAll('.hw-card').length")) === 5 && (await q('.hw-card:nth-child(2)')).includes('RTX 4090') && (await q('.hw-card:nth-child(4)')).includes('NVMe') && (await q('.hw-card:nth-child(4)')).includes('1 TB'), await js(win, "[...document.querySelectorAll('.hw-card h3')].map((e) => e.textContent).join('|')"));
  check('no serial number on the hardware cards', !/serial/i.test(await js(win, "document.getElementById('hwCards').textContent")));
  await waitFor("/%$/.test(document.getElementById('levelPct').textContent)");
  const pct0 = await q('#levelPct');
  check('optimization level shows a percentage, "X of Y" and the formula', /^\d+%$/.test(pct0) && /\d+ of \d+ recommended tweaks active/.test(await q('#levelLine')) && (await q('#levelFormula')).includes('÷'), pct0 + ' | ' + await q('#levelLine'));
  check('Apply recommended is offered while some safe recommended tweaks are off', (await js(win, "document.getElementById('applyReco').disabled")) === false);
  await click('#applyReco'); await sleep(300);
  check('Apply recommended on the Dashboard asks first (same dialog, lists the tweaks)', (await js(win, 'document.getElementById("confirmDlg").open')) && (await js(win, 'document.getElementById("cfBody").textContent')).includes('•'));
  await click('#cfCancel'); await sleep(400);
  check('cancelling changes nothing', (await q('#levelPct')) === pct0 && (await js(win, "document.getElementById('applyReco').disabled")) === false);
  await click('#applyReco'); await sleep(300); await click('#cfOk');
  await waitFor("document.getElementById('levelPct').textContent === '100%'");
  check('confirming applies them: level 100% and the button is off', (await q('#levelPct')) === '100%' && (await js(win, "document.getElementById('applyReco').disabled")) === true && (await visible('levelResult')), await q('#levelPct') + ' ' + await q('#levelResult'));
  // why the tiles are empty
  demo.state.telemetry = 'unavailable'; await js(win, 'KB.state.info.isAdmin = false; 0');
  await waitFor("!document.getElementById('tilesNotice').hidden");
  check('not elevated + no readings: the notice asks to run as administrator, with a restart button', (await visible('tilesNotice')) && (await q('#tilesNoticeText')).includes('as administrator') && (await visible('tilesRestart')) && (await q('#tTemp')) === '–' && !(await visible('tilesWhen')), await q('#tilesNoticeText'));
  await js(win, 'KB.state.info.isAdmin = true; 0');
  await waitFor("document.getElementById('tilesNoticeText').textContent.includes('HWiNFO card')");
  check('elevated + no readings: the notice points to the HWiNFO card instead, no restart button', (await q('#tilesNoticeText')).includes('HWiNFO card') && !(await visible('tilesRestart')), await q('#tilesNoticeText'));
  demo.state.telemetry = 'live';
  await waitFor("document.getElementById('tilesNotice').hidden && document.getElementById('tTemp').textContent.includes('°C')");
  check('readings come back: notice gone, values back', !(await visible('tilesNotice')) && (await tileTemp()).includes('°C'));
  await click('[data-view=settings]'); await sleep(300);
  const tr0 = await treads(); await sleep(3500);
  check('leaving the Dashboard stops the live readings', (await treads()) === tr0, tr0);
  await click('[data-view=health]'); await sleep(2800);
  check('coming back to the Dashboard reads again', (await treads()) > tr0);
  if (wasMin0) win.minimize();

  await click('[data-view=optimizations]'); await sleep(500);
  check('Optimizations shows the CPU tuning card', await visible('optimizations') && (await q('#optThrottle h3')) === 'CPU thermal tuning');
  // tweak catalog (demo data = the real catalog)
  const count = (sel) => js(win, `document.querySelectorAll(${JSON.stringify(sel)}).length`);
  const isOn = (id) => js(win, `document.querySelector('.tweak[data-id="${id}"] input').checked`);
  const input = (id, v) => js(win, `(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  check('tweak catalog shows all 30 cards', (await count('.tweak')) === 30, await count('.tweak'));
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
  await js(win, "document.querySelector('.tweak[data-id=\"sysmain-off\"] input').click(); 0"); await sleep(300);
  check('an advanced tweak asks first', await js(win, 'document.getElementById("confirmDlg").open'));
  await click('#cfCancel'); await sleep(300);
  check('cancelling leaves the advanced tweak off', (await isOn('sysmain-off')) === false);
  await js(win, "document.querySelector('.tweak[data-id=\"defender-realtime-off\"] input').click(); 0"); await sleep(300);
  await click('#cfOk'); await sleep(300);
  check('a risky tweak asks a second, final time', (await js(win, 'document.getElementById("confirmDlg").open')) && (await q('#cfTitle')).length > 0 && (await js(win, 'document.getElementById("cfTitle").textContent')) === 'Final confirmation', await q('#cfTitle'));
  await click('#cfCancel'); await sleep(300);
  check('stopping at the second risky confirmation changes nothing', (await isOn('defender-realtime-off')) === false);
  await js(win, "document.querySelector('.tweak[data-id=\"defender-realtime-off\"] input').click(); 0"); await sleep(300);
  await click('#cfOk'); await sleep(300); await click('#cfOk'); await sleep(1200);
  check('a risky tweak applies after both confirmations', (await isOn('defender-realtime-off')) === true);
  await js(win, "document.querySelector('.tweak[data-id=\"defender-realtime-off\"] input').click(); 0"); await sleep(900);
  check('a risky tweak reverts without confirmation', (await isOn('defender-realtime-off')) === false);
  await click('#tweakRecommended'); await sleep(300);
  const recoOpen = await js(win, 'document.getElementById("confirmDlg").open');
  if (recoOpen) { await click('#cfOk'); await sleep(900); }
  check('after Apply recommended the safe recommended ones are on', await js(win, "['fast-startup-off','background-apps-off','game-dvr-off','mouse-accel-off','advertising-id-off'].every(id => document.querySelector('.tweak[data-id=' + id + '] input').checked)"));

  // restore points
  await click('[data-view=restore]'); await sleep(900);
  check('restore lists the 2 demo points', (await js(win, "document.querySelectorAll('.rp-row').length")) === 2);
  await click('#rpCreate'); await sleep(900);
  check('creating a restore point shows it first and says so', (await js(win, "document.querySelectorAll('.rp-row').length")) === 3 && (await js(win, "document.getElementById('rpResult').hidden")) === false);

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
  await click('#cs2Copy'); await sleep(700);
  check('launch options: Copy reports success and the clipboard holds the string', (await visible('cs2CopyResult')) && (await q('#cs2CopyResult')).startsWith('Copied') && (await ckey.readText()) === '+exec autoexec -console', (await q('#cs2CopyResult')) + ' | ' + (await ckey.readText()));
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
  const wasMin = win.isMinimized(); if (wasMin) { win.restore(); await sleep(600); }   // a minimized page is hidden, and a hidden page does not poll
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
  for (let i = 0; i < 25 && t1 === t0; i++) { await sleep(400); t1 = await tempNow(); }   // demo values jitter; wait up to 10 s for any change
  check('the values refresh by themselves', t1 !== t0, t0 + ' -> ' + t1);
  check('a warm or hot temperature carries a word, not only a color', (await js(win, "[...document.querySelectorAll('.srow.t-warm .sval, .srow.t-hot .sval')].every((e) => /warm|hot/.test(e.textContent))")) === true);
  await click('#sensorsPause'); await sleep(300);
  const paused = await reads(); await sleep(3500);
  check('Pause stops the readings', (await reads()) === paused && (await q('#sensorsPause')) === 'Resume', paused);
  await click('#sensorsPause'); await sleep(2800);
  check('Resume reads again', (await reads()) > paused);
  await click('#sensorsCopy'); await sleep(500);
  check('Copy snapshot confirms', (await q('#sensorsResult')).includes('copied'), await q('#sensorsResult'));
  await click('#sensorsSave'); await sleep(500);
  check('Save snapshot confirms with a file name', (await q('#sensorsResult')).includes('kafkaboost-sensors.json'), await q('#sensorsResult'));
  await click('[data-view=settings]'); await sleep(400);
  const away = await reads(); await sleep(3500);
  check('leaving the Sensors screen stops the readings', (await reads()) === away, away);
  await click('[data-view=sensors]'); await sleep(2800);
  check('coming back starts reading again', (await reads()) > away);
  await click('[data-view=settings]'); await sleep(300);
  if (wasMin) win.minimize();

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

  await click('#openThrottle'); await sleep(900);
  check('wizard opens on step 0', await visible('wizard') && (await q('#title')) === 'Detect your hardware', await q('#title'));
  check('Optimizations stays highlighted in the sidebar while in the wizard', (await js(win, "document.querySelector('.nav-btn.active').dataset.view")) === 'optimizations');

  // changelog dialog: notes render as text (a script tag in the notes must stay inert) and the buttons follow canInstall
  await js(win, `KB.updates.open({ current: '0.1.0', latest: '0.2.0', url: 'https://github.com/x/y/releases', canInstall: false, releases: [{ version: '0.2.0', date: '2026-10-12T00:00:00Z', notes: [{type:'h',text:'Added'},{type:'li',text:'Faster <b>check</b>'},{type:'p',text:'<img src=x onerror=window.__pwned=1>'}] }] }, 'available'); 0`);
  await sleep(300);
  check('changelog dialog opens with the version title', (await q('#clTitle')).includes('0.2.0'), await q('#clTitle'));
  check('changelog renders bullets and keeps HTML inert', (await js(win, "document.querySelectorAll('#clBody li').length")) === 1 && (await js(win, "document.querySelectorAll('#clBody img, #clBody b').length")) === 0 && !(await js(win, 'window.__pwned')));
  check('install button hidden when the build cannot self-update', (await js(win, "document.getElementById('clInstall').hidden")) === true);
  await click('#clLater'); await sleep(200);
  check('changelog closes', (await js(win, "document.getElementById('changelog').open")) === false);

  function finish() {
    fs.writeFileSync(outFile, JSON.stringify({ passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results }, null, 2));
  }
  finish();
}

module.exports = { run };
