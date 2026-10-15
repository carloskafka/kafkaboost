'use strict';
// Persistent user settings (userData/settings.json). Pure Node, no Electron imports, so it can be unit tested.
const fs = require('fs');
const path = require('path');

const DEFAULTS = Object.freeze({
  version: 1,
  theme: 'system',            // system | dark | light
  language: 'auto',           // auto | en | pt-BR
  closeToTray: true,          // closing the window hides it to the tray instead of quitting
  startHidden: false,         // when started with Windows: stay in the tray, do not show the window
  startHwinfoWithApp: false,  // start HWiNFO (installed, shared memory already on in its INI) once after the app starts, so the Dashboard tiles fill in
  autoRecord: false,          // check every 10 minutes whether a game loads the CPU and record that play session by itself (sensors are only read)
  notifications: true,        // toast when the optimization gets worse
  checkIntervalMin: 30,       // background health check
  installDir: '',             // ThrottleStop folder ('' = automatic)
  checkForUpdates: true,      // look at GitHub Releases every few hours (a lookup only; nothing downloads without a click)
  lastSeenVersion: '',        // version whose "what's new" was already shown
  lastCleanup: null,          // ISO time of the last cleanup run
  cs2Exe: '',                 // a cs2.exe the user picked when Steam did not reveal it ('' = detect through Steam)
  autoClean: false,           // during a recorded play session, run RAMMap "working-sets" when standby memory is high (opt-in, needs the RAMMap consent)
  autoCleanThresholdPct: 50,  // standby share of total memory that triggers an auto clean
  autoCleanCooldownMin: 10    // minimum minutes between two auto cleans
});

const isBool = (v) => typeof v === 'boolean';
const RULES = Object.freeze({
  theme: (v) => ['system', 'dark', 'light'].includes(v),
  language: (v) => ['auto', 'en', 'pt-BR'].includes(v),
  closeToTray: isBool,
  startHidden: isBool,
  startHwinfoWithApp: isBool,
  autoRecord: isBool,
  notifications: isBool,
  checkIntervalMin: (v) => Number.isInteger(v) && v >= 5 && v <= 1440,
  installDir: (v) => typeof v === 'string' && v.length <= 260,
  checkForUpdates: isBool,
  lastSeenVersion: (v) => typeof v === 'string' && v.length <= 40,
  autoClean: isBool,
  autoCleanThresholdPct: (v) => Number.isInteger(v) && v >= 20 && v <= 90,
  autoCleanCooldownMin: (v) => Number.isInteger(v) && v >= 5 && v <= 60,
  lastCleanup: (v) => v === null || (typeof v === 'string' && v.length <= 40),
  // a drive path ending in cs2.exe, no ".." / "." parts, no wildcard characters (PowerShell validates it again)
  cs2Exe: (v) => v === '' || (typeof v === 'string' && v.length <= 260 && /^[A-Za-z]:[\\/](?:[^\[\]*?<>|"]*[\\/])?cs2\.exe$/i.test(v) && !/(^|[\\/])\.\.?([\\/]|$)/.test(v))
});

// Keeps only known keys with valid values; everything else falls back to the default.
function sanitize(input) {
  const out = { ...DEFAULTS };
  if (input && typeof input === 'object') {
    for (const key of Object.keys(RULES)) {
      if (key in input && RULES[key](input[key])) out[key] = input[key];
    }
  }
  return out;
}

function createStore(file) {
  let current = { ...DEFAULTS };
  const listeners = [];

  const load = () => {
    try { current = sanitize(JSON.parse(fs.readFileSync(file, 'utf8'))); }
    catch { current = { ...DEFAULTS }; }          // missing or corrupt file: start from the defaults
  };
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(current, null, 2));
    fs.renameSync(tmp, file);                     // atomic replace: a crash never leaves a half-written file
  };
  const emit = () => listeners.forEach((cb) => cb({ ...current }));

  load();
  return {
    get: () => ({ ...current }),
    // Applies a partial update. Invalid keys/values are rejected (returned), valid ones are saved.
    set(patch) {
      const rejected = [];
      const next = { ...current };
      for (const [key, value] of Object.entries(patch || {})) {
        if (RULES[key] && RULES[key](value)) next[key] = value; else rejected.push(key);
      }
      const changed = Object.keys(next).some((k) => next[k] !== current[k]);
      current = next;
      if (changed) { save(); emit(); }
      return { settings: { ...current }, rejected };
    },
    reset() { current = { ...DEFAULTS }; save(); emit(); return { ...current }; },
    onChange(cb) { listeners.push(cb); }
  };
}

module.exports = { createStore, sanitize, DEFAULTS, RULES };
