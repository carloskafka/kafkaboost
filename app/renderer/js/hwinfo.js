'use strict';
// Dashboard card "Live telemetry source (HWiNFO)": shows whether HWiNFO is installed and sharing sensors, and lets the user get it (after
// reading what will be downloaded and agreeing), start it sensors-only, or stop it. The Dashboard tiles read HWiNFO shared memory.
// Everything is written with textContent. The download itself, the signature check and the INI handling live in scripts/lib/Hwinfo.ps1.
(function () {
  const { $, t } = KB;
  const L = window.KBHwinfo;
  const REFRESH_AFTER_START_MS = 4000;

  let state = null;        // hwinfo-state data
  let release = null;      // hwinfo-check data: { version, url, signer, license } once the user asked what would be downloaded
  let busy = false;

  const ui = () => ({
    release, busy, admin: !!(KB.state.info && KB.state.info.isAdmin),
    consent: $('hwConsent').checked, iniConsent: $('hwIniConsent').checked
  });

  function render() {
    const card = $('hwCard');
    const on = KB.featureOn('optimizations') && !!state;
    card.hidden = !on;
    if (!on) return;
    const m = L.cardModel(state, ui());
    $('hwStatus').textContent = t(m.status);
    $('hwSource').textContent = m.sourceKey ? t(m.sourceKey, { dir: state.dir || '', version: state.version || '' }) : '';
    $('hwGet').hidden = !m.showGet;
    if (release) {
      $('hwRelease').textContent = t('hwinfo.get.release', { version: release.version, url: release.url, signer: release.signer });
      $('hwDetails').textContent = t('hwinfo.get.details', { signer: release.signer, dir: (state.installRoot || '%ProgramData%\\LegionTuning\\hwinfo') + '\\' + release.version, license: release.license });
      $('hwConsentText').textContent = t('hwinfo.get.consent', { version: release.version });
    }
    $('hwIniRow').hidden = !m.needsIni;
    $('hwCheck').hidden = !m.showCheck; $('hwCheck').disabled = !m.checkEnabled;
    $('hwGetBtn').hidden = !m.showGet; $('hwGetBtn').disabled = !m.getEnabled;
    $('hwPick').hidden = !(m.showCheck || m.showGet); $('hwPick').disabled = busy;
    $('hwStart').hidden = !m.showStart; $('hwStart').disabled = !m.startEnabled;
    $('hwStop').hidden = !m.showStop; $('hwStop').disabled = !m.stopEnabled;
    const needAdmin = (m.showGet || m.showStart || m.showStop) && !ui().admin;
    $('hwNote').textContent = needAdmin ? t('hwinfo.needsAdmin') : '';
  }

  const show = (kind, text) => KB.showResult($('hwResult'), kind, text);

  async function loadState() {
    const res = await window.kb.runStep('hwinfo-state', {});
    if (!res.ok || !res.data) { show('fail', KB.message(res) || t('common.failed')); return; }
    state = res.data;
    if (state.installed) release = null;
    render();
  }

  async function check() {
    if (busy) return;
    busy = true; render(); show('warn', t('hwinfo.checking'));
    const res = await window.kb.runStep('hwinfo-check', {});
    busy = false;
    if (!res.ok || !res.data) { show('fail', KB.message(res) || t('common.failed')); render(); return; }
    release = res.data; show('', ''); render();
  }

  async function install(zipPath) {
    if (busy) return;
    if (!zipPath && !$('hwConsent').checked) return;
    busy = true; render(); show('warn', t('hwinfo.get.working'));
    const opts = zipPath ? { zipPath } : { download: true, hwinfoVersion: release && release.version };
    const res = await window.kb.runStep('hwinfo-get', opts);
    busy = false;
    if (!res.ok) { show('fail', KB.message(res) || t('common.failed')); render(); return; }
    $('hwConsent').checked = false; release = null; show('ok', KB.message(res));
    await loadState();
  }

  async function pick() {
    const zip = await window.kb.pickZip();
    if (zip) install(zip);
  }

  async function start() {
    if (busy) return;
    busy = true; render(); show('warn', t('hwinfo.starting'));
    const res = await window.kb.runStep('hwinfo-start', { updateIni: $('hwIniConsent').checked });
    busy = false;
    if (!res.ok) { show('fail', KB.message(res) || t('common.failed')); await loadState(); return; }
    show('ok', KB.message(res));
    await loadState();
    if (res.code === 'msg.hwinfo.started') setTimeout(async () => { await loadState(); if (KB.runHealth && !document.hidden) KB.runHealth(); }, REFRESH_AFTER_START_MS);
  }

  async function stop() {
    if (busy) return;
    busy = true; render(); show('warn', t('hwinfo.stopping'));
    const res = await window.kb.runStep('hwinfo-stop', {});
    busy = false;
    show(res.ok ? 'ok' : 'fail', KB.message(res));
    await loadState();
    if (KB.runHealth && !document.hidden) KB.runHealth();
  }

  KB.hwinfoRefresh = loadState;

  document.addEventListener('DOMContentLoaded', () => {
    $('hwCheck').addEventListener('click', check);
    $('hwGetBtn').addEventListener('click', () => install(null));
    $('hwPick').addEventListener('click', pick);
    $('hwStart').addEventListener('click', start);
    $('hwStop').addEventListener('click', stop);
    $('hwConsent').addEventListener('change', render);
    $('hwIniConsent').addEventListener('change', render);
  });
  KB.onSettingsChanged(() => render());
})();
