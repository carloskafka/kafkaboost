'use strict';
// Start-up: load info, settings and translations, wire the sidebar, open the right first screen.
(async function () {
  const { $, t, setText } = KB;
  await new Promise((r) => (document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', r) : r()));

  const [info, settings] = await Promise.all([window.kb.info(), window.kb.settings.get()]);
  KB.state.info = info;
  KB.setSettings(settings);
  await KB.loadI18n();
  KB.applyTheme();
  const sideNote = () => setText($('sideNote'), t('side.note', { version: info.version }));
  sideNote();

  // settings changed anywhere (the window, the tray, a reset): refresh theme, language and every screen
  window.kb.settings.onChange(({ settings: s, i18n }) => {
    KB.setSettings(s);
    if (i18n) { KB.dict = i18n.dict; KB.fallback = i18n.fallback; KB.lang = i18n.lang; KB.applyI18n(); sideNote(); }
    KB.hooks.settingsChanged.forEach((cb) => cb(s));
  });

  document.querySelectorAll('[data-link]').forEach((b) => b.addEventListener('click', () => window.kb.openExternal(b.dataset.link)));
  document.querySelectorAll('.nav-btn').forEach((b) => b.addEventListener('click', () => {
    KB.showView(b.dataset.view);
    if (b.dataset.view === 'health' && KB.featureOn('optimizations')) KB.runHealth();
  }));
  $('themeBtn').addEventListener('click', () => KB.saveSetting({ theme: KB.resolvedTheme() === 'dark' ? 'light' : 'dark' }));

  if (info.platform === 'win32' && !info.isAdmin) {
    $('banner').hidden = false;
    $('bannerBtn').addEventListener('click', () => window.kb.relaunchAdmin());
  }

  // After an update, show what changed in the version that is now running (once).
  window.kb.whatsNew().then((w) => { if (w && w.show) KB.updates.open(w, 'whatsnew'); }).catch(() => {});

  // Home is the Dashboard. On Windows without a set-up tuning, guide the user to Optimizations instead.
  KB.showView('health');
  if (KB.featureOn('optimizations')) {
    const h = await KB.runHealth();
    if (h && h.installed === false) KB.showView('optimizations');
  }
})();
