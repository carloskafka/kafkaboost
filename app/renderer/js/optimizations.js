'use strict';
// Optimizations: the tweak catalog. Search, category chips, toggle cards, confirmations by risk tier.
// Texts come from i18n (tweak.<id>.title/desc); behaviour comes from the PowerShell step results.
(function () {
  const { $, t } = KB;
  const ALL = 'all';
  let tweaks = [], admin = true, cat = ALL, query = '', busy = false;

  // ---- confirmation dialog (promise based) ----------------------------------------------------------------------
  KB.confirm = ({ title, paragraphs, ok, danger }) => new Promise((resolve) => {
    $('cfTitle').textContent = title;
    const body = $('cfBody'); body.textContent = '';
    paragraphs.forEach((p) => { const el = document.createElement('p'); el.textContent = p; body.appendChild(el); });
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
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = x.status === 'active'; cb.disabled = busy || x.status === 'unavailable';
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
    $('tweakRecommended').disabled = busy || !tweaks.length;
    if (tweaks.length && !shown.length) $('tweakSummary').textContent = t('tweaks.none');
  }

  async function load() {
    if (!KB.featureOn('optimizations')) return;
    const res = await window.kb.runStep('tweaks-list', {});
    if (!res.ok || !res.data) { KB.showResult($('tweakResult'), 'fail', KB.message(res) || t('common.failed')); return; }
    tweaks = res.data.tweaks; admin = !!res.data.admin;
    KB.state.tweaks = tweaks;
    render();
  }

  async function toggle(x, cb) {
    const enable = cb.checked;
    cb.checked = !enable;                                   // the real state is applied after the script answers
    if (enable) {
      if (x.risk === 'advanced') {
        const ok = await KB.confirm({ title: title(x.id), paragraphs: [desc(x.id), t('tweaks.confirmAdvanced')], ok: t('tweaks.apply') });
        if (!ok) return;
      }
      if (x.risk === 'risky') {
        const first = await KB.confirm({ title: title(x.id), paragraphs: [desc(x.id), t('tweaks.riskyWarn1'), t('tweaks.riskyWarn2')], ok: t('tweaks.riskyContinue'), danger: true });
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
    const base = KB.message(res) || t('common.failed');
    const extra = res.ok && x.needsReboot ? ' ' + t('tweaks.rebootNow') : '';
    KB.showResult($('tweakResult'), res.ok ? 'ok' : 'fail', `${title(x.id)}: ${base}${extra}`);
    await load();
  }

  // "Apply recommended" for any screen (Optimizations and the Dashboard): lists what will change, asks, then runs the tweaks-recommended
  // step (restore point first, safe tweaks only). Resolves { status: 'none' | 'cancelled' | 'done', res }.
  KB.applyRecommended = async (list) => {
    const todo = (list || tweaks).filter((x) => x.risk === 'safe' && x.recommended && x.status === 'inactive');
    if (!todo.length) return { status: 'none' };
    const ok = await KB.confirm({ title: t('tweaks.recommended'), paragraphs: [t('tweaks.recommendedBody', { count: todo.length }), ...todo.map((x) => '• ' + title(x.id)), t('tweaks.recommendedNote')], ok: t('tweaks.apply') });
    if (!ok) return { status: 'cancelled' };
    return { status: 'done', res: await window.kb.runStep('tweaks-recommended', {}) };
  };

  async function applyRecommended() {
    if (!tweaks.some((x) => x.risk === 'safe' && x.recommended && x.status === 'inactive')) { KB.showResult($('tweakResult'), 'ok', t('tweaks.recommendedNone')); return; }
    busy = true; render(); KB.showResult($('tweakResult'), '', '');
    const r = await KB.applyRecommended();
    busy = false;
    if (r.status === 'done') KB.showResult($('tweakResult'), r.res.ok ? 'ok' : 'warn', KB.message(r.res));
    await load();
  }

  KB.registerView('optimizations', { onShow() { if (KB.renderOptStatus) KB.renderOptStatus(); load(); } });
  document.addEventListener('DOMContentLoaded', () => {
    $('tweakSearch').addEventListener('input', () => { query = $('tweakSearch').value.trim(); render(); });
    $('tweakRecommended').addEventListener('click', applyRecommended);
  });
  KB.onSettingsChanged(() => { if (tweaks.length) render(); });
})();
