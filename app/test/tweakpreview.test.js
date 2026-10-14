'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const P = require('../renderer/js/tweakpreview');
const demo = require('../src/demo');
const { loadDictionaries } = require('../src/i18n');

const configDir = path.join(__dirname, '..', '..', 'config');
const dicts = loadDictionaries(path.join(__dirname, '..', 'renderer', 'i18n'));
const tr = (lang) => (key, vars) => String(dicts[lang][key] ?? key).replace(/\{(\w+)\}/g, (m, n) => (vars && n in vars ? String(vars[n]) : m));
const en = tr('en');

const reg = (o) => ({ type: 'registry', path: 'HKLM:\\SOFTWARE\\Policies\\X', name: 'V', kind: 'DWord', currentSet: false, current: null, new: '2', alreadyInPlace: false, restoreDeletes: true, restore: null, ...o });

test('a registry value that is not set: shows "not set", the new value and "deleted again"', () => {
  const l = P.actionLines(reg({}), en);
  assert.equal(l[0], 'HKLM\\SOFTWARE\\Policies\\X');
  assert.match(l[1], /V \(DWord\): not set → 2/);
  assert.match(l[2], /deleted again/);
});

test('a registry value that is set: shows the current value and restores exactly it', () => {
  const l = P.actionLines(reg({ currentSet: true, current: '7', restoreDeletes: false, restore: '7' }), en);
  assert.match(l[1], /7 → 2/);
  assert.match(l[2], /set back to 7/);
  assert.ok(!l.some((x) => /deleted again/.test(x)));
});

test('a value that already has the new value is said so', () => {
  const l = P.actionLines(reg({ currentSet: true, current: '2', alreadyInPlace: true, restoreDeletes: false, restore: '2' }), en);
  assert.ok(l.some((x) => /already has this value/.test(x)));
});

test('non-registry actions get a readable current -> new description and what turning off restores', () => {
  const svc = P.actionLines({ type: 'service', name: 'SysMain', found: true, current: 'Auto', running: true, new: 'Disabled', restore: 'Auto' }, en).join('\n');
  assert.match(svc, /SysMain: start type Auto → Disabled/); assert.match(svc, /stopped now/); assert.match(svc, /back to Auto/);
  assert.match(P.actionLines({ type: 'service', name: 'Nope', found: false }, en)[0], /not found/);
  assert.match(P.actionLines({ type: 'powerplan', current: 'Balanced' }, en).join('\n'), /Balanced → Ultimate[\s\S]*Balanced is activated again/);
  const dns = P.actionLines({ type: 'dns', servers: '1.1.1.1, 1.0.0.1', adapters: [{ name: 'Ethernet', current: '', restoreAutomatic: true }, { name: 'Wi-Fi', current: '9.9.9.9', restoreAutomatic: false }] }, en).join('\n');
  assert.match(dns, /Ethernet: automatic \(DHCP\) → 1\.1\.1\.1, 1\.0\.0\.1/); assert.match(dns, /set back to 9\.9\.9\.9/);
  assert.match(P.actionLines({ type: 'defender', currentOn: true }, en).join('\n'), /on → off/);
  assert.match(P.actionLines({ type: 'vbs', currentOn: false }, en).join('\n'), /off → off/);
  assert.match(P.actionLines({ type: 'regkey', path: 'HKCU:\\Software\\K', currentSet: false, restoreDeletes: true }, en).join('\n'), /does not exist → created[\s\S]*deleted again/);
  assert.match(P.actionLines({ type: 'registry', error: 'boom' }, en)[0], /boom/);
});

test('buildBlocks: title, description, notice, monospace changes, admin and restart facts, closing lines', () => {
  const blocks = P.buildBlocks([{ id: 'x', risk: 'safe', needsAdmin: true, needsReboot: false, actions: [reg({})] }], {
    t: en, title: () => 'Title', desc: () => 'Does a thing.', notice: () => 'It looks different.', appAdmin: false, intro: 'Intro', closing: ['Bye'], riskLabel: () => 'Safe'
  });
  assert.deepEqual(blocks.map((b) => b.kind), ['p', 'h', 'p', 'p', 'mono', 'meta', 'p']);
  assert.equal(blocks[1].text, 'Title  ·  Safe');
  assert.match(blocks[3].text, /You may notice: It looks different\./);
  assert.match(blocks[5].text, /Administrator rights: needed/); assert.match(blocks[5].text, /Restart: not needed/); assert.match(blocks[5].text, /not running as administrator/);
});

for (const lang of ['en', 'pt-BR']) {
  test(`every real tweak of the catalog renders fully translated in ${lang} (no raw keys, no "undefined")`, () => {
    const t = tr(lang);
    const all = demo.demoStep('tweak-preview', { tweakIds: JSON.parse(require('fs').readFileSync(path.join(configDir, 'tweaks.json'), 'utf8')).tweaks.map((x) => x.id).join(',') }, configDir).res.data.tweaks;
    assert.equal(all.length, 31);
    const blocks = P.buildBlocks(all, { t, title: (id) => t(`tweak.${id}.title`), desc: (id) => t(`tweak.${id}.desc`), notice: () => '', appAdmin: true, closing: [] });
    for (const b of blocks) { assert.ok(!/tweaks?\.pv\.|undefined|null/.test(b.text), `${lang}: ${b.text}`); }
  });
}

test('every safe recommended tweak has a "what you may notice" text in both languages', () => {
  const tw = JSON.parse(require('fs').readFileSync(path.join(configDir, 'tweaks.json'), 'utf8')).tweaks.filter((x) => x.risk === 'safe' && x.recommended);
  assert.ok(tw.length >= 10);
  for (const x of tw) for (const lang of ['en', 'pt-BR']) assert.ok(dicts[lang][`tweak.${x.id}.notice`], `${lang} tweak.${x.id}.notice`);
});

test('the dialog texts make no FPS promise', () => {
  for (const lang of ['en', 'pt-BR']) for (const [k, v] of Object.entries(dicts[lang])) if (/^tweak\.[\w-]+\.notice$/.test(k) || k.startsWith('tweaks.pv.')) assert.ok(!/\bFPS\b|quadros por segundo/i.test(v), k);
});
