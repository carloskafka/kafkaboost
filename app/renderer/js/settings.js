'use strict';
// Settings: theme, language, startup and tray behaviour, ThrottleStop folder, updates, maintenance. Every change is saved at once.
(function () {
  const { $, t, setText } = KB;
  let savedTimer = null;

  const flashSaved = () => {
    const chip = $('savedChip'); chip.hidden = false;
    clearTimeout(savedTimer); savedTimer = setTimeout(() => { chip.hidden = true; }, 1500);
  };
  const save = async (patch) => { const r = await KB.saveSetting(patch); flashSaved(); return r; };

  function fill() {
    const s = KB.settings; if (!s) return;
    document.querySelectorAll('#themeSeg [data-theme-value]').forEach((b) => {
      const on = b.dataset.themeValue === s.theme; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on));
    });
    $('langSel').value = s.language;
    $('sStartHidden').checked = s.startHidden; $('sStartHwinfo').checked = s.startHwinfoWithApp; $('sCloseToTray').checked = s.closeToTray; $('sNotifications').checked = s.notifications;
    $('sInterval').value = s.checkIntervalMin; $('sInstallDir').value = s.installDir; $('sCheckDaily').checked = s.checkForUpdates;
    setText($('versionLine'), t('settings.version', { version: (KB.state.info || {}).version || '' }));
    const win = KB.featureOn('optimizations');
    $('thermalCard').hidden = !win; $('sStartHwinfoRow').hidden = !win; $('mBackups').hidden = !win; $('mDelBackups').hidden = !win;
  }

  async function refreshAutostart() { const r = await window.kb.autostart('status'); $('sAutostart').checked = !!(r && r.enabled); }

  async function applyAutostart(on) {
    const box = $('sAutostart'); box.disabled = true;
    const r = await window.kb.autostart(on ? 'on' : 'off');
    box.checked = !!(r && r.enabled); box.disabled = false;
    const text = r && r.ok ? KB.message(r) : (/administrator/i.test((r && r.message) || '') ? t('settings.adminNeeded') : ((r && r.message) || t('common.failed')));
    KB.showResult($('autostartResult'), r && r.ok ? 'ok' : 'fail', text);
  }

  async function checkNow() {
    const btn = $('checkUpdate'); btn.disabled = true; KB.showResult($('updateResult'), '', ''); $('updatePanel').hidden = true;
    const r = await window.kb.checkUpdate(); btn.disabled = false;
    if (!r.ok) { KB.showResult($('updateResult'), 'fail', t('settings.updateFailed', { error: r.error })); return; }
    if (r.newer) { KB.updates.reset(); KB.updates.mount($('updatePanel'), r); KB.updates.banner(r); }      // version text with its Download button on the right
    else KB.showResult($('updateResult'), 'ok', t('settings.upToDate', { version: r.current }));
  }

  const maint = (kind, text) => KB.showResult($('maintResult'), kind, text);

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('#themeSeg [data-theme-value]').forEach((b) => b.addEventListener('click', () => save({ theme: b.dataset.themeValue })));
    $('langSel').addEventListener('change', () => save({ language: $('langSel').value }));
    $('sStartHwinfo').addEventListener('change', () => save({ startHwinfoWithApp: $('sStartHwinfo').checked }));
    $('sCloseToTray').addEventListener('change', () => save({ closeToTray: $('sCloseToTray').checked }));
    $('sNotifications').addEventListener('change', () => save({ notifications: $('sNotifications').checked }));
    $('sStartHidden').addEventListener('change', async () => {
      await save({ startHidden: $('sStartHidden').checked });
      if ($('sAutostart').checked) await applyAutostart(true);          // the startup entry carries the --hidden flag
    });
    $('sInterval').addEventListener('change', () => {
      const v = Math.min(1440, Math.max(5, parseInt($('sInterval').value, 10) || 30)); $('sInterval').value = v; save({ checkIntervalMin: v });
    });
    $('sInstallDir').addEventListener('change', () => save({ installDir: $('sInstallDir').value.trim() }));
    $('browseDir').addEventListener('click', async () => { const p = await window.kb.pickFolder(); if (p) { $('sInstallDir').value = p; save({ installDir: p }); } });
    $('sAutostart').addEventListener('change', () => applyAutostart($('sAutostart').checked));
    $('sCheckDaily').addEventListener('change', () => save({ checkForUpdates: $('sCheckDaily').checked }));
    $('checkUpdate').addEventListener('click', checkNow);

    $('mLogs').addEventListener('click', () => window.kb.openPath('logs'));
    $('mBackups').addEventListener('click', async () => { const r = await window.kb.openInstallDir(); if (!r.ok) maint('fail', t('common.failed')); });
    $('mCache').addEventListener('click', async () => { await window.kb.clearCache(); maint('ok', t('settings.cacheCleared')); });
    $('mDelBackups').addEventListener('click', async () => { const r = await window.kb.runStep('cleanbackups', {}); maint(r.ok ? 'ok' : 'fail', KB.message(r)); });
    $('mReset').addEventListener('click', async () => {
      if (!window.confirm(t('settings.resetConfirm'))) return;
      KB.setSettings(await window.kb.settings.reset()); fill(); flashSaved();
    });
    KB.onSettingsChanged(fill);
  });

  KB.registerView('settings', { onShow() { fill(); refreshAutostart(); } });
})();
