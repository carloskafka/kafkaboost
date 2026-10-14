'use strict';
// Play-session recorder (main process). One PowerShell process (`Steps.ps1 -Step session`) samples the sensors every few seconds for the
// whole game and streams "SAMPLE {json}" log lines; this module keeps the running numbers, writes the stop file when asked and keeps the
// finished summary on disk. The window only starts/stops it and shows the state, so a hidden window (tray) does not interrupt anything.
// Pure of Electron: the step runner, the file system and the clock are injected (see test/session.test.js).

const INTERVAL_SEC = 5;
const HISTORY_MAX = 20;      // finished sessions kept for the boost-clock advice

function createSession({ runStep, fs, stopFile, storeFile, historyFile = null, now = () => Date.now(), onChange = () => {} }) {
  let state = { status: 'idle', startedAt: null, count: 0, last: null, peakTempC: null, peakPowerW: null, result: null, code: null };
  let done = null;     // promise of the running recording

  const load = () => {
    try { const r = JSON.parse(fs.readFileSync(storeFile, 'utf8')); if (r && r.summary) return r; } catch { /* none yet */ }
    return null;
  };
  let history = [];
  try { const h = JSON.parse(fs.readFileSync(historyFile, 'utf8')); if (Array.isArray(h)) history = h.filter((x) => x && x.summary).slice(-HISTORY_MAX); } catch { /* none yet */ }
  state.result = load();
  if (state.result) state.status = 'done';

  const set = (patch) => { state = { ...state, ...patch }; onChange(getState()); };
  const getState = () => ({ ...state });

  function onLine(line) {
    if (typeof line !== 'string' || !line.startsWith('SAMPLE ')) return;
    let s; try { s = JSON.parse(line.slice(7)); } catch { return; }
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const t = num(s.packageTempC), p = num(s.packagePowerW);
    set({
      count: state.count + 1,
      last: { t: String(s.t || ''), tempC: t, powerW: p, pClockMHz: num(s.pClockMaxMHz), eClockMHz: num(s.eClockMaxMHz), standbyBytes: num(s.standbyBytes), freeBytes: num(s.freeBytes) },
      peakTempC: t === null ? state.peakTempC : (state.peakTempC === null ? t : Math.max(state.peakTempC, t)),
      peakPowerW: p === null ? state.peakPowerW : (state.peakPowerW === null ? p : Math.max(state.peakPowerW, p))
    });
  }

  function start() {
    if (state.status === 'running') return false;
    try { fs.rmSync(stopFile, { force: true }); } catch { /* nothing to remove */ }
    set({ status: 'running', startedAt: now(), count: 0, last: null, peakTempC: null, peakPowerW: null, result: null, code: null });
    done = runStep('session', { sessionStopFile: stopFile, sessionIntervalSec: INTERVAL_SEC }, onLine).then((res) => {
      if (res && res.ok && res.data && res.data.summary) {
        try { fs.writeFileSync(storeFile, JSON.stringify(res.data)); } catch { /* the summary stays in memory */ }
        if (historyFile && res.data.summary.samples > 0) {
          history = [...history, res.data].slice(-HISTORY_MAX);
          try { fs.writeFileSync(historyFile, JSON.stringify(history)); } catch { /* advice then uses what is in memory next time */ }
        }
        set({ status: 'done', result: res.data, code: res.code || null });
      } else {
        set({ status: 'failed', result: null, code: (res && res.code) || null });
      }
      try { fs.rmSync(stopFile, { force: true }); } catch { /* ignore */ }
    });
    return true;
  }

  function stop() {
    if (state.status !== 'running') return false;
    try { fs.writeFileSync(stopFile, 'stop'); } catch { return false; }
    return true;
  }

  // Resolves when the running recording has finished (immediately when none runs); used to flush the summary before the app quits.
  const whenDone = () => (state.status === 'running' && done ? done : Promise.resolve());

  const getHistory = () => history.slice();

  return { start, stop, getState, getHistory, whenDone, onLine };
}

module.exports = { createSession, INTERVAL_SEC, HISTORY_MAX };
