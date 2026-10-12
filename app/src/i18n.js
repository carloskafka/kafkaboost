'use strict';
// Translations shared by the main process (tray, notifications) and the renderer (sent over IPC).
const fs = require('fs');
const path = require('path');

const LANGS = ['en', 'pt-BR'];

// "auto" follows the OS language: Portuguese variants map to pt-BR, everything else to English.
function resolveLanguage(setting, osLocale) {
  if (LANGS.includes(setting)) return setting;
  return /^pt/i.test(osLocale || '') ? 'pt-BR' : 'en';
}

function loadDictionaries(dir) {
  const out = {};
  for (const lang of LANGS) out[lang] = JSON.parse(fs.readFileSync(path.join(dir, `${lang}.json`), 'utf8'));
  return out;
}

// {name} placeholders are replaced from vars; a missing key falls back to English, then to the key itself.
function translate(dicts, lang, key, vars) {
  const raw = (dicts[lang] && dicts[lang][key]) ?? (dicts.en && dicts.en[key]) ?? key;
  return String(raw).replace(/\{(\w+)\}/g, (m, name) => (vars && name in vars ? String(vars[name]) : m));
}

function createI18n(dir, initialLang = 'en') {
  const dicts = loadDictionaries(dir);
  let lang = initialLang;
  return {
    dicts,
    get lang() { return lang; },
    setLang(next) { lang = LANGS.includes(next) ? next : 'en'; },
    t: (key, vars) => translate(dicts, lang, key, vars),
    // Payload for the renderer: the active dictionary plus English as the fallback.
    payload: () => ({ lang, dict: dicts[lang], fallback: dicts.en })
  };
}

module.exports = { createI18n, resolveLanguage, translate, loadDictionaries, LANGS };
