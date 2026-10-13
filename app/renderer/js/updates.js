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

  // ---- the update panel: version text on the left, the action button(s) on the right, then why/how, progress and result ----------
  // One shared UI state (a download is one thing), drawn into every mounted host (Settings and the changelog dialog).
  const ui = { phase: 'idle', percent: 0 };
  const hosts = [];                      // { host, r }
  const BTN = { install: 'update.btn.install', restart: 'update.btn.restart', download: 'update.btn.download', cancel: 'update.btn.cancel', folder: 'update.btn.folder', release: 'update.btn.release' };

  function setPhase(phase, percent) { ui.phase = phase; if (percent !== undefined) ui.percent = percent; hosts.forEach(draw); }

  function draw(h) {
    const { host, r } = h; const m = KBUpdateLogic.model(r, ui);
    host.textContent = ''; host.classList.add('upd');
    const row = document.createElement('div'); row.className = 'upd-row';
    const text = document.createElement('span'); text.className = 'upd-text'; text.textContent = t('settings.newer', { latest: r.latest, current: r.current });
    const btns = document.createElement('div'); btns.className = 'upd-btns';
    m.buttons.forEach((id) => {
      const b = document.createElement('button'); b.type = 'button'; b.id = host.id + '-' + id; b.dataset.act = id;
      b.className = 'btn small' + (id === 'download' || id === 'install' || id === 'restart' ? ' primary' : '');
      b.textContent = t(BTN[id]) + (id === 'download' && r.installer && r.installer.size ? ' (' + KBUpdateLogic.formatSize(r.installer.size) + ')' : '');
      b.addEventListener('click', () => act(id, r));
      btns.appendChild(b);
    });
    row.append(text, btns); host.appendChild(row);
    if (m.explain.length) {
      const why = document.createElement('div'); why.className = 'upd-why';
      m.explain.forEach((k) => { const p = document.createElement('p'); p.textContent = t(k); why.appendChild(p); });
      host.appendChild(why);
    }
    if (m.progress !== null) {
      const pr = document.createElement('progress'); pr.className = 'upd-bar'; pr.max = 100; pr.value = m.progress; host.appendChild(pr);
    }
    if (m.status) {
      const res = document.createElement('div'); res.className = 'result ' + m.status.kind; res.textContent = t(m.status.key, m.status.vars);
      host.appendChild(res);
      if (m.status.key === 'update.noChecksum' || m.status.key === 'update.mismatch') {
        const p = document.createElement('p'); p.className = 'upd-why'; p.textContent = t(m.status.key === 'update.mismatch' ? 'update.mismatchHint' : 'update.noChecksumHint'); host.appendChild(p);
      }
    }
  }

  function mount(host, r) {
    const i = hosts.findIndex((x) => x.host === host);
    if (i >= 0) hosts.splice(i, 1);
    host.hidden = false;
    hosts.push({ host, r });
    draw(hosts[hosts.length - 1]);
  }

  async function confirmInstall(r) {
    return KB.confirm({
      title: t('update.confirmTitle', { version: r.latest }),
      paragraphs: [t('update.confirmBody'), t('update.confirmSmart'), t('update.confirmClone')],
      ok: t('update.confirmOk')
    });
  }

  async function act(id, r) {
    if (id === 'release') { if (r.url) window.kb.openExternal(r.url); return; }
    if (id === 'folder') { await window.kb.showDownloaded(); return; }
    if (id === 'cancel') { await window.kb.cancelDownload(); return; }
    if (id === 'restart') { await window.kb.restartUpdate(); return; }
    if (id === 'install') {
      ui.busy = true; setPhase('downloading', 0);
      const res = await window.kb.installUpdate(); ui.busy = false;
      if (!res.ok) setPhase('error');
      return;
    }
    if (id === 'download') {
      ui.busy = true; setPhase('downloading', 0);
      const res = await window.kb.downloadUpdate(); ui.busy = false;
      if (res.state === 'verified') {
        const yes = await confirmInstall(r);
        if (!yes) { await window.kb.discardDownloaded(); setPhase('declined'); return; }
        setPhase('installing');
        const run = await window.kb.installDownloaded();
        if (!run.ok) setPhase('launchFailed');
        return;
      }
      setPhase(res.state === 'nochecksum' ? 'nochecksum' : res.state === 'mismatch' ? 'mismatch' : res.state === 'cancelled' ? 'cancelled' : 'error');
    }
  }

  function open(r, mode) {         // mode: 'available' | 'whatsnew'
    current = r;
    $('clTitle').textContent = mode === 'whatsnew' ? t('update.whatsNew', { version: r.current }) : t('update.available', { latest: r.latest, current: r.current });
    renderNotes($('clBody'), r.releases);
    const available = mode === 'available';
    if (available) mount($('clPanel'), r); else $('clPanel').hidden = true;
    $('clLater').textContent = t(available ? 'update.later' : 'update.close');
    const dlg = $('changelog'); if (!dlg.open) dlg.showModal();
  }

  function banner(r) {
    $('updateBanner').hidden = false;
    $('updateBannerText').textContent = t('update.available', { latest: r.latest, current: r.current });
    $('updateBannerBtn').onclick = () => open(r, 'available');
  }

  // A fresh check starts from a clean state (reopening the same panel from the banner keeps what happened).
  const reset = () => { if (!ui.busy) { ui.phase = 'idle'; ui.percent = 0; } };

  KB.updates = { open, banner, mount, reset, ui };

  document.addEventListener('DOMContentLoaded', () => {
    $('clLater').addEventListener('click', () => $('changelog').close());
    window.kb.onUpdate('progress', (p) => {
      if (p.stage === 'downloading') setPhase('downloading', p.percent);
      else if (p.stage === 'ready') { ui.busy = false; setPhase('ready'); }
      else if (p.stage === 'error') { ui.busy = false; setPhase('error'); }
    });
    window.kb.onUpdate('available', (r) => banner(r));
    window.kb.onUpdate('show', (r) => open(r, 'available'));
    KB.onSettingsChanged(() => hosts.forEach(draw));
  });
})();
