'use strict';
// UI interaction test for WIZARD_UITEST=<result.json> (see app/src/main.js). Drives the real renderer in demo mode and records
// pass/fail per check. Run it with tools/run-uitest.ps1. Local only (needs a desktop session, so CI does not run it).
const fs = require('fs');

async function run({ win, js, sleep, settings, outFile, platform }) {
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
  await sleep(4200);
  check('the values refresh by themselves', (await tempNow()) !== t0, t0 + ' -> ' + (await tempNow()));
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
