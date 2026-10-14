'use strict';
// Optimizations: the tweak catalog. Search, category chips, toggle cards, confirmations by risk tier.
// Texts come from i18n (tweak.<id>.title/desc); behaviour comes from the PowerShell step results.
(function () {
  const { $, t } = KB;
  const ALL = 'all';
  let tweaks = [], admin = true, cat = ALL, query = '', busy = false, loading = false;
  const dropCache = () => KB.lastDrop('tweaks');   // the last known list (shared with the Dashboard) is shown at once; never trusted for changes

  // ---- confirmation dialog (promise based) ----------------------------------------------------------------------
  // `blocks` (optional) are the detailed blocks of KBTweakPreview.buildBlocks: h, p, meta and mono (a monospace block). Everything is
  // rendered with textContent. The body scrolls, and `wide` gives the monospace lines more room.
  KB.confirm = ({ title, paragraphs = [], blocks = [], ok, danger, wide }) => new Promise((resolve) => {
    $('cfTitle').textContent = title;
    const body = $('cfBody'); body.textContent = ''; body.scrollTop = 0;
    $('confirmDlg').classList.toggle('wide', !!wide);
    paragraphs.forEach((p) => { const el = document.createElement('p'); el.textContent = p; body.appendChild(el); });
    const TAG = { h: 'h4', p: 'p', meta: 'p', mono: 'pre' };
    blocks.forEach((b) => { const el = document.createElement(TAG[b.kind] || 'p'); el.className = 'cf-' + b.kind; el.textContent = b.text; body.appendChild(el); });
    const okBtn = $('cfOk'); okBtn.textContent = ok; okBtn.className = 'btn small ' + (danger ? 'danger-fill' : 'primary');
    const dlg = $('confirmDlg');
    let settled = false;
    const onClose = () => { if (!dlg.open) finish(false); };   // Esc (a stale close event from the previous dialog arrives while this one is open: ignore it)
    const finish = (v) => { if (settled) return; settled = true; okBtn.onclick = null; $('cfCancel').onclick = null; dlg.removeEventListener('close', onClose); resolve(v); };
    okBtn.onclick = () => { finish(true); dlg.close(); };
    $('cfCancel').onclick = () => { finish(false); dlg.close(); };
    dlg.addEventListener('close', onClose);
    dlg.showModal();
  });

  const title = (id) => t(`tweak.${id}.title`);
  const desc = (id) => t(`tweak.${id}.desc`);
  const notice = (id) => { const k = `tweak.${id}.notice`; const v = t(k); return v === k ? '' : v; };

  // Read-only preview of what the given tweaks would change on this PC (the tweak-preview step). Resolves detailed dialog blocks,
  // or null when the values could not be read (the caller then falls back to names only and says so).
  async function previewBlocks(ids, { intro, closing }) {
    let res = null;
    try { res = await window.kb.runStep('tweak-preview', { tweakIds: ids.join(',') }); } catch { res = null; }
    const list = res && res.ok && res.data && Array.isArray(res.data.tweaks) ? res.data.tweaks : null;
    if (!list || !list.length) return null;
    return {
      count: list.length,
      blocks: KBTweakPreview.buildBlocks(list, {
        t, title, desc, notice, appAdmin: !!res.data.admin, intro: intro ? intro(list.length) : '', closing,
        riskLabel: (r) => t(`opt.level.${r}`)
      })
    };
  }
  const matches = (x) => {
    if (cat !== ALL && x.category !== cat) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    return title(x.id).toLowerCase().includes(q) || desc(x.id).toLowerCase().includes(q);
  };

  function renderChips() {
    const host = $('tweakChips'); host.textContent = '';
    const cats = [ALL, ...new Set(tweaks.map((x) => x.category))];
    cats.forEach((c) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'chip-btn' + (c === cat ? ' active' : '');
      b.dataset.cat = c; b.textContent = t(`tweak.cat.${c}`); b.addEventListener('click', () => { cat = c; render(); });
      host.appendChild(b);
    });
  }

  function card(x) {
    const el = document.createElement('article'); el.className = 'tweak' + (x.status === 'unavailable' ? ' unavailable' : ''); el.dataset.id = x.id;
    const top = document.createElement('div'); top.className = 'tweak-top';
    const risk = document.createElement('span'); risk.className = 'chip risk-' + x.risk; risk.textContent = t(`opt.level.${x.risk}`);
    const grow = document.createElement('span'); grow.className = 'grow';
    top.append(risk, grow);
    if (x.status === 'partial') { const p = document.createElement('span'); p.className = 'chip'; p.textContent = t('tweaks.partial'); top.append(p); }
    const sw = document.createElement('label'); sw.className = 'switch';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = x.status === 'active'; cb.disabled = busy || loading || x.status === 'unavailable';
    cb.setAttribute('aria-label', title(x.id));
    const sl = document.createElement('span'); sl.className = 'slider'; sw.append(cb, sl);
    cb.addEventListener('change', () => toggle(x, cb));
    top.append(sw);
    const h = document.createElement('h3'); h.textContent = title(x.id);
    const p = document.createElement('p'); p.textContent = desc(x.id);
    el.append(top, h, p);
    const notes = [];
    if (x.status === 'unavailable') notes.push(t('tweaks.unavailable'));
    if (x.needsReboot) notes.push(t('tweaks.reboot'));
    if (x.needsAdmin && !admin) notes.push(t('tweaks.needsAdmin'));
    if (notes.length) { const n = document.createElement('div'); n.className = 'note'; n.textContent = notes.join(' · '); el.append(n); }
    return el;
  }

  function render() {
    renderChips();
    const grid = $('tweakGrid'); grid.textContent = '';
    const shown = tweaks.filter(matches);
    shown.forEach((x) => grid.appendChild(card(x)));
    const avail = tweaks.filter((x) => x.status !== 'unavailable');
    const on = avail.filter((x) => x.status === 'active').length;
    $('tweakSummary').textContent = tweaks.length ? t('tweaks.summary', { on, total: avail.length, shown: shown.length }) : '';
    $('tweakRecommended').disabled = busy || loading || !tweaks.length;
    if (tweaks.length && !shown.length) $('tweakSummary').textContent = t('tweaks.none');
  }

  async function load() {
    if (!KB.featureOn('optimizations')) return;
    const grid = $('tweakGrid');
    if (!tweaks.length) {
      const c = KB.lastGet('tweaks');
      if (c && c.v && Array.isArray(c.v.tweaks) && c.v.tweaks.length) { tweaks = c.v.tweaks; admin = !!c.v.admin; loading = true; render(); } else KB.skeleton(grid, 6);
    }
    KB.refreshing(grid, true);
    let res;
    try { res = await window.kb.runStep('tweaks-list', {}); } finally { loading = false; KB.refreshing(grid, false); }
    if (!res.ok || !res.data) { if (!tweaks.length) grid.textContent = ''; KB.showResult($('tweakResult'), 'fail', KB.message(res) || t('common.failed')); return; }
    tweaks = res.data.tweaks; admin = !!res.data.admin;
    KB.state.tweaks = tweaks;
    KB.lastSet('tweaks', { tweaks, admin });
    render();
  }

  async function toggle(x, cb) {
    const enable = cb.checked;
    cb.checked = !enable;                                   // the real state is applied after the script answers
    if (enable) {
      // the same exact-changes detail as in Apply recommended; the existing confirmations are kept as they were
      const pv = x.risk === 'safe' ? null : await previewBlocks([x.id], { closing: [] });
      const detail = pv ? { blocks: pv.blocks.slice(2), wide: true } : {};   // without the heading and the description: the dialog already shows those
      if (x.risk === 'advanced') {
        const ok = await KB.confirm({ title: title(x.id), paragraphs: [desc(x.id), t('tweaks.confirmAdvanced')], ok: t('tweaks.apply'), ...detail });
        if (!ok) return;
      }
      if (x.risk === 'risky') {
        const first = await KB.confirm({ title: title(x.id), paragraphs: [desc(x.id), t('tweaks.riskyWarn1'), t('tweaks.riskyWarn2')], ok: t('tweaks.riskyContinue'), danger: true, ...detail });
        if (!first) return;
        const second = await KB.confirm({ title: t('tweaks.finalTitle'), paragraphs: [t('tweaks.finalBody', { name: title(x.id) })], ok: t('tweaks.riskyApply'), danger: true });
        if (!second) return;
      }
    }
    await run(x, enable);
  }

  async function run(x, enable) {
    busy = true; render(); KB.showResult($('tweakResult'), '', '');
    const res = await window.kb.runStep('tweak-set', { tweakId: x.id, tweakMode: enable ? 'on' : 'off', allowRisky: x.risk === 'risky' });
    busy = false;
    dropCache();                                            // the state changed: never leave the old list behind if the re-read below fails
    const base = KB.message(res) || t('common.failed');
    const extra = res.ok && x.needsReboot ? ' ' + t('tweaks.rebootNow') : '';
    KB.showResult($('tweakResult'), res.ok ? 'ok' : 'fail', `${title(x.id)}: ${base}${extra}`);
    await load();
  }

  // "Apply recommended" for any screen (Optimizations and the Dashboard): shows EXACTLY what will change (every tweak with what it does, what
  // you may notice and the registry values now/new/after turning off), asks, then runs the tweaks-recommended step (restore point first,
  // safe tweaks only). Resolves { status: 'none' | 'cancelled' | 'done', res }.
  KB.applyRecommended = async (list) => {
    const todo = (list || tweaks).filter((x) => x.risk === 'safe' && x.recommended && (x.status === 'inactive' || x.status === 'partial'));
    if (!todo.length) return { status: 'none' };
    const pv = await previewBlocks(todo.map((x) => x.id), { intro: (n) => t('tweaks.pv.intro', { count: n }), closing: [t('tweaks.pv.closing'), t('tweaks.pv.closing2')] });
    const dlg = pv
      ? { blocks: pv.blocks, wide: true }
      : { paragraphs: [t('tweaks.recommendedBody', { count: todo.length }), ...todo.map((x) => '• ' + title(x.id)), t('tweaks.pv.unavailable'), t('tweaks.pv.closing')] };
    const ok = await KB.confirm({ title: t('tweaks.recommended'), ok: t('tweaks.apply'), ...dlg });
    if (!ok) return { status: 'cancelled' };
    const res = await window.kb.runStep('tweaks-recommended', {});
    dropCache();
    if (KB.state.view !== 'optimizations') load().catch(() => {});   // started from the Dashboard: refresh the list (and its cache) in the background
    return { status: 'done', res };
  };

  async function applyRecommended() {
    if (!tweaks.some((x) => x.risk === 'safe' && x.recommended && (x.status === 'inactive' || x.status === 'partial'))) { KB.showResult($('tweakResult'), 'ok', t('tweaks.recommendedNone')); return; }
    busy = true; render(); KB.showResult($('tweakResult'), '', '');
    const r = await KB.applyRecommended();
    busy = false;
    if (r.status === 'done') KB.showResult($('tweakResult'), r.res.ok ? 'ok' : 'warn', KB.message(r.res));
    await load();
  }

  KB.loadTweaks = load;   // boot.js reads the list in the background so the page is ready when it is opened
  KB.registerView('optimizations', { onShow() { if (KB.renderOptStatus) KB.renderOptStatus(); load(); } });
  document.addEventListener('DOMContentLoaded', () => {
    $('tweakSearch').addEventListener('input', () => { query = $('tweakSearch').value.trim(); render(); });
    $('tweakRecommended').addEventListener('click', applyRecommended);
  });
  KB.onSettingsChanged(() => { if (tweaks.length) render(); });
})();
