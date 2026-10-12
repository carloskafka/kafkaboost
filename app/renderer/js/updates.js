'use strict';
// Update banner + changelog dialog. The notes come from the GitHub release body, parsed in the main process into
// blocks {type: h|li|p, text}; they are rendered with textContent only, never as HTML.
(function () {
  const { $, t } = KB;
  let current = null;       // the check result the dialog is showing

  function renderNotes(host, releases) {
    host.textContent = '';
    for (const rel of releases) {
      const box = document.createElement('section'); box.className = 'cl-release';
      const head = document.createElement('div'); head.className = 'cl-head';
      const ver = document.createElement('span'); ver.className = 'cl-ver'; ver.textContent = 'v' + rel.version; head.appendChild(ver);
      if (rel.date) { const d = document.createElement('span'); d.className = 'cl-date'; d.textContent = new Date(rel.date).toLocaleDateString(KB.lang === 'pt-BR' ? 'pt-BR' : 'en'); head.appendChild(d); }
      box.appendChild(head);
      let ul = null;
      if (!rel.notes.length) { const p = document.createElement('p'); p.textContent = t('update.noNotes'); box.appendChild(p); }
      for (const b of rel.notes) {
        if (b.type === 'li') {
          if (!ul) { ul = document.createElement('ul'); box.appendChild(ul); }
          const li = document.createElement('li'); li.textContent = b.text; ul.appendChild(li);
        } else {
          ul = null;
          const el = document.createElement(b.type === 'h' ? 'h4' : 'p'); el.textContent = b.text; box.appendChild(el);
        }
      }
      host.appendChild(box);
    }
  }

  function open(r, mode) {         // mode: 'available' | 'whatsnew'
    current = r;
    $('clTitle').textContent = mode === 'whatsnew' ? t('update.whatsNew', { version: r.current }) : t('update.available', { latest: r.latest, current: r.current });
    renderNotes($('clBody'), r.releases);
    const available = mode === 'available';
    $('clInstall').hidden = !(available && r.canInstall);
    $('clOpen').hidden = !available;
    $('clOpen').dataset.url = r.url || '';
    KB.showResult($('clProgress'), '', '');
    $('clInstall').disabled = false;
    $('clLater').textContent = t(available ? 'update.later' : 'update.close');
    const dlg = $('changelog'); if (!dlg.open) dlg.showModal();
  }

  function banner(r) {
    $('updateBanner').hidden = false;
    $('updateBannerText').textContent = t('update.available', { latest: r.latest, current: r.current });
    $('updateBannerBtn').onclick = () => open(r, 'available');
  }

  KB.updates = { open, banner };

  document.addEventListener('DOMContentLoaded', () => {
    $('clLater').addEventListener('click', () => $('changelog').close());
    $('clOpen').addEventListener('click', () => { if ($('clOpen').dataset.url) window.kb.openExternal($('clOpen').dataset.url); });
    $('clInstall').addEventListener('click', async () => {
      $('clInstall').disabled = true;
      KB.showResult($('clProgress'), 'warn', t('update.preparing'));
      const r = await window.kb.installUpdate();
      if (!r.ok) { $('clInstall').disabled = false; KB.showResult($('clProgress'), 'fail', t('update.installFailed')); $('clOpen').hidden = false; }
    });
    window.kb.onUpdate('progress', (p) => {
      if (p.stage === 'downloading') KB.showResult($('clProgress'), 'warn', t('update.downloading', { percent: p.percent }));
      else if (p.stage === 'ready') KB.showResult($('clProgress'), 'ok', t('update.restarting'));
      else if (p.stage === 'error') { $('clInstall').disabled = false; KB.showResult($('clProgress'), 'fail', t('update.installFailed')); $('clOpen').hidden = false; }
    });
    window.kb.onUpdate('available', (r) => banner(r));
    window.kb.onUpdate('show', (r) => open(r, 'available'));
  });
})();
