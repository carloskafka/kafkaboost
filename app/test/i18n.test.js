'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createI18n, resolveLanguage, translate, loadDictionaries } = require('../src/i18n');

const dir = path.join(__dirname, '..', 'renderer', 'i18n');
const dicts = loadDictionaries(dir);
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('English and Portuguese have exactly the same keys', () => {
  const en = Object.keys(dicts.en).sort(), pt = Object.keys(dicts['pt-BR']).sort();
  assert.deepEqual(pt.filter((k) => !en.includes(k)), [], 'keys only in pt-BR');
  assert.deepEqual(en.filter((k) => !pt.includes(k)), [], 'keys only in en');
});

test('no translation is empty, and placeholders match between languages', () => {
  for (const key of Object.keys(dicts.en)) {
    assert.ok(String(dicts.en[key]).trim(), `en ${key} is empty`);
    assert.ok(String(dicts['pt-BR'][key]).trim(), `pt-BR ${key} is empty`);
    assert.equal(placeholders(dicts['pt-BR'][key]), placeholders(dicts.en[key]), `placeholders differ in ${key}`);
  }
});

test('no garbled characters (UTF-8 read as ANSI) in any translation', () => {
  const bad = /Ã|Â|â€/;
  for (const lang of Object.keys(dicts)) for (const [k, v] of Object.entries(dicts[lang])) assert.ok(!bad.test(v), `${lang} ${k} looks garbled: ${v}`);
});

test('every key used by the HTML (data-i18n) and by literal t() calls exists', () => {
  const root = path.join(__dirname, '..', 'renderer');
  const known = new Set(Object.keys(dicts.en));
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const used = new Set([...html.matchAll(/data-i18n(?:-title|-placeholder)?="([^"]+)"/g)].map((m) => m[1]));
  for (const f of fs.readdirSync(path.join(root, 'js'))) {
    const js = fs.readFileSync(path.join(root, 'js', f), 'utf8');
    for (const m of js.matchAll(/\bt\(\s*'([\w.]+)'/g)) used.add(m[1]);
  }
  // keys built from a template (step.<id>.*, check.<id>.*, tray.verdict.*) are covered by their lists below
  const missing = [...used].filter((k) => !known.has(k));
  assert.deepEqual(missing, [], 'keys used in the UI but missing from en.json');
  for (const id of ['detect', 'backup', 'get', 'vbs', 'apply', 'task', 'verify']) for (const part of ['kicker', 'title', 'desc', 'c1']) assert.ok(known.has(`step.${id}.${part}`), `step.${id}.${part}`);
  for (const id of ['settings', 'running', 'task', 'vbs', 'windows', 'cap']) assert.ok(known.has(`check.${id}.name`), `check.${id}.name`);
  for (const v of ['unknown', 'ok', 'warn', 'fail']) assert.ok(known.has(`tray.verdict.${v}`), `tray.verdict.${v}`);
});

test('the language follows the setting, then the OS locale', () => {
  assert.equal(resolveLanguage('en', 'pt-BR'), 'en');
  assert.equal(resolveLanguage('pt-BR', 'en-US'), 'pt-BR');
  assert.equal(resolveLanguage('auto', 'pt-BR'), 'pt-BR');
  assert.equal(resolveLanguage('auto', 'pt-PT'), 'pt-BR');
  assert.equal(resolveLanguage('auto', 'de-DE'), 'en');
  assert.equal(resolveLanguage('auto', ''), 'en');
});

test('translate fills placeholders and falls back to English, then to the key', () => {
  const d = { en: { a: 'Hi {name}', only: 'EN only' }, 'pt-BR': { a: 'Oi {name}' } };
  assert.equal(translate(d, 'pt-BR', 'a', { name: 'Ana' }), 'Oi Ana');
  assert.equal(translate(d, 'pt-BR', 'only'), 'EN only');
  assert.equal(translate(d, 'pt-BR', 'missing.key'), 'missing.key');
  assert.equal(translate(d, 'en', 'a'), 'Hi {name}');
});

test('createI18n switches language and exposes the renderer payload', () => {
  const i = createI18n(dir, 'en');
  assert.equal(i.t('nav.dashboard'), 'Dashboard');
  i.setLang('pt-BR'); assert.equal(i.t('nav.dashboard'), 'Painel');
  i.setLang('xx'); assert.equal(i.lang, 'en');
  const p = i.payload(); assert.equal(p.lang, 'en'); assert.ok(p.dict['nav.dashboard'] && p.fallback['nav.dashboard']);
});
