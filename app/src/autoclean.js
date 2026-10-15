'use strict';
// Auto memory clean: while a play session records, asks the rammap-auto step (at most once a minute) to run
// RAMMap "working-sets" if standby memory is high. Pure: the caller injects everything, so it is unit tested.
const MIN_GAP_MS = 60 * 1000;
const FATAL_CODES = new Set(['msg.rammap.needsAdmin', 'msg.rammap.notInstalled', 'msg.rammap.badSignature']);

function createAutoClean({ runStep, getSettings, setSettings, notify, now }) {
  let lastRunAt = null;
  let inFlight = false;

  async function onSession(st) {
    const settings = getSettings();
    if (!st || st.status !== 'running' || !settings.autoClean || inFlight) return;
    if (lastRunAt !== null && now() - lastRunAt < MIN_GAP_MS) return;
    inFlight = true; lastRunAt = now();
    try {
      const res = await runStep('rammap-auto', { rammapAutoPct: settings.autoCleanThresholdPct, rammapAutoCooldownMin: settings.autoCleanCooldownMin });
      if (res && FATAL_CODES.has(res.code)) { setSettings({ autoClean: false }); notify(res.code); }
    } finally { inFlight = false; }
  }

  return { onSession };
}

module.exports = { createAutoClean };
