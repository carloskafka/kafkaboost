'use strict';
// Pure formatting of the "tweak-preview" step result (scripts/lib/Tweaks.ps1, Get-TweakPreview) into the blocks of the confirmation
// dialog. Shared by the page (window.KBTweakPreview) and the node tests. No DOM, no Electron: it only turns data and a translate
// function into plain strings, and the page renders them with textContent.
//
// Block kinds: h (tweak heading), p (sentence), meta (small facts line), mono (the exact technical changes, monospace).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KBTweakPreview = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const arrow = (s) => s;
  // The registry shows HKLM\... ; the catalog writes HKLM:\...
  const regPath = (p) => String(p || '').replace(/^(HKLM|HKCU):\\?/, '$1\\');

  // One action -> the lines of the monospace block. `t(key, vars)` translates; a missing key comes back as the key itself.
  function actionLines(a, t) {
    if (!a || a.error) return [t('tweaks.pv.error', { detail: (a && a.error) || '?' })];
    const state = (on) => t(on === true ? 'tweaks.pv.on' : on === false ? 'tweaks.pv.off' : 'tweaks.pv.unknown');
    switch (a.type) {
      case 'registry': {
        const lines = [regPath(a.path), '  ' + t('tweaks.pv.reg', { name: a.name, kind: a.kind, current: a.currentSet ? a.current : t('tweaks.pv.notSet'), new: a.new })];
        if (a.alreadyInPlace) lines.push('  ' + t('tweaks.pv.already'));
        lines.push('  ' + (a.restoreDeletes ? t('tweaks.pv.offDelete') : t('tweaks.pv.offValue', { value: a.restore })));
        return lines;
      }
      case 'regkey':
        return [regPath(a.path), '  ' + t('tweaks.pv.key', { current: t(a.currentSet ? 'tweaks.pv.keyExists' : 'tweaks.pv.keyMissing') }),
          '  ' + t(a.restoreDeletes ? 'tweaks.pv.offKeyDelete' : 'tweaks.pv.offKeyKeep')];
      case 'service': {
        if (!a.found) return [t('tweaks.pv.serviceMissing', { name: a.name })];
        const lines = [t('tweaks.pv.service', { name: a.name, current: a.current, new: a.new })];
        if (a.running && a.new === 'Disabled') lines.push('  ' + t('tweaks.pv.serviceStop'));
        lines.push('  ' + t('tweaks.pv.offService', { value: a.restore }));
        return lines;
      }
      case 'powerplan':
        return [t('tweaks.pv.plan', { current: a.current || t('tweaks.pv.unknown') }), '  ' + t('tweaks.pv.offPlan', { current: a.current || t('tweaks.pv.unknown') })];
      case 'dns': {
        const ads = Array.isArray(a.adapters) ? a.adapters : (a.adapters ? [a.adapters] : []);
        if (!ads.length) return [t('tweaks.pv.dnsNone')];
        const lines = [];
        ads.forEach((ad) => {
          lines.push(t('tweaks.pv.dns', { adapter: ad.name, current: ad.current || t('tweaks.pv.dnsAuto'), new: a.servers }));
          lines.push('  ' + (ad.restoreAutomatic ? t('tweaks.pv.offDnsAuto') : t('tweaks.pv.offDns', { value: ad.current })));
        });
        return lines;
      }
      case 'defender':
        return [t('tweaks.pv.defender', { current: state(a.currentOn) }), '  ' + t('tweaks.pv.offDefender')];
      case 'vbs':
        return [t('tweaks.pv.vbs', { current: state(a.currentOn) }), '  ' + t('tweaks.pv.offVbs')];
      default:
        return [t('tweaks.pv.error', { detail: String(a.type || '?') })];
    }
  }

  // previews: data.tweaks of the tweak-preview step. ctx: { t, appAdmin, title(id), desc(id), notice(id) -> string|'' , riskLabel(risk), intro, closing: [strings] }
  function buildBlocks(previews, ctx) {
    const { t } = ctx;
    const blocks = [];
    if (ctx.intro) blocks.push({ kind: 'p', text: ctx.intro });
    (previews || []).forEach((p) => {
      blocks.push({ kind: 'h', text: ctx.title(p.id) + (ctx.riskLabel ? '  ·  ' + ctx.riskLabel(p.risk) : '') });
      blocks.push({ kind: 'p', text: ctx.desc(p.id) });
      const notice = ctx.notice ? ctx.notice(p.id) : '';
      if (notice) blocks.push({ kind: 'p', text: t('tweaks.pv.notice', { text: notice }) });
      const lines = [];
      (Array.isArray(p.actions) ? p.actions : [p.actions]).forEach((a, i) => { if (i) lines.push(''); actionLines(a, t).forEach((l) => lines.push(l)); });
      blocks.push({ kind: 'mono', text: lines.map(arrow).join('\n') });
      const meta = [t(p.needsAdmin ? 'tweaks.pv.adminYes' : 'tweaks.pv.adminNo'), t(p.needsReboot ? 'tweaks.pv.rebootYes' : 'tweaks.pv.rebootNo')];
      if (p.needsAdmin && ctx.appAdmin === false) meta.push(t('tweaks.pv.adminMissing'));
      blocks.push({ kind: 'meta', text: meta.join('  ·  ') });
    });
    (ctx.closing || []).forEach((text) => blocks.push({ kind: 'p', text }));
    return blocks;
  }

  return { regPath, actionLines, buildBlocks };
});
