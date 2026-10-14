'use strict';
// Live memory view (main process). One PowerShell process (`Steps.ps1 -Step memory-watch`) reads the Windows memory counters every few
// seconds and streams "MEM {json}" log lines; this module keeps the latest reading and the last few for a small trend. The page starts it
// when it is shown and stops it when it is left (a stop file ends the process), so nothing keeps reading in the background.
// Pure of Electron: the step runner, the file system and the clock are injected (see test/memorywatch.test.js).

const INTERVAL_SEC = 2;
const KEEP = 60;                 // readings kept for the trend (about two minutes)

function createMemoryWatch({ runStep, fs, stopFile, onChange = () => {} }) {
  let state = { status: 'idle', last: null, history: [], code: null };
  let done = null;
  let stopping = false;      // a stop was requested and the process has not exited yet
  let restart = false;       // a start arrived meanwhile: run again as soon as the old process has ended

  const set = (patch) => { state = { ...state, ...patch }; onChange(getState()); };
  const getState = () => ({ ...state, history: state.history.slice() });
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);   // a missing counter stays null, never 0

  function onLine(line) {
    if (typeof line !== 'string' || !line.startsWith('MEM ')) return;
    let s; try { s = JSON.parse(line.slice(4)); } catch { return; }
    const r = { t: String(s.t || ''), totalBytes: num(s.totalBytes), availableBytes: num(s.availableBytes), freeBytes: num(s.freeBytes), standbyBytes: num(s.standbyBytes), modifiedBytes: num(s.modifiedBytes) };
    set({ last: r, history: [...state.history, r].slice(-KEEP) });
  }

  function start() {
    if (state.status === 'running') {
      if (!stopping) return false;
      restart = true; return true;        // leaving and re-entering the page quickly: wait for the old process, then start again
    }
    stopping = false; restart = false;
    try { fs.rmSync(stopFile, { force: true }); } catch { /* nothing to remove */ }
    set({ status: 'running', last: null, history: [], code: null });
    done = runStep('memory-watch', { sessionStopFile: stopFile, sessionIntervalSec: INTERVAL_SEC }, onLine).then((res) => {
      set({ status: res && res.ok ? 'idle' : 'failed', code: (res && res.code) || null });
      try { fs.rmSync(stopFile, { force: true }); } catch { /* ignore */ }
      const again = restart; stopping = false; restart = false;
      if (again) start();
    });
    return true;
  }

  function stop() {
    if (state.status !== 'running') return false;
    try { fs.writeFileSync(stopFile, 'stop'); } catch { return false; }
    stopping = true; restart = false;
    return true;
  }

  const whenDone = () => (state.status === 'running' && done ? done : Promise.resolve());

  return { start, stop, getState, whenDone, onLine };
}

module.exports = { createMemoryWatch, INTERVAL_SEC, KEEP };
