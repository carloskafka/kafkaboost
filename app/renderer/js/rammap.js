'use strict';
// Memory cleanup with RAMMap (opened from the Optimizations card). The work is done by scripts/lib/Rammap.ps1 through the rammap-* steps;
// what each part shows comes from js/rammaplogic.js. RAMMap is downloaded only after the user ticks the box and clicks the button.
// We only ever show numbers we measured ourselves (Windows memory counters before and after). Everything is written with textContent.
(function () {
  const { $, t } = KB;
  const L = window.KBRammap;

  let data = null;          // rammap-state data
  let history = [];
  let busy = false;

  function kvTable(host, rows) {
    host.textContent = '';
    rows.forEach(([k, v]) => {
      const tr = document.createElement('tr');
      const a = document.createElement('td'); a.textContent = k;
      const b = document.createElement('td'); b.textContent = v;
      tr.append(a, b); host.appendChild(tr);
    });
  }

  function render() {
    const m = L.screenModel(data, busy);
    $('rammapGet').hidden = !m.showDownload;
    $('rammapActionsCard').hidden = !m.showActions && !m.badSignature;
    $('rammapDownload').disabled = !m.downloadEnabled || !$('rammapAgree').checked;
    $('rammapAgree').disabled = busy;
    const st = $('rammapStatus');
    st.textContent = m.installed ? (m.signerOk ? t('rammap.status.ready') : t('rammap.status.badSignature')) : t('rammap.status.missing');
    st.className = 'chip status ' + (m.installed ? (m.signerOk ? 'ok' : 'bad') : '');
    if (data) {
      $('rammapGetText').textContent = t('rammap.get.text', { source: data.source || '', signer: data.signer || '', license: data.license || '' });
    }
    kvTable($('rammapMem'), L.memoryRows(data && data.memory).map((r) => [t(`rammap.mem.${r.key}`), r.value]));

    const host = $('rammapActions'); host.textContent = '';
    if (m.badSignature) {
      const p = document.createElement('p'); p.className = 'muted'; p.textContent = t('rammap.badSignature'); host.appendChild(p);
    }
    m.actions.forEach((a) => {
      const row = document.createElement('div'); row.className = 'clean-row rammap-row';
      const txt = document.createElement('div'); txt.className = 'grow';
      const h = document.createElement('strong'); h.textContent = t(a.titleKey);
      const p = document.createElement('div'); p.className = 'muted'; p.textContent = t(a.descKey);
      txt.append(h, p);
      const risk = document.createElement('span'); risk.className = 'chip risk-' + a.risk; risk.textContent = t(`opt.level.${a.risk}`);
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn small'; btn.textContent = t('rammap.actions.run'); btn.disabled = !a.enabled;
      btn.addEventListener('click', () => runAction(a));
      row.append(txt, risk, btn); host.appendChild(row);
    });

    const hist = L.totals(history);
    $('rammapHistoryCard').hidden = !history.length;
    $('rammapTotals').textContent = history.length ? t('rammap.history.totals', { runs: hist.runs, released: L.formatBytes(hist.releasedStandbyBytes), measured: hist.measured }) : '';
    const rows = [[t('rammap.history.when'), `${t('rammap.history.action')} · ${t('rammap.history.standby')} · ${t('rammap.history.available')} · ${t('rammap.history.modified')}`]];
    history.slice(0, 20).forEach((rec) => {
      const r = L.historyRow(rec);
      let when = r.time; try { when = new Date(r.time).toLocaleString(); } catch { /* keep raw */ }
      rows.push([when, `${t(`rammap.action.${r.action}.title`)} · ${r.standby} · ${r.available} · ${r.modified}`]);
    });
    kvTable($('rammapHistory'), rows);
  }

  async function load() {
    const res = await window.kb.runStep('rammap-state', {});
    if (!res.ok || !res.data) { KB.showResult($('rammapResult'), 'fail', KB.message(res) || t('common.failed')); return; }
    data = res.data;
    history = [];
    if (data.state && data.state.installed) {
      const h = await window.kb.runStep('rammap-history', {});
      if (h.ok && h.data && Array.isArray(h.data.history)) history = h.data.history;
    }
    render();
  }

  async function download() {
    if (!$('rammapAgree').checked) return;
    busy = true; render(); KB.showResult($('rammapGetResult'), '', '');
    const res = await window.kb.runStep('rammap-get', { download: true });
    busy = false;
    KB.showResult($('rammapGetResult'), res.ok ? 'ok' : 'fail', KB.message(res) || t(res.ok ? 'rammap.get.done' : 'common.failed'));
    await load();
  }

  async function runAction(a) {
    if (busy) return;
    const ok = await KB.confirm({
      title: t(a.titleKey),
      paragraphs: [t(a.descKey), t(a.risk === 'safe' ? 'rammap.confirm.safe' : 'rammap.confirm.advanced'), t('rammap.confirm.noPromise')],
      ok: t('rammap.actions.run'), danger: false
    });
    if (!ok) return;
    busy = true; render(); KB.showResult($('rammapResult'), '', '');
    const res = await window.kb.runStep('rammap-run', { rammapAction: a.id });
    busy = false;
    if (res.ok && res.data && res.data.delta) {
      const d = res.data.delta;
      KB.showResult($('rammapResult'), 'ok', t('rammap.done', {
        action: t(a.titleKey), standby: L.formatDelta(d.standbyBytes), available: L.formatDelta(d.availableBytes), modified: L.formatDelta(d.modifiedBytes)
      }));
    } else KB.showResult($('rammapResult'), 'fail', KB.message(res) || t('common.failed'));
    await load();
  }

  KB.registerView('rammap', { onShow() { load(); } });
  document.addEventListener('DOMContentLoaded', () => {
    $('openRammap').addEventListener('click', () => KB.showView('rammap'));
    $('backFromRammap').addEventListener('click', () => KB.showView('optimizations'));
    $('rammapAgree').addEventListener('change', render);
    $('rammapDownload').addEventListener('click', download);
    $('rammapRefresh').addEventListener('click', load);
  });
  KB.onSettingsChanged(() => { if (data && !$('rammap').hidden) render(); });
})();
