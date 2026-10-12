'use strict';
// Restore: roll the CPU tuning back (startup task, INI backup, optionally VBS).
(function () {
  const { $, t } = KB;

  async function rollback() {
    if (!window.confirm(t('restore.confirm'))) return;
    $('rollback').disabled = true;
    const res = await window.kb.runStep('rollback', { restoreVbs: $('restoreVbs').checked });
    $('rollback').disabled = false;
    KB.resetWizard(); KB.state.health = null;
    KB.showResult($('restoreResult'), res.ok ? 'ok' : 'fail', res.ok ? t('restore.done', { items: (res.data || []).join('; ') }) : KB.message(res));
  }

  document.addEventListener('DOMContentLoaded', () => { $('rollback').addEventListener('click', rollback); });
})();
