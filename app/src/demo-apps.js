'use strict';
// Apps manager in demo mode (WIZARD_DEMO=1). The real service (src/packages) runs on top of a fake package manager that
// keeps its state in memory, so the demo exercises the same parsing, validation and import code as a real run
// without installing or removing anything.
const EXTRA = [['Obsidian.Obsidian', 'Obsidian'], ['Mozilla.Thunderbird', 'Mozilla Thunderbird'], ['voidtools.Everything', 'Everything'], ['Rufus.Rufus', 'Rufus']];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function appsService(catalog, platform) {
  const { createService } = require('./packages');
  const linux = platform === 'linux';
  const installed = new Set(linux
    ? ['org.mozilla.firefox', 'com.valvesoftware.Steam', 'org.videolan.VLC']
    : ['Google.Chrome', 'Valve.Steam', 'Discord.Discord', '7zip.7zip', 'VideoLAN.VLC', 'Microsoft.VisualStudioCode', 'Git.Git']);
  const bloat = new Set(['Microsoft.BingNews', 'Microsoft.BingWeather', 'Microsoft.GetHelp', 'Microsoft.Getstarted', 'Microsoft.MicrosoftSolitaireCollection',
    'Microsoft.People', 'Microsoft.YourPhone', 'Microsoft.ZuneVideo', 'Clipchamp.Clipchamp']);
  const names = new Map(catalog.apps.map((a) => [linux ? (a.ids.linux || {}).flatpak : a.ids.win32, a.name]));
  const nameOf = (id) => names.get(id) || (EXTRA.find((e) => e[0] === id) || [])[1] || id;
  const matches = (q) => [...new Set([...names.keys(), ...EXTRA.map((e) => e[0])])].filter((id) => id && (nameOf(id).toLowerCase().includes(q) || id.toLowerCase().includes(q)));
  const table = (rows) => ['Name'.padEnd(34) + 'Id'.padEnd(34) + 'Version', '-'.repeat(80), ...rows.map((r) => r[1].padEnd(34) + r[0].padEnd(34) + '1.0')].join('\n') + '\n';

  const runner = async (cmd, args) => {
    const a = args.join(' ');
    await sleep(/install|uninstall|Remove-Appx/.test(a) ? 700 : 60);
    const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
    if (cmd === 'powershell.exe') {
      const rm = /Get-AppxPackage -Name '([^']+)'/.exec(a);
      if (rm) { bloat.delete(rm[1]); return ok(); }
      return ok([...bloat].join('\n') + '\n');
    }
    if (a === '--version') return ok('demo');
    if (cmd === 'winget') {
      if (args[0] === 'list') return ok(table([...installed].map((id) => [id, nameOf(id)])));
      if (args[0] === 'search') return ok(table(matches(args[1].toLowerCase()).map((id) => [id, nameOf(id)])));
      const id = args[args.indexOf('--id') + 1];
      if (args[0] === 'install') installed.add(id); else installed.delete(id);
      return ok();
    }
    if (cmd === 'flatpak') {
      if (args[0] === 'list') return ok([...installed].map((id) => [id, nameOf(id), '1.0'].join('\t')).join('\n') + '\n');
      if (args[0] === 'search') return ok(matches(args[args.length - 1].toLowerCase()).map((id) => [id, nameOf(id), 'Demo'].join('\t')).join('\n') + '\n');
      if (args[0] === 'install') installed.add(args[args.length - 1]);
      else if (args[0] === 'uninstall') installed.delete(args[args.length - 1]);
      return ok();
    }
    return { code: 1, stdout: '', stderr: 'demo' };
  };
  return createService({ catalog, runner, platform: linux ? 'linux' : 'win32' });
}

// A canned export file (what a user saved on another PC) for the import flow; one entry is deliberately malicious and must be dropped.
function demoAppsFile() {
  return {
    app: 'KafkaBoost', format: 1, exportedAt: '2026-10-01T10:00:00Z', platform: 'win32', manager: 'winget',
    packages: [{ id: 'Google.Chrome', catalogId: 'chrome' }, { id: 'OBSProject.OBSStudio', catalogId: 'obs' }, { id: 'Spotify.Spotify', catalogId: 'spotify' },
      { id: 'Audacity.Audacity', catalogId: 'audacity' }, { id: 'bad id; calc' }]
  };
}

module.exports = { appsService, demoAppsFile };
