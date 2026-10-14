'use strict';
// Dashboard "Play session": start/stop a recording of temperature, clocks and power while the user plays, then show the summary.
// The recorder runs in the main process (it keeps going when the window is hidden in the tray); this file only renders its state.
(function () {
  const { $, t, setText } = KB;
  const L = window.KBSession;
  let st = null, timer = null;

  const row = (label, value) => { const r = document.createElement('div'); r.className = 'sess-row'; const a = document.createElement('span'); a.className = 'muted'; a.textContent = label; const b = document.createElement('strong'); b.textContent = value; r.append(a, b); return r; };

  function summaryRows(res) {
    const host = $('sessSummary'); host.textContent = '';
    const s = res && res.summary; if (!s) { host.hidden = true; return; }
    const stat = (x, unit) => { const f = L.formatStat(x, unit); return f ? t('dashboard.session.peakAvg', f) : '–'; };
    host.append(
      row(t('dashboard.session.duration'), L.formatDuration(s.durationSec)),
      row(t('dashboard.session.temp'), stat(s.tempC, '°C')),
      row(t('dashboard.session.power'), stat(s.powerW, 'W')),
      row(t('dashboard.session.pclock'), stat(s.pClockMHz, 'MHz')),
      row(t('dashboard.session.limits', { pl1: s.pl1W, pl2: s.pl2W }), `${L.pctText(s.pl1Pct)} / ${L.pctText(s.pl2Pct)}`)
    );
    // standby and free memory during the session (sessions recorded before this existed have no `memory` part: no rows)
    if (s.memory) {
      const range = (x) => { const f = L.formatRange(x); return f ? t('dashboard.session.range', f) : '–'; };
      host.append(row(t('dashboard.session.free'), range(s.memory.freeBytes)), row(t('dashboard.session.standby'), range(s.memory.standbyBytes)));
    }
    const w = L.wheaKey(res.whea);
    host.append(row('WHEA', t(w.key, w.args)));
    const note = document.createElement('p'); note.className = 'muted'; note.textContent = t('dashboard.session.noFlags'); host.append(note);
    if (s.memory) { const mnote = document.createElement('p'); mnote.className = 'muted'; mnote.textContent = t('dashboard.session.memNote'); host.append(mnote); }
    host.hidden = false;
  }

  function render() {
    const on = KB.featureOn('insights');
    $('sessCard').hidden = !on; if (!on) return;
    const v = L.view(st);
    $('sessStart').hidden = v === 'running'; $('sessStop').hidden = v !== 'running';
    $('sessLive').hidden = v !== 'running';
    if (v === 'running') {
      const n = L.formatNow(st.last);
      const sec = st.startedAt ? Math.floor((Date.now() - st.startedAt) / 1000) : 0;
      setText($('sessLive'), t('dashboard.session.live', { time: L.formatDuration(sec), count: st.count, temp: n.temp, power: n.power, peak: st.peakTempC === null ? '–' : st.peakTempC + ' °C' }));
    }
    const failed = v === 'failed';
    $('sessResult').hidden = !failed;
    if (failed) setText($('sessResult'), (st.code && (KB.dict[st.code] || KB.fallback[st.code])) ? t(st.code) : t('dashboard.session.failed'));
    summaryRows(v === 'done' ? st.result : null);
    clearTimeout(timer); if (v === 'running') timer = setTimeout(render, 1000);   // keeps the clock moving between samples
  }

  document.addEventListener('DOMContentLoaded', async () => {
    $('sessStart').addEventListener('click', async () => { await window.kb.session.start(); });
    $('sessStop').addEventListener('click', async () => { $('sessStop').disabled = true; await window.kb.session.stop(); });
    window.kb.session.onUpdate((s) => { st = s; $('sessStop').disabled = false; render(); });
    st = await window.kb.session.state(); render();
    KB.onSettingsChanged(render);
  });
  KB.renderSession = render;
  KB.registerView('insights', { onShow() { render(); if (KB.renderAdvice) KB.renderAdvice(); }, onHide() { clearTimeout(timer); } });
})();
