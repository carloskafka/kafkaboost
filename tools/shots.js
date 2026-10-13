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
    await click('[data-view=health]'); await sleep(1200); await shot(win, out('health-ok'));
    demo.state.scenario = 'updated'; demo.state.fixed = false;
    await click('#check'); await sleep(900); await shot(win, out('health-attention'));
    await click('#fix'); await sleep(1300); await shot(win, out('health-fixed'));
    await click('[data-view=analysis]'); await sleep(1300); await shot(win, out('analysis'));
    await click('[data-view=optimizations]'); await sleep(1200); await shot(win, out('optimizations'));
    await js(win, "document.getElementById('tweakSearch').scrollIntoView({ block: 'start' }); document.querySelector('main, .main, body').scrollTop = 0; window.scrollTo(0,0); 0");
    await js(win, "document.querySelector('.tweaks-head').scrollIntoView({ block: 'start' }); 0"); await sleep(300); await shot(win, out('tweaks'));
    await click('[data-view=cleanup]'); await sleep(1500); await shot(win, out('cleanup'));
    await click('[data-view=apps]'); for (let i = 0; i < 50 && (await js(win, "document.getElementById('apps').hidden")); i++) await sleep(100); await sleep(2200); await shot(win, out('apps'));
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
    await click('[data-view=help]'); await sleep(600); await js(win, "document.querySelector('.faq details').open = true"); await shot(win, out('help'));
    // back to the first screen for the next variant
    await click('[data-view=health]'); await sleep(300);
    if (v !== wanted[wanted.length - 1]) { await js(win, 'KB.resetWizard()'); }
  }
  settings.reset();
}

module.exports = { run, VARIANTS };
