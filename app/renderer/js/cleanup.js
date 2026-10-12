'use strict';
// Cleanup: sizes first (dry run), then delete only what the user ticked. The Recycle Bin is irreversible: it is
// never ticked by default and needs a second confirmation.
(function () {
  const { $, t } = KB;
  let targets = [], busy = false;
  const checked = new Set();

  const fmt = (bytes) => {
    if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(2) + ' GB';
    if (bytes >= 1024 ** 2) return (bytes / 1024 ** 2).toFixed(1) + ' MB';
    if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
    return bytes + ' B';
  };

  function renderLast() {
    const last = KB.settings && KB.settings.lastCleanup;
    $('cleanLast').textContent = last
      ? t('cleanup.last', { when: new Date(last).toLocaleString(KB.lang === 'pt-BR' ? 'pt-BR' : 'en') })
      : t('cleanup.never');
  }

  function render() {
    const host = $('cleanList'); host.textContent = '';
    targets.forEach((x) => {
      const row = document.createElement('label'); row.className = 'clean-row' + (x.danger ? ' danger' : ''); row.dataset.id = x.id;
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = checked.has(x.id); cb.disabled = busy;
      cb.addEventListener('change', () => { if (cb.checked) checked.add(x.id); else checked.delete(x.id); updateTotals(); });
      const text = document.createElement('span'); text.className = 'clean-text';
      const name = document.createElement('strong'); name.textContent = t(`cleanup.${x.id}.title`);
      const hint = document.createElement('span'); hint.className = 'muted'; hint.textContent = t(`cleanup.${x.id}.desc`);
      text.append(name, hint);
      if (x.danger) { const w = document.createElement('span'); w.className = 'chip risk-risky'; w.textContent = t('cleanup.permanent'); text.append(w); }
      const size = document.createElement('span'); size.className = 'clean-size'; size.textContent = fmt(x.bytes) + ' · ' + t('cleanup.files', { count: x.files });
      row.append(cb, text, size); host.appendChild(row);
    });
    updateTotals(); renderLast();
  }

  function updateTotals() {
    const sel = targets.filter((x) => checked.has(x.id));
    const bytes = sel.reduce((s, x) => s + x.bytes, 0);
    $('cleanSelected').textContent = sel.length ? t('cleanup.selected', { size: fmt(bytes) }) : t('cleanup.nothingSelected');
    $('cleanRun').disabled = busy || !sel.length;
    $('cleanScan').disabled = busy;
  }

  async function scan() {
    busy = true; updateTotals(); KB.showResult($('cleanResult'), '', '');
    const res = await window.kb.runStep('cleanup-scan', {});
    busy = false;
    if (!res.ok || !res.data) { KB.showResult($('cleanResult'), 'fail', KB.message(res) || t('common.failed')); updateTotals(); return; }
    targets = res.data.targets;
    // default selection: every safe target that holds something; the Recycle Bin never starts ticked
    checked.clear(); targets.forEach((x) => { if (!x.danger && x.bytes > 0) checked.add(x.id); });
    render();
  }

  async function run() {
    const sel = targets.filter((x) => checked.has(x.id));
    if (!sel.length) return;
    const paragraphs = [t('cleanup.confirmBody'), ...sel.map((x) => '• ' + t(`cleanup.${x.id}.title`) + ' (' + fmt(x.bytes) + ')')];
    if (!(await KB.confirm({ title: t('cleanup.run'), paragraphs, ok: t('cleanup.run') }))) return;
    if (sel.some((x) => x.danger)) {
      const ok = await KB.confirm({ title: t('cleanup.binTitle'), paragraphs: [t('cleanup.binWarn')], ok: t('cleanup.binOk'), danger: true });
      if (!ok) return;
    }
    busy = true; updateTotals(); KB.showResult($('cleanResult'), '', '');
    const res = await window.kb.runStep('cleanup-run', { cleanupIds: sel.map((x) => x.id).join(',') });
    busy = false;
    KB.showResult($('cleanResult'), res.ok ? 'ok' : 'fail', KB.message(res) || t('common.failed'));
    if (res.ok) await KB.saveSetting({ lastCleanup: new Date().toISOString() });
    await scan();
  }

  KB.registerView('cleanup', { onShow() { if (!targets.length) scan(); else renderLast(); } });
  document.addEventListener('DOMContentLoaded', () => {
    $('cleanScan').addEventListener('click', scan);
    $('cleanRun').addEventListener('click', run);
  });
  KB.onSettingsChanged(() => { if (targets.length) render(); });
})();
