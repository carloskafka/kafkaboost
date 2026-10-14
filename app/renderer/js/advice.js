'use strict';
// Dashboard "Boost clock advice": asks the read-only `advice` step (through the main process, which owns the history file) and shows
// the sentence. On demand here; the recordings it uses come from the play sessions (manual or automatic).
(function () {
  const { $, t, setText } = KB;
  const L = window.KBAdvice;

  function show(res) {
    const d = res && res.data ? L.describe(res.data) : null;
    $('advVerdict').hidden = false;
    if (!d) { $('advVerdict').className = 'result warn'; setText($('advVerdict'), t('dashboard.advice.failed')); $('advEvidence').hidden = true; return; }
    $('advVerdict').className = 'result ' + d.kind; setText($('advVerdict'), t(d.key, d.args));
    const ev = L.evidence(res.data);
    $('advEvidence').hidden = !ev; if (ev) setText($('advEvidence'), t('dashboard.advice.evidence', ev));
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('advAnalyze').addEventListener('click', async () => {
      $('advAnalyze').disabled = true;
      show(await window.kb.advice());
      $('advAnalyze').disabled = false;
    });
  });
  KB.renderAdvice = () => { $('advCard').hidden = !KB.featureOn('insights'); };
})();
