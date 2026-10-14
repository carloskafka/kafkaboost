'use strict';
// Shared runtime for every screen: tiny DOM helpers, translations, theme, settings cache, navigation.
// Other files attach to window.KB; there is no bundler, scripts are loaded in order by index.html.
(function () {
  const KB = (window.KB = {
    state: { info: null, view: 'health', health: null },
    settings: null,
    dict: {}, fallback: {}, lang: 'en',
    views: {},            // name -> { onShow() }
    hooks: { settingsChanged: [] }
  });

  KB.$ = (id) => document.getElementById(id);
  KB.setText = (el, text) => { el.textContent = text; };

  // ---- translations ---------------------------------------------------------------------------------------------
  KB.t = (key, vars) => {
    const raw = KB.dict[key] ?? KB.fallback[key] ?? key;
    return String(raw).replace(/\{(\w+)\}/g, (m, name) => (vars && name in vars ? String(vars[name]) : m));
  };
  // Message of a step result: the translated code when the script sent one, otherwise its English text.
  KB.message = (res) => (res && res.code && (KB.dict[res.code] || KB.fallback[res.code]) ? KB.t(res.code, res.args || {}) : ((res && res.message) || ''));

  KB.applyI18n = (root = document) => {
    root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = KB.t(el.dataset.i18n); });
    root.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = KB.t(el.dataset.i18nTitle); });
    root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = KB.t(el.dataset.i18nPlaceholder); });
    document.documentElement.lang = KB.lang;
  };

  KB.loadI18n = async () => {
    const p = await window.kb.i18n();
    KB.dict = p.dict; KB.fallback = p.fallback; KB.lang = p.lang;
    KB.applyI18n();
  };

  // ---- theme ----------------------------------------------------------------------------------------------------
  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  KB.resolvedTheme = () => (KB.settings && KB.settings.theme !== 'system' ? KB.settings.theme : (dark.matches ? 'dark' : 'light'));
  KB.applyTheme = () => {
    const theme = KB.resolvedTheme();
    document.documentElement.dataset.theme = theme;
    const icon = KB.$('themeIcon'); if (icon) icon.textContent = theme === 'dark' ? '☾' : '☀';
  };
  dark.addEventListener('change', () => KB.applyTheme());

  // ---- results (the colored message boxes) ----------------------------------------------------------------------
  KB.showResult = (el, kind, text) => {
    if (!text) { el.hidden = true; return; }
    el.hidden = false; el.className = 'result ' + kind; el.textContent = text;
  };

  // ---- last result, shimmer, placeholders -----------------------------------------------------------------------
  // A page shows its last result at once and refreshes it in the background. The copy lives in localStorage (a per-viewer convenience: every
  // access is wrapped, and the page works without it). A stale value is only ever DISPLAYED: whatever acts on it stays disabled until the
  // fresh result arrives.
  const LAST = 'kb.last.v1.';
  KB.lastGet = (key) => { try { const c = JSON.parse(localStorage.getItem(LAST + key) || 'null'); return c && c.v !== undefined ? c : null; } catch { return null; } };
  KB.lastSet = (key, value) => { try { localStorage.setItem(LAST + key, JSON.stringify({ at: Date.now(), v: value })); } catch { /* storage unavailable */ } };
  KB.lastDrop = (key) => { try { localStorage.removeItem(LAST + key); } catch { /* storage unavailable */ } };
  // The shimmer sweep over a container that shows a last result while the fresh one loads.
  KB.refreshing = (el, on) => {
    if (!el) return;
    el.classList.toggle('refreshing', !!on);
    if (on) el.setAttribute('aria-busy', 'true'); else el.removeAttribute('aria-busy');
  };
  // Grey placeholder rows for a first load with nothing cached.
  KB.skeleton = (host, rows) => {
    host.textContent = '';
    for (let i = 0; i < (rows || 3); i++) { const d = document.createElement('div'); d.className = 'skel'; host.appendChild(d); }
  };
  // One `detect` request shared by the Dashboard hardware cards and System analysis (it is the slowest step); the last answer is kept.
  let hardwareReq = null;
  KB.getHardware = () => {
    if (!hardwareReq) {
      hardwareReq = window.kb.runStep('detect', {}).then(
        (res) => { if (res && res.data) KB.lastSet('detect', res.data); else hardwareReq = null; return res; },
        (e) => { hardwareReq = null; throw e; }
      );
    }
    return hardwareReq;
  };
  KB.getHardware.reset = () => { hardwareReq = null; };

  // ---- navigation -----------------------------------------------------------------------------------------------
  // The wizard and the finish screen belong to the Optimizations section of the sidebar.
  const NAV_OF = { wizard: 'optimizations', finish: 'optimizations', cs2: 'optimizations', rammap: 'optimizations' };
  const WINDOWS_ONLY = ['optimizations', 'cleanup', 'restore', 'sensors', 'insights', 'wizard', 'finish', 'cs2', 'rammap', 'memory'];
  const ALL_VIEWS = ['health', 'analysis', 'optimizations', 'cleanup', 'wizard', 'finish', 'restore', 'sensors', 'insights', 'cs2', 'rammap', 'memory', 'apps', 'settings', 'help'];

  KB.registerView = (name, def) => { KB.views[name] = def || {}; };
  KB.featureOn = (view) => { const f = KB.state.info && KB.state.info.features; if (!f) return true; return f[NAV_OF[view] || view] !== false; };

  KB.showView = (name) => {
    const prev = KB.state.view;
    if (prev !== name && KB.views[prev] && KB.views[prev].onHide) KB.views[prev].onHide();   // lets a live screen stop its timer
    KB.state.view = name;
    const section = NAV_OF[name] || name;
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === section));
    const blocked = !KB.featureOn(name);
    ALL_VIEWS.forEach((v) => { const el = KB.$(v); if (el) el.hidden = blocked || v !== name; });
    KB.$('windowsOnly').hidden = !blocked;
    if (blocked) KB.setText(KB.$('windowsOnlyText'), KB.t('windowsOnly.text', { os: KB.state.info.osName }));
    KB.$('stepper').hidden = name !== 'wizard' || blocked;
    if (!blocked && KB.views[name] && KB.views[name].onShow) KB.views[name].onShow();
  };

  // ---- settings cache + live updates ----------------------------------------------------------------------------
  KB.setSettings = (s) => { KB.settings = s; KB.applyTheme(); };
  KB.saveSetting = async (patch) => {
    const r = await window.kb.settings.set(patch);
    KB.setSettings(r.settings);
    return r;
  };
  KB.onSettingsChanged = (cb) => KB.hooks.settingsChanged.push(cb);
  KB.windowsOnlyViews = WINDOWS_ONLY;
})();
