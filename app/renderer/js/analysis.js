'use strict';
// System analysis: a read-only list of what this computer is.
(function () {
  const { $, t, setText } = KB;
  let data = null;

  const row = (dl, key, value) => {
    const dt = document.createElement('dt'); dt.textContent = t(key);
    const dd = document.createElement('dd'); dd.textContent = value;
    dl.append(dt, dd);
  };

  function render() {
    const dl = $('specs'); dl.textContent = '';
    if (!data) return;
    if (data.windows) {                                   // Windows: details from the PowerShell "detect" step
      const d = data.windows;
      row(dl, 'analysis.spec.computer', [d.manufacturer, d.model].filter(Boolean).join(' '));
      row(dl, 'analysis.spec.cpu', d.cpu);
      row(dl, 'analysis.spec.gpu', d.gpu || t('common.unknown'));
      row(dl, 'analysis.spec.ram', d.ramGB ? d.ramGB + ' GB' : t('common.unknown'));
      row(dl, 'analysis.spec.windows', d.osVersion);
      row(dl, 'analysis.spec.power', d.powerPlan || t('common.unknown'));
      row(dl, 'analysis.spec.vbs', t(d.hypervisorPresent ? 'analysis.vbs.on' : 'analysis.vbs.off'));
      row(dl, 'analysis.spec.ts', t(d.throttleStopFound ? (d.throttleStopRunning ? 'analysis.ts.running' : 'analysis.ts.stopped') : 'analysis.ts.none'));
      row(dl, 'analysis.spec.task', t(d.taskInstalled ? 'analysis.task.yes' : 'analysis.task.no'));
    } else {                                              // macOS / Linux: what Node can tell us
      const i = KB.state.info;
      row(dl, 'analysis.spec.windows', `${i.osName} (${i.osRelease})`);
      row(dl, 'analysis.spec.cpu', `${i.cpu} · ${i.cores}`);
      row(dl, 'analysis.spec.ram', i.ramGB + ' GB');
    }
  }

  async function run() {
    const btn = $('analyze'); btn.disabled = true; KB.showResult($('analysisResult'), '', '');
    if (!KB.featureOn('optimizations')) { data = { windows: null }; render(); btn.disabled = false; return; }
    KB.refreshing($('specs'), true);
    let res = null;
    try { res = await KB.getHardware(); } catch { res = null; } finally { KB.refreshing($('specs'), false); btn.disabled = false; }
    if (!res) { KB.showResult($('analysisResult'), 'fail', t('common.failed')); return; }
    if (res.data) { data = { windows: res.data }; render(); }
    KB.showResult($('analysisResult'), res.ok ? (res.data && !res.data.modelVerified ? 'warn' : 'ok') : 'fail', KB.message(res));
  }

  KB.registerView('analysis', {
    onShow() {
      if (data) return;
      const last = KB.featureOn('optimizations') ? KB.lastGet('detect') : null;     // the last answer at once, refreshed below
      if (last) { data = { windows: last.v }; render(); } else KB.skeleton($('specs'), 8);
      run();
    }
  });
  document.addEventListener('DOMContentLoaded', () => {
    // a re-run asks again instead of reusing the shared answer
    $('analyze').addEventListener('click', () => { KB.getHardware.reset(); run(); });
    KB.onSettingsChanged(render);
  });
})();
