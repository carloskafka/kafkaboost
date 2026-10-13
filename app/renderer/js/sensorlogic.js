'use strict';
// Pure logic of the Sensors screen, shared by the page (window.KBSensors), the main process (snapshot validation before it is
// copied or saved) and the node tests. No DOM, no Electron.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KBSensors = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // Generic temperature thresholds in degrees C. They are NOT specific to any chip or disk: check the vendor's limits.
  const TEMP_WARM = 80;
  const TEMP_HOT = 90;
  const REFRESH_MS = 2000;

  const GROUP_ORDER = ['cpu', 'gpu', 'motherboard', 'memory', 'storage', 'other'];
  const TYPE_ORDER = ['Temperature', 'Power', 'Clock', 'Load', 'Voltage', 'Current', 'Fan', 'Control', 'Level', 'Data', 'SmallData', 'Throughput', 'Frequency', 'Flow', 'Factor', 'TimeSpan', 'Energy', 'Noise', 'Conductivity', 'Humidity'];
  const UNITS = new Set(['', 'V', 'A', 'W', 'MHz', 'C', 'pct', 'Hz', 'RPM', 'Lh', 'GB', 'MB', 'Bps', 's', 'mWh', 'dBA', 'uScm']);

  // 'ok' | 'warm' | 'hot' for a temperature reading; anything else is not colored.
  function tempLevel(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'ok';
    return value >= TEMP_HOT ? 'hot' : value >= TEMP_WARM ? 'warm' : 'ok';
  }

  // Human text for a value. Throughput arrives in bytes per second, memory in GB/MB; a missing value is a dash.
  function formatValue(value, unit, locale) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
    const n = (x, d) => x.toLocaleString(locale || 'en', { minimumFractionDigits: 0, maximumFractionDigits: d });
    switch (unit) {
      case 'C': return n(value, 1) + ' °C';
      case 'pct': return n(value, 1) + ' %';
      case 'V': return n(value, 3) + ' V';
      case 'A': return n(value, 2) + ' A';
      case 'W': return n(value, 1) + ' W';
      case 'MHz': return n(value, 0) + ' MHz';
      case 'Hz': return n(value, 0) + ' Hz';
      case 'RPM': return n(value, 0) + ' RPM';
      case 'GB': return n(value, 1) + ' GB';
      case 'MB': return n(value, 0) + ' MB';
      case 'Bps': return value >= 1048576 ? n(value / 1048576, 1) + ' MB/s' : n(value / 1024, 0) + ' KB/s';
      case 'Lh': return n(value, 1) + ' L/h';
      case 's': return n(value, 0) + ' s';
      case 'mWh': return n(value, 0) + ' mWh';
      case 'dBA': return n(value, 1) + ' dBA';
      case 'uScm': return n(value, 0) + ' µS/cm';
      default: return n(value, 2);
    }
  }

  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

  // Keeps only the fields the screen knows, with the right types and bounded sizes. Anything else is dropped.
  // Used before a snapshot is copied or saved so the main process never writes what the page invented.
  function sanitizeSnapshot(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.groups)) return null;
    const groups = [];
    for (const g of raw.groups.slice(0, 12)) {
      if (!g || typeof g !== 'object' || !GROUP_ORDER.includes(g.id) || !Array.isArray(g.hardware)) continue;
      const hardware = [];
      for (const h of g.hardware.slice(0, 40)) {
        if (!h || typeof h !== 'object' || !Array.isArray(h.sensors)) continue;
        const sensors = [];
        for (const s of h.sensors.slice(0, 400)) {
          if (!s || typeof s !== 'object' || num(s.value) === null) continue;
          sensors.push({ name: text(s.name, 120), type: text(s.type, 30), value: num(s.value), min: num(s.min), max: num(s.max), unit: UNITS.has(s.unit) ? s.unit : '' });
        }
        if (sensors.length) hardware.push({ name: text(h.name, 160), type: text(h.type, 30), sensors });
      }
      if (hardware.length) groups.push({ id: g.id, hardware });
    }
    return {
      source: text(raw.source, 80), takenAt: text(raw.takenAt, 40), minMaxSince: text(raw.minMaxSince, 40), demo: raw.demo === true,
      admin: raw.admin === true, cpuTemperature: raw.cpuTemperature === true,
      groups
    };
  }

  // Sensors of one hardware item, grouped by type in a fixed order (unknown types last), each keeping its original order.
  function sensorsByType(sensors) {
    const by = new Map();
    for (const s of sensors) { if (!by.has(s.type)) by.set(s.type, []); by.get(s.type).push(s); }
    const known = TYPE_ORDER.filter((t) => by.has(t));
    const other = [...by.keys()].filter((t) => !TYPE_ORDER.includes(t)).sort();
    return [...known, ...other].map((type) => ({ type, sensors: by.get(type) }));
  }

  // The hottest temperature in a snapshot, or null.
  function hottest(snapshot) {
    let best = null;
    for (const g of (snapshot && snapshot.groups) || []) for (const h of g.hardware) for (const s of h.sensors) {
      if (s.type === 'Temperature' && (best === null || s.value > best.value)) best = { value: s.value, name: s.name, hardware: h.name };
    }
    return best;
  }

  return { TEMP_WARM, TEMP_HOT, REFRESH_MS, GROUP_ORDER, tempLevel, formatValue, sanitizeSnapshot, sensorsByType, hottest };
});
