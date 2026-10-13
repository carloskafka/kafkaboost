'use strict';
// Apps: install and remove curated apps with the OS package manager (winget / Homebrew / Flatpak, apt, dnf, pacman),
// search the manager, export/import the installed list, and (Windows only) remove pre-installed Store apps from a
// fixed list. The page never builds commands: it only sends catalog ids or ids from search results to the main process.
(function () {
  const { $, t } = KB;
  const ALL = 'all';
  let info = null, apps = [], cat = ALL, busy = false, loaded = false, bloat = [];
  const pending = new Set();                      // app ids with an install/remove in progress

  const msg = (res) => {
    const base = KB.message(res) || t('common.failed');
    return res && res.detail ? base + ' ' + res.detail : base;
  };

  function setBusy(v) {
    busy = v;
    ['appsRefresh', 'appsExport', 'appsImport', 'appsSearchBtn'].forEach((id) => { $(id).disabled = v; });
  }

  // ---- catalog ----------------------------------------------------------------------------------------------------
  function renderChips() {
    const host = $('appsChips'); host.textContent = '';
    [ALL, ...new Set(apps.map((a) => a.category))].forEach((c) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'chip-btn' + (c === cat ? ' active' : '');
      b.dataset.cat = c; b.textContent = t(`apps.cat.${c}`); b.addEventListener('click', () => { cat = c; render(); });
      host.appendChild(b);
    });
  }

  function actionButton(label, onClick, kind) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn small' + (kind ? ' ' + kind : '');
    b.textContent = label; b.disabled = busy; b.addEventListener('click', onClick); return b;
  }

  function card(a) {
    const el = document.createElement('article'); el.className = 'tweak app-card' + (pending.has(a.appId) ? ' busy' : ''); el.dataset.id = a.appId;
    const top = document.createElement('div'); top.className = 'tweak-top';
    const chip = document.createElement('span'); chip.className = 'chip' + (a.installed ? ' installed' : ''); chip.textContent = a.installed ? t('apps.installed') : t(`apps.cat.${a.category}`);
    top.append(chip);
    const h = document.createElement('h3'); h.textContent = a.name;
    const p = document.createElement('p'); p.textContent = t(`apps.app.${a.appId}.desc`);
    const actions = document.createElement('div'); actions.className = 'app-actions';
    actions.append(a.installed
      ? actionButton(pending.has(a.appId) ? t('apps.removing') : t('apps.remove'), () => uninstall(a), 'danger-fill')
      : actionButton(pending.has(a.appId) ? t('apps.installing') : t('apps.install'), () => install(a), 'primary'));
    el.append(top, h, p, actions);
    return el;
  }

  function render() {
    const none = !info || !info.manager;
    $('appsMain').hidden = none; $('appsNone').hidden = !none;
    $('appsManager').textContent = none ? '' : t('apps.manager', { name: info.label });
    $('appsExport').disabled = busy || none; $('appsImport').disabled = busy || none;
    if (none) { $('appsNone').textContent = t(`apps.none.${(info && info.platform) || 'linux'}`); return; }
    renderChips();
    const grid = $('appsGrid'); grid.textContent = '';
    apps.filter((a) => cat === ALL || a.category === cat).forEach((a) => grid.appendChild(card(a)));
  }

  async function load() {
    setBusy(true);
    info = await window.kb.apps.info();
    if (info.manager) { const r = await window.kb.apps.list(); apps = r.apps || []; }
    loaded = true; setBusy(false); render();
    if (info.bloat) loadBloat(); else $('bloatCard').hidden = true;
  }

  async function install(a) { return act(a.appId, () => window.kb.apps.install({ appId: a.appId }), a.name); }

  async function uninstall(a) {
    const ok = await KB.confirm({ title: t('apps.removeTitle', { name: a.name }), paragraphs: [t('apps.removeBody', { name: a.name })], ok: t('apps.remove'), danger: true });
    if (ok) await act(a.appId, () => window.kb.apps.uninstall({ appId: a.appId }), a.name);
  }

  async function act(key, call, name) {
    if (busy) return;
    pending.add(key); setBusy(true); render(); KB.showResult($('appsResult'), '', '');
    const res = await call();
    pending.delete(key); setBusy(false);
    KB.showResult($('appsResult'), res.ok ? 'ok' : 'fail', msg(res));
    const r = await window.kb.apps.list(); apps = r.apps || apps;
    render();
    if (searchedFor) runSearch();
  }

  // ---- search (the manager's own catalog) -------------------------------------------------------------------------
  let searchedFor = '';
  async function runSearch() {
    const q = $('appsSearch').value.trim();
    const out = $('appsSearchOut');
    if (!q) { searchedFor = ''; out.hidden = true; out.textContent = ''; return; }
    setBusy(true);
    const res = await window.kb.apps.search(q);
    setBusy(false);
    if (!res.ok) { KB.showResult($('appsResult'), 'fail', msg(res)); return; }
    searchedFor = q; out.hidden = false; out.textContent = '';
    if (!res.results.length) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = t('apps.noResults'); out.append(p); return; }
    res.results.forEach((r) => {
      const row = document.createElement('div'); row.className = 'clean-row'; row.dataset.id = r.id;
      const text = document.createElement('span'); text.className = 'clean-text';
      const name = document.createElement('strong'); name.textContent = r.name;
      const sub = document.createElement('span'); sub.className = 'muted'; sub.textContent = [r.id, r.version].filter(Boolean).join(' · ');
      text.append(name, sub);
      const ref = { id: r.id, kind: r.kind || undefined };
      row.append(text, r.installed
        ? actionButton(t('apps.remove'), async () => { if (await KB.confirm({ title: t('apps.removeTitle', { name: r.name }), paragraphs: [t('apps.removeBody', { name: r.name })], ok: t('apps.remove'), danger: true })) act(r.id, () => window.kb.apps.uninstall(ref), r.name); }, 'danger-fill')
        : actionButton(t('apps.install'), () => act(r.id, () => window.kb.apps.install(ref), r.name), 'primary'));
      out.append(row);
    });
  }

  // ---- export / import --------------------------------------------------------------------------------------------
  async function exportList() {
    setBusy(true); KB.showResult($('appsResult'), '', '');
    const res = await window.kb.apps.exportList();
    setBusy(false); render();
    if (!res.canceled) KB.showResult($('appsResult'), res.ok ? 'ok' : 'fail', msg(res));
  }

  async function importList() {
    setBusy(true); KB.showResult($('appsResult'), '', '');
    const plan = await window.kb.apps.importPick();
    setBusy(false); render();
    if (plan.canceled) return;
    if (!plan.ok) { KB.showResult($('appsResult'), 'fail', msg(plan)); return; }
    if (!plan.items.length) { KB.showResult($('appsResult'), 'ok', t('apps.import.nothing', { already: plan.already, skipped: plan.skipped })); return; }
    const shown = plan.items.slice(0, 20).map((i) => '• ' + i.name + (i.name === i.id ? '' : ' (' + i.id + ')'));
    if (plan.items.length > 20) shown.push(t('apps.import.more', { count: plan.items.length - 20 }));
    const paragraphs = [t('apps.import.body', { count: plan.items.length }), ...shown];
    if (plan.skipped) paragraphs.push(t('apps.import.skipped', { count: plan.skipped }));
    if (!(await KB.confirm({ title: t('apps.import.title'), paragraphs, ok: t('apps.import.go') }))) return;
    setBusy(true); render();
    const res = await window.kb.apps.importRun(plan.items.map((i) => i.id));
    setBusy(false);
    KB.showResult($('appsResult'), res.ok ? 'ok' : 'fail', msg(res));
    const r = await window.kb.apps.list(); apps = r.apps || apps; render();
  }

  // ---- Windows bloatware remover ----------------------------------------------------------------------------------
  function renderBloat() {
    const card = $('bloatCard'); card.hidden = false;
    const host = $('bloatList'); host.textContent = '';
    if (!bloat.length) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = t('apps.bloat.none'); host.append(p); return; }
    bloat.forEach((b) => {
      const row = document.createElement('div'); row.className = 'clean-row'; row.dataset.id = b.id;
      const text = document.createElement('span'); text.className = 'clean-text';
      const name = document.createElement('strong'); name.textContent = t(`apps.bloat.${b.id}.name`);
      const hint = document.createElement('span'); hint.className = 'muted'; hint.textContent = t(`apps.bloat.${b.id}.desc`);
      text.append(name, hint);
      row.append(text, actionButton(t('apps.remove'), () => removeBloat(b), 'danger-fill'));
      host.append(row);
    });
  }

  async function loadBloat() { bloat = await window.kb.apps.bloatList(); renderBloat(); }

  async function removeBloat(b) {
    const name = t(`apps.bloat.${b.id}.name`);
    const ok = await KB.confirm({ title: t('apps.removeTitle', { name }), paragraphs: [t(`apps.bloat.${b.id}.desc`), t('apps.bloat.confirm', { name })], ok: t('apps.remove'), danger: true });
    if (!ok) return;
    setBusy(true); KB.showResult($('bloatResult'), '', '');
    const res = await window.kb.apps.bloatRemove(b.id);
    setBusy(false);
    KB.showResult($('bloatResult'), res.ok ? 'ok' : 'fail', msg(res));
    await loadBloat();
  }

  KB.registerView('apps', { onShow() { if (!loaded) load(); } });
  document.addEventListener('DOMContentLoaded', () => {
    $('appsRefresh').addEventListener('click', () => { loaded = false; load(); });
    $('appsExport').addEventListener('click', exportList);
    $('appsImport').addEventListener('click', importList);
    $('appsSearchBtn').addEventListener('click', runSearch);
    window.kb.apps.onProgress((p) => KB.showResult($('appsResult'), '', t('apps.import.progress', p)));
    $('appsSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); });
  });
  KB.onSettingsChanged(() => { if (loaded) { render(); if (bloat.length || (info && info.bloat)) renderBloat(); } });
})();
