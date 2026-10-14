'use strict';
// Decides when a play session should start and stop by itself (setting autoRecord). Pure: the main process feeds it readings.
//   idle      -> a reading with package power at or above START_W starts a recording
//   recording -> LOW_READINGS readings in a row below STOP_W stop it (the load ended)
// Only sessions that WE started automatically are stopped automatically; one the user started is never touched.

const START_W = 40;       // average gaming load on this chip is well above this; idle and browsing are below
const STOP_W = 25;
const LOW_READINGS = 6;   // 6 x 5 s samples = 30 s below STOP_W

function createLoadWatch() {
  let auto = false, low = 0;
  return {
    // reading: package power in W or null (missing sensor: never counts as load and never as "load ended")
    // state: the session status ('idle' | 'running' | 'done' | 'failed'). Returns 'start' | 'stop' | null.
    decide(reading, status) {
      if (status !== 'running') {
        auto = false; low = 0;
        if (typeof reading === 'number' && reading >= START_W) { auto = true; return 'start'; }
        return null;
      }
      if (!auto) return null;
      if (typeof reading !== 'number') return null;
      low = reading < STOP_W ? low + 1 : 0;
      if (low >= LOW_READINGS) { auto = false; low = 0; return 'stop'; }
      return null;
    },
    isAuto: () => auto
  };
}

module.exports = { createLoadWatch, START_W, STOP_W, LOW_READINGS };
