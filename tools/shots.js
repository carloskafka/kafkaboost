'use strict';
// Screenshot driver for WIZARD_SHOTS (see app/src/main.js and tools/make-shots.ps1). Walks every screen of the app in demo mode and writes
// one PNG per state into <dir>, once per theme and language. File names: <screen>[-light][-pt].png (default: dark + English).
const path = require('path');
const fs = require('fs');

// Theme/language variants to generate. The default set is what the docs use; SHOTS_VARIANTS=all adds light and pt-BR.
const VARIANTS = [
  { suffix: '', theme: 'dark', language: 'en' },
  { suffix: '-light', theme: 'light', language: 'en' },
  { suffix: '-pt', theme: 'dark', language: 'pt-BR' }
];

async function run({ win, dir, shot, js, sleep, demo, settings, PLATFORM }) {
  fs.mkdirSync(dir, { recursive: true });
  const click = (sel) => js(win, `document.querySelector(${JSON.stringify(sel)}).click()`);
  const waitIdle = async () => { for (let i = 0; i < 80; i++) { if (await js(win, "!document.getElementById('run').disabled && !document.getElementById('check').disabled")) return; await sleep(100); } };
  const wanted = process.env.SHOTS_VARIANTS === 'all' ? VARIANTS : VARIANTS.slice(0, 1);

  for (const v of wanted) {
    settings.set({ theme: v.theme, language: v.language });
    await sleep(900);
    const out = (name) => path.join(dir, `${name}${v.suffix}.png`);
    if (PLATFORM !== 'win32') { await click('[data-view=help]'); await sleep(300); await click('[data-view=optimizations]'); await sleep(500); await shot(win, out('windows-only')); continue; }

    demo.state.scenario = 'ok'; demo.state.fixed = false;
    demo.state.hwinfo = { installed: false, running: false };
    const until = async (expr) => { for (let i = 0; i < 60 && !(await js(win, expr)); i++) await sleep(100); };
    const top = "document.getElementById('hero').scrollIntoView({ block: 'start' }); 0";
    await click('[data-view=health]'); await until("!document.getElementById('hwCard').hidden && !document.getElementById('hwCheck').hidden"); await sleep(900);
    await click('#hwCheck'); await until("!document.getElementById('hwGet').hidden"); await sleep(300);
    await js(win, "document.getElementById('hwCard').scrollIntoView({ block: 'center' }); 0"); await sleep(300); await shot(win, out('hwinfo-consent'));
    await click('#hwConsent'); await sleep(200); await click('#hwGetBtn'); await until("!document.getElementById('hwStart').hidden"); await sleep(300);
    await click('#hwStart'); await until("!document.getElementById('hwStop').hidden"); await sleep(300);
    await js(win, top); await click('#check'); await sleep(1000);
    await until("document.getElementById('tTemp').textContent.includes('°C') && /%$/.test(document.getElementById('levelPct').textContent) && document.querySelectorAll('.hw-card').length === 5"); await sleep(300);
    await shot(win, out('health-ok'));
    // the tiles cannot be read and the app is not elevated: the notice asks for administrator rights
    demo.state.telemetry = 'unavailable'; await js(win, 'KB.state.info.isAdmin = false; 0');
    await until("!document.getElementById('tilesNotice').hidden"); await sleep(300); await shot(win, out('health-no-admin'));
    // elevated, HWiNFO installed but not running: the notice says so and offers a one-click start
    demo.state.hwinfo = { installed: true, running: false }; await js(win, 'KB.state.info.isAdmin = true; KB.hwinfoRefresh(); 0');
    await until("!document.getElementById('tilesStart').hidden"); await sleep(300); await shot(win, out('health-start-hwinfo'));
    demo.state.hwinfo = { installed: true, running: true }; demo.state.telemetry = 'live'; await js(win, 'KB.hwinfoRefresh(); 0');
    await until("document.getElementById('tilesNotice').hidden"); await sleep(300);
    demo.state.scenario = 'updated'; demo.state.fixed = false;
    await click('#check'); await sleep(900); await shot(win, out('health-attention'));
    await click('#fix'); await sleep(1300); await shot(win, out('health-fixed'));
    await click('[data-view=analysis]'); await sleep(1300); await shot(win, out('analysis'));
    await click('[data-view=optimizations]'); await sleep(1200); await shot(win, out('optimizations'));
    await js(win, "document.getElementById('tweakSearch').scrollIntoView({ block: 'start' }); document.querySelector('main, .main, body').scrollTop = 0; window.scrollTo(0,0); 0");
    await js(win, "document.querySelector('.tweaks-head').scrollIntoView({ block: 'start' }); 0"); await sleep(300); await shot(win, out('tweaks'));
    // Counter-Strike 2 preset: wait until the view is visible AND filled in (location read, both option lists drawn) before shooting
    demo.resetCs2();
    await click('[data-view=optimizations]'); await sleep(500);
    await click('#openCs2');
    await until("!document.getElementById('cs2').hidden && !document.getElementById('cs2Cfg').hidden && document.querySelectorAll('#cs2CfgList .clean-row').length === 2 && document.querySelectorAll('#cs2LaunchList .clean-row').length > 0"); await sleep(600);
    await js(win, "document.querySelector('.main').scrollTop = 0; 0"); await sleep(300); await shot(win, out('cs2'));
    await click('#cs2CfgList [data-id=showfps] input'); await click('#cs2CfgList [data-id=fpsmax] input');
    await js(win, "(()=>{const e=document.getElementById('cs2Fps');e.value='144';e.dispatchEvent(new Event('input',{bubbles:true}))})()");
    await click('#cs2LaunchList [data-id=console] input'); await sleep(300);
    await js(win, "document.getElementById('cs2Cfg').scrollIntoView({ block: 'start' }); 0"); await sleep(500); await shot(win, out('cs2-options'));
    await js(win, "document.getElementById('cs2Launch').scrollIntoView({ block: 'start' }); 0"); await sleep(500); await shot(win, out('cs2-launch'));
    demo.resetCs2();
    // Memory cleanup (RAMMap): first the page before RAMMap is downloaded, then after a demo install and one action with its history
    await click('[data-view=optimizations]'); await sleep(900); await click('#openRammap'); await until("!document.getElementById('rammap').hidden && !document.getElementById('rammapGet').hidden"); await sleep(500);
    await js(win, "document.querySelector('.main').scrollTop = 0; 0"); await sleep(300); await shot(win, out('rammap'));
    await click('#rammapAgree'); await sleep(200); await click('#rammapDownload'); await until("!document.getElementById('rammapActionsCard').hidden"); await sleep(500);
    await js(win, "document.querySelectorAll('#rammapActions .rammap-row .btn')[4].click(); 0"); await sleep(500); await click('#cfOk'); await until("!document.getElementById('rammapHistoryCard').hidden"); await sleep(600);
    await js(win, "document.getElementById('rammapActionsCard').scrollIntoView({ block: 'start' }); 0"); await sleep(500); await shot(win, out('rammap-run'));
    await click('[data-view=cleanup]'); await sleep(1500); await shot(win, out('cleanup'));
    await click('[data-view=apps]'); for (let i = 0; i < 50 && (await js(win, "document.getElementById('apps').hidden")); i++) await sleep(100); await sleep(2200); await shot(win, out('apps'));
    demo.state.sensorsInstalled = true;          // the consent card is covered by the UI test; the shot shows the live cards
    await click('[data-view=sensors]'); for (let i = 0; i < 50 && (await js(win, "document.getElementById('sensorsMain').hidden || !document.querySelector('#sensorsGroups .srow')")); i++) await sleep(100); await sleep(600); await shot(win, out('sensors'));
    await click('[data-view=insights]'); await sleep(400);
    await click('#sessStart'); await until("!document.getElementById('sessSummary').hidden");
    await click('#advAnalyze'); await until("!document.getElementById('advVerdict').hidden"); await sleep(500); await shot(win, out('insights'));
    await click('[data-view=optimizations]'); await sleep(400);
    await click('#openThrottle'); await sleep(900);
    const ids = ['detect', 'backup', 'get', 'vbs', 'apply', 'task', 'verify'];
    for (let i = 0; i < ids.length; i++) {
      if (i > 0) await click('#run');
      await waitIdle(); await sleep(350);
      await shot(win, out(`step-${i}-${ids[i]}`));
      await click('#next'); await sleep(450);
    }
    await shot(win, out('finish'));
    await click('[data-view=restore]'); await sleep(1500); await shot(win, out('restore'));
    await click('[data-view=settings]'); await sleep(900); await shot(win, out('settings'));
    await click('[data-view=help]'); await sleep(600); await js(win, "document.querySelector('.faq details').open = true"); await sleep(300); await shot(win, out('help'));
    // back to the first screen for the next variant
    await click('[data-view=health]'); await sleep(300);
    if (v !== wanted[wanted.length - 1]) { await js(win, 'KB.resetWizard()'); }
  }
  settings.reset();
}

module.exports = { run, VARIANTS };
