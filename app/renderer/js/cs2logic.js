'use strict';
// Pure logic of the Counter-Strike 2 screen: what each part shows and which buttons are enabled for the data returned by the cs2-state step,
// plus the launch-options string. Shared by the page (window.KBCs2) and the node tests. No DOM, no Electron.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KBCs2 = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const FPS_RE = /^\d{1,4}$/;

  // The launch-options string for the chosen ids, in catalog order. Unknown ids are ignored, so the string only ever holds catalog text.
  function buildLaunchOptions(launch, selected) {
    const want = new Set(selected || []);
    return (launch || []).filter((o) => want.has(o.id)).map((o) => o.text).join(' ');
  }
  const defaultLaunchSelection = (launch) => (launch || []).filter((o) => o.default).map((o) => o.id);

  // The number for the option that takes one (fps_max): a whole number inside the bounds the catalog gives.
  function validParam(option, value) {
    if (!option || !option.param) return true;
    const s = String(value == null ? '' : value).trim();
    if (!FPS_RE.test(s)) return false;
    const n = Number(s);
    return n >= option.param.min && n <= option.param.max;
  }

  // gpu: the "gpu" object of cs2-state ({ pref, high, entry, recorded })
  function gpuModel(gpu, busy) {
    if (!gpu) return { status: 'cs2.gpu.status.unknown', canApply: false, canRevert: false };
    let status;
    if (gpu.high && gpu.recorded) status = 'cs2.gpu.status.ours';
    else if (gpu.high) status = 'cs2.gpu.status.theirs';
    else if (gpu.pref === 1) status = 'cs2.gpu.status.saving';
    else if (gpu.pref === 0) status = 'cs2.gpu.status.windows';
    else status = 'cs2.gpu.status.notSet';
    return { status, canApply: !busy && !gpu.high, canRevert: !busy && !!gpu.recorded };
  }

  // autoexec: the "autoexec" object of cs2-state; choice: { ids: [...], fps: '144' }; catalog: the autoexec options
  function autoexecModel(autoexec, choice, catalog, busy) {
    const a = autoexec || { available: false };
    const ids = (choice && choice.ids) || [];
    const known = (catalog || []).filter((o) => ids.includes(o.id));
    const valid = known.length > 0 && known.every((o) => validParam(o, choice && choice.fps));
    let status;
    if (!a.available) status = 'cs2.cfg.status.unavailable';
    else if (a.ours) status = 'cs2.cfg.status.ours';
    else if (a.foreign) status = 'cs2.cfg.status.foreign';
    else status = 'cs2.cfg.status.none';
    return {
      status,
      willBackup: !!a.available && !!a.exists,
      canWrite: !busy && !!a.available && valid,
      canRestore: !busy && !!a.available && (!!a.ours || (!a.exists && !!a.hasOriginal))
    };
  }

  // What the "Game location" part says. overview: the cs2-state data.
  function locationModel(o) {
    if (!o || !o.found) return { status: 'cs2.loc.notFound', source: null };
    return { status: 'cs2.loc.found', source: o.source === 'user' ? 'cs2.loc.userPicked' : 'cs2.loc.fromSteam' };
  }

  return { buildLaunchOptions, defaultLaunchSelection, validParam, gpuModel, autoexecModel, locationModel };
});
