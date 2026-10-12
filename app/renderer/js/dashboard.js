'use strict';
// Dashboard: the health check ("is the optimization still in place?"), live tiles, and the one-click fix.
(function () {
  const { $, t, setText } = KB;

  const VERDICT = {
    ok:   { cls: 'ok',   icon: '✓', key: 'dashboard.verdict.ok' },
    warn: { cls: 'warn', icon: '!', key: 'dashboard.verdict.warn' },
    fail: { cls: 'fail', icon: '✕', key: 'dashboard.verdict.fail' }
  };

  const checkName = (c) => (KB.dict[`check.${c.id}.name`] || KB.fallback[`check.${c.id}.name`]) ? t(`check.${c.id}.name`) : c.name;
  KB.checkDetail = (c) => (c.code && (KB.dict[c.code] || KB.fallback[c.code]) ? t(c.code, c.args || {}) : c.detail);

  function renderHealth(h, msg) {
    KB.state.health = h;
    const v = VERDICT[h.verdict] || VERDICT.fail;
    $('hero').className = 'hero ' + v.cls;
    setText($('heroIcon'), v.icon); setText($('heroTitle'), t(v.key));
    const when = h.checkedAt ? ' · ' + t('dashboard.checked', { time: h.checkedAt.replace('T', ' ').slice(0, 16) }) : '';
    setText($('heroSub'), (h.windows || '') + when);

    const upd = (h.checks || []).find((c) => c.id === 'windows' && !c.ok);
    $('updateNote').hidden = !upd; if (upd) setText($('updateNote'), '🛈  ' + KB.checkDetail(upd));

    const live = h.live;
    $('tiles').hidden = !live;
    if (live) {
      setText($('tTemp'), live.packageTempC != null ? live.packageTempC + ' °C' : '–');
      setText($('tClock'), live.pClockMaxMHz != null ? (live.pClockMaxMHz / 1000).toFixed(2) + ' GHz' : '–');
      setText($('tPower'), live.packagePowerW != null ? live.packagePowerW + ' W' : '–');
    }

    const ul = $('checks'); ul.textContent = '';
    (h.checks || []).forEach((c) => {
      const li = document.createElement('li'); li.className = 'check-row ' + (c.ok ? 'ok' : (c.severity === 'info' ? 'info' : c.severity === 'warn' ? 'warn' : 'fail'));
      const ic = document.createElement('span'); ic.className = 'check-ic'; ic.textContent = c.ok ? '✓' : (c.severity === 'info' ? 'i' : '!');
      const body = document.createElement('div');
      const name = document.createElement('div'); name.className = 'check-name'; name.textContent = checkName(c);
      const det = document.createElement('div'); det.className = 'check-detail'; det.textContent = KB.checkDetail(c);
      body.append(name, det); li.append(ic, body); ul.append(li);
    });

    const fixable = (h.checks || []).some((c) => !c.ok && c.fix);
    $('fix').hidden = !(fixable && h.verdict !== 'ok');
    $('vbsAllow').hidden = !(h.checks || []).some((c) => c.id === 'vbs' && !c.ok);
    if (msg) setText($('heroSub'), msg + ' · ' + (h.windows || ''));
    if (KB.renderOptStatus) KB.renderOptStatus();
  }

  async function runHealth() {
    $('check').disabled = true; $('fix').disabled = true;
    $('hero').className = 'hero checking'; setText($('heroIcon'), '…'); setText($('heroTitle'), t('dashboard.checking'));
    const res = await window.kb.runStep('health', {});
    $('check').disabled = false; $('fix').disabled = false;
    if (res.data && res.data.checks) { renderHealth(res.data); return res.data; }
    $('hero').className = 'hero fail'; setText($('heroIcon'), '✕'); setText($('heroTitle'), t('dashboard.couldNotCheck')); setText($('heroSub'), KB.message(res));
    return null;
  }

  async function runFix() {
    $('check').disabled = true; $('fix').disabled = true;
    setText($('heroTitle'), t('dashboard.fixing'));
    const log = $('healthLog'); log.hidden = false; log.textContent = '';
    const res = await window.kb.runStep('fix', { disableVbs: $('vbsAllowBox').checked });
    $('check').disabled = false; $('fix').disabled = false;
    if (res.data && res.data.checks) renderHealth(res.data, KB.message(res));
    else { setText($('heroTitle'), t('dashboard.couldNotFix')); setText($('heroSub'), KB.message(res)); }
  }

  // On macOS/Linux there is no CPU-tuning health check: the Dashboard shows the basic system information instead.
  function renderBasic() {
    const i = KB.state.info;
    $('hero').className = 'hero ok'; setText($('heroIcon'), '✓');
    setText($('heroTitle'), i.osName); setText($('heroSub'), `${i.osRelease} · ${i.arch} · ${i.cpu}`);
    $('check').hidden = true; $('fix').hidden = true; $('tiles').hidden = true; $('updateNote').hidden = true;
    $('checks').textContent = '';
  }

  KB.runHealth = runHealth;
  KB.registerView('health', { onShow() { if (!KB.featureOn('optimizations')) renderBasic(); } });

  document.addEventListener('DOMContentLoaded', () => {
    $('check').addEventListener('click', runHealth);
    $('fix').addEventListener('click', runFix);
    window.kb.onLog((step, line) => { if (step === 'fix') { const log = $('healthLog'); log.textContent += line + '\n'; log.scrollTop = log.scrollHeight; } });
    // re-render with the new language
    KB.onSettingsChanged(() => { if (KB.state.health) renderHealth(KB.state.health); });
  });
})();
