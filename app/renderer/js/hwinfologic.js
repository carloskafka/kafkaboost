'use strict';
// Pure logic of the Dashboard "live telemetry source" card (HWiNFO on demand): which message and which buttons to show for a state
// returned by the hwinfo-state step. Shared by the page (window.KBHwinfo) and the node tests. No DOM, no Electron.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KBHwinfo = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const DOWNLOAD_PAGE = 'https://www.hwinfo.com/download/';

  // state: { installed, source: 'own'|'existing'|null, running, sharedMemory, ini: 'none'|'missing'|'ok'|'noSharedMemory' }
  // ui: { release: the object returned by hwinfo-check or null, admin: bool, busy: bool, consent: bool, iniConsent: bool }
  function cardModel(state, ui) {
    const s = state || {};
    const u = ui || {};
    const installed = !!s.installed;
    const running = !!s.running;
    let status;
    if (!installed) status = 'hwinfo.status.missing';
    else if (running && s.sharedMemory) status = 'hwinfo.status.live';
    else if (running) status = 'hwinfo.status.runningNoSm';
    else status = 'hwinfo.status.stopped';
    const needsIni = installed && s.ini === 'noSharedMemory';
    const release = u.release || null;
    return {
      status,
      sourceKey: installed ? (s.source === 'existing' ? 'hwinfo.source.existing' : 'hwinfo.source.own') : null,
      showCheck: !installed && !release,
      showGet: !installed && !!release,
      showStart: installed && !running,
      showStop: installed && running,
      needsIni,
      getEnabled: !!release && !!u.consent && !!u.admin && !u.busy,
      startEnabled: installed && !running && !!u.admin && !u.busy && (!needsIni || !!u.iniConsent),
      stopEnabled: running && !!u.admin && !u.busy,
      checkEnabled: !u.busy
    };
  }

  return { DOWNLOAD_PAGE, cardModel };
});
