'use strict';
// Restore: Windows restore points (list, create, open System Restore) and the rollback of the CPU tuning
// (startup task, INI backup, optionally VBS).
(function () {
  const { $, t } = KB;
  let busy = false;

  const when = (iso) => (iso ? new Date(iso).toLocaleString(KB.lang === 'pt-BR' ? 'pt-BR' : 'en') : '');

  function renderPoints(points, admin) {
    const host = $('rpList'); host.textContent = '';
    if (!admin || !points.length) {
      const p = document.createElement('p'); p.className = 'muted';
      p.textContent = t(admin ? 'restore.points.none' : 'restore.points.needsAdmin');
      host.appendChild(p); return;
    }
    points.forEach((x) => {
      const row = document.createElement('div'); row.className = 'rp-row';
      const left = document.createElement('span');
      const name = document.createElement('strong'); name.textContent = x.description || '#' + x.id;
      const kind = document.createElement('span'); kind.className = 'chip'; kind.textContent = t(`restore.points.type.${x.type}`);
      left.append(name, ' ', kind);
      const date = document.createElement('span'); date.className = 'muted'; date.textContent = when(x.created);
      row.append(left, date); host.appendChild(row);
    });
  }

  function setBusy(v) { busy = v; $('rpCreate').disabled = v; $('rpOpen').disabled = v; }

  async function loadPoints() {
    const res = await window.kb.runStep('restore-list', {});
    const d = res.data || { admin: false, points: [] };
    renderPoints(d.points || [], d.admin !== false);
  }

  async function createPoint() {
    if (busy) return;
    setBusy(true); KB.showResult($('rpResult'), '', '');
    const res = await window.kb.runStep('restore-create', { restoreName: $('rpName').value.trim() || 'KafkaBoost' });
    setBusy(false);
    // "skipped" is a normal Windows answer (one point per 24 h), not an error
    KB.showResult($('rpResult'), res.ok && res.data && res.data.created ? 'ok' : (res.ok ? 'warn' : 'fail'), KB.message(res) || t('common.failed'));
    if (res.ok) $('rpName').value = '';
    await loadPoints();
  }

  async function rollback() {
    if (!window.confirm(t('restore.confirm'))) return;
    $('rollback').disabled = true;
    const res = await window.kb.runStep('rollback', { restoreVbs: $('restoreVbs').checked });
    $('rollback').disabled = false;
    KB.resetWizard(); KB.state.health = null;
    KB.showResult($('restoreResult'), res.ok ? 'ok' : 'fail', res.ok ? t('restore.done', { items: (res.data || []).join('; ') }) : KB.message(res));
  }

  KB.registerView('restore', { onShow() { loadPoints(); } });
  document.addEventListener('DOMContentLoaded', () => {
    $('rollback').addEventListener('click', rollback);
    $('rpCreate').addEventListener('click', createPoint);
    $('rpOpen').addEventListener('click', () => window.kb.runStep('restore-open', {}));
  });
  KB.onSettingsChanged(() => { if (!busy && !$('restore').hidden) loadPoints(); });
})();
