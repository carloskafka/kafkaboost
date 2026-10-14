'use strict';
// Memory page: the Windows memory counters, live. A PowerShell process (main.js, memory-watch step) reads them every 2 s while this page is
// open; leaving the page stops it. The numbers are only what Windows reports (a counter it does not report is a dash). Everything is
// written with textContent. Cleaning is a separate page (Memory cleanup with RAMMap), linked from here.
(function () {
  const { $, t } = KB;
  const L = window.KBMemory;
  let st = null;
  let active = false;

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

  function render() {
    const m = L.screenModel(st);
    const chip = $('memStatus');
    chip.textContent = t(m.failed ? 'memory.status.failed' : m.waiting ? 'memory.status.waiting' : m.running ? 'memory.status.live' : 'memory.status.stopped');
    chip.className = 'chip status ' + (m.failed ? 'bad' : m.running && !m.waiting ? 'ok' : '');

    const bar = $('memBar'); bar.textContent = '';
    const legend = $('memLegend'); legend.textContent = '';
    m.segments.forEach((s) => {
      const seg = el('span', 'memseg memseg-' + s.key); seg.style.width = s.pct + '%'; seg.title = t(`memory.card.${s.key}`);
      bar.appendChild(seg);
      const item = el('span', 'memlegend-item'); item.append(el('i', 'memdot memseg-' + s.key), document.createTextNode(t(`memory.card.${s.key}`)));
      legend.appendChild(item);
    });
    bar.setAttribute('aria-label', m.hasData ? t('memory.bar.label') : t('memory.status.waiting'));

    const cards = $('memCards');
    if (!m.hasData) { if (m.running || m.waiting) KB.skeleton(cards, 6); else cards.textContent = ''; return; }
    cards.textContent = '';
    m.cards.forEach((c) => {
      const card = el('div', 'memcard');
      card.append(el('span', 'muted', t(`memory.card.${c.key}`)), el('b', '', c.value));
      if (c.pct !== null) card.append(el('span', 'muted', t('memory.share', { pct: c.pct })));
      cards.appendChild(card);
    });
  }

  async function enter() {
    active = true;
    try { st = await window.kb.memory.state(); } catch { st = null; }
    render();
    if (active) { try { await window.kb.memory.start(); } catch { /* the chip shows the failure through the state update */ } }
  }
  function leave() { active = false; try { window.kb.memory.stop(); } catch { /* nothing running */ } }

  KB.registerView('memory', { onShow() { enter(); }, onHide() { leave(); } });
  document.addEventListener('DOMContentLoaded', () => {
    window.kb.memory.onUpdate((s) => { st = s; if (active) render(); });
    $('memOpenRammap').addEventListener('click', () => KB.showView('rammap'));
    // a hidden window (closed to the tray) must not keep reading; coming back resumes
    document.addEventListener('visibilitychange', () => { if (!active) return; if (document.hidden) { try { window.kb.memory.stop(); } catch { /* ignore */ } } else { try { window.kb.memory.start(); } catch { /* ignore */ } } });
    KB.onSettingsChanged(() => { if (active) render(); });
  });
})();
