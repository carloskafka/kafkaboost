#!/usr/bin/env node
/* Checks the GitHub Pages site in docs/ without any dependency:
 *  - every local href/src/asset exists, and every #anchor (or #/route) points at an id on the target page;
 *  - every English page has a pt-br twin with the same section ids (and the reverse);
 *  - hreflang pairs (en, pt-BR, x-default) are present and point at the right files, <html lang> matches;
 *  - no external script or stylesheet (the site must render with no network), images have alt text;
 *  - the numbers on the landing page (data-fact) still match config/tweaks.json and docs/TESTING.md.
 * Usage: node tools/check-site.js [repo-root]      Exit code 1 when anything is wrong.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const BASE = 'https://carloskafka.github.io/legion-14900hx-throttlestop/';
// Pages that exist in English only on purpose (the documentation hub); they are still link-checked.
const EN_ONLY = new Set(['about-app.html']);
// External hosts allowed for <script src> and <link rel=stylesheet>: none, the site is self-contained.
const ALLOWED_EXTERNAL = [];
const BANNED = [/togsboost/i, /100\s?%\s*(safe|seguro)/i];

function listHtml(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.html')).map((e) => e.name).sort();
}
const attr = (tag, name) => { const m = new RegExp('\\s' + name + '\\s*=\\s*"([^"]*)"', 'i').exec(tag); return m ? m[1] : null; };
const ids = (html) => new Set([...html.matchAll(/\sid\s*=\s*"([^"]+)"/g)].map((m) => m[1]));

function check(root) {
  const docs = path.join(root, 'docs');
  const errors = [];
  const err = (file, msg) => errors.push(file + ': ' + msg);
  const cache = new Map();
  const read = (abs) => { if (!cache.has(abs)) cache.set(abs, fs.readFileSync(abs, 'utf8')); return cache.get(abs); };

  const pages = [];
  for (const n of listHtml(docs)) pages.push({ rel: n, abs: path.join(docs, n), lang: 'en' });
  const ptDir = path.join(docs, 'pt-br');
  if (fs.existsSync(ptDir)) for (const n of listHtml(ptDir)) pages.push({ rel: 'pt-br/' + n, abs: path.join(ptDir, n), lang: 'pt-BR' });
  if (!pages.length) err('docs', 'no html pages found');

  for (const p of pages) {
    const html = read(p.abs);
    const dirOf = path.dirname(p.abs);
    if (!new RegExp('<html[^>]*\\slang="' + p.lang + '"', 'i').test(html)) err(p.rel, '<html lang="' + p.lang + '"> missing');
    if (!/<title>[^<]+<\/title>/.test(html)) err(p.rel, 'empty <title>');
    if (!/<meta[^>]+name="description"/.test(html)) err(p.rel, 'meta description missing');
    for (const b of BANNED) if (b.test(html)) err(p.rel, 'banned text ' + b);
    if (!EN_ONLY.has(p.rel) && (html.match(/<h1[\s>]/g) || []).length !== 1) err(p.rel, 'expected exactly one <h1>');

    // links, assets, anchors
    const tags = html.match(/<(a|link|script|img|source)\b[^>]*>/gi) || [];
    for (const tag of tags) {
      const name = /^<(\w+)/.exec(tag)[1].toLowerCase();
      if (name === 'img' && attr(tag, 'alt') === null) err(p.rel, 'img without alt: ' + tag.slice(0, 80));
      const target = name === 'a' || name === 'link' ? attr(tag, 'href') : attr(tag, 'src');
      if (target === null || target === '') continue;
      if (/^(mailto:|javascript:|data:|tel:)/i.test(target)) continue;
      const isExternal = /^https?:\/\//i.test(target);
      if (isExternal && !target.startsWith(BASE)) {
        const needsLocal = name === 'script' || (name === 'link' && /stylesheet/i.test(attr(tag, 'rel') || ''));
        if (needsLocal && !ALLOWED_EXTERNAL.some((h) => target.startsWith(h))) err(p.rel, 'external ' + name + ' not allowed: ' + target);
        continue;
      }
      let pathPart, hash = '';
      if (target.startsWith(BASE)) { pathPart = path.join(docs, target.slice(BASE.length).split('#')[0].split('?')[0] || 'index.html'); hash = target.includes('#') ? target.split('#')[1] : ''; }
      else {
        const [a, ...rest] = target.split('#'); hash = rest.join('#');
        const noQuery = a.split('?')[0];
        pathPart = noQuery === '' ? p.abs : path.resolve(dirOf, decodeURIComponent(noQuery));
      }
      if (!fs.existsSync(pathPart)) { err(p.rel, 'missing target ' + target); continue; }
      if (fs.statSync(pathPart).isDirectory()) pathPart = path.join(pathPart, 'index.html');
      if (hash && pathPart.endsWith('.html') && fs.existsSync(pathPart)) {
        const id = hash.replace(/^\/?/, ''); // #/overview (hash routes of the docs hub) and #overview
        if (!ids(read(pathPart)).has(id)) err(p.rel, 'anchor #' + hash + ' not found in ' + path.relative(docs, pathPart));
      }
    }
  }

  // language twins, same section ids, hreflang
  const enPages = pages.filter((p) => p.lang === 'en' && !EN_ONLY.has(p.rel));
  for (const en of enPages) {
    const twin = pages.find((p) => p.rel === 'pt-br/' + en.rel);
    if (!twin) { err(en.rel, 'no pt-br twin'); continue; }
    const a = [...ids(read(en.abs))].filter((i) => i !== 'main' && i !== 'site-nav' && i !== 'menu-btn').sort();
    const b = [...ids(read(twin.abs))].filter((i) => i !== 'main' && i !== 'site-nav' && i !== 'menu-btn').sort();
    if (a.join() !== b.join()) err(en.rel, 'section ids differ from pt-br twin: en-only [' + a.filter((x) => !b.includes(x)) + '] pt-only [' + b.filter((x) => !a.includes(x)) + ']');
    for (const p of [en, twin]) {
      const html = read(p.abs);
      const want = { en: BASE + en.rel, 'pt-BR': BASE + 'pt-br/' + en.rel, 'x-default': BASE + en.rel };
      for (const [lang, url] of Object.entries(want)) {
        if (!new RegExp('<link[^>]+rel="alternate"[^>]+hreflang="' + lang + '"[^>]+href="' + url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"').test(html)) err(p.rel, 'hreflang ' + lang + ' -> ' + url + ' missing');
      }
      const sw = p.lang === 'en' ? 'pt-br/' + en.rel : '../' + en.rel;
      if (!html.includes('href="' + sw + '"')) err(p.rel, 'language switch link to ' + sw + ' missing');
    }
  }
  for (const p of pages.filter((x) => x.lang === 'pt-BR')) {
    const name = p.rel.slice('pt-br/'.length);
    if (!pages.some((e) => e.rel === name)) err(p.rel, 'no English twin');
  }

  // the facts must still be true
  const facts = {};
  try {
    const tw = JSON.parse(fs.readFileSync(path.join(root, 'config', 'tweaks.json'), 'utf8'));
    facts.tweaks = String(tw.tweaks.length);
  } catch (e) { /* no catalog in a test fixture */ }
  try {
    const t = fs.readFileSync(path.join(docs, 'TESTING.md'), 'utf8');
    const pester = /(\d+) tests\./.exec(t); const node = /# (\d+) tests/.exec(t);
    if (pester) facts.pester = pester[1]; if (node) facts.node = node[1];
  } catch (e) { /* ignore */ }
  for (const p of pages) {
    for (const m of read(p.abs).matchAll(/data-fact="(\w+)">([^<]*)</g)) {
      if (facts[m[1]] === undefined) err(p.rel, 'unknown or unverifiable fact "' + m[1] + '"');
      else if (facts[m[1]] !== m[2].trim()) err(p.rel, 'fact "' + m[1] + '" says ' + m[2] + ' but the repository says ' + facts[m[1]]);
    }
  }
  return { errors, pages: pages.length };
}

module.exports = { check };

if (require.main === module) {
  const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
  const { errors, pages } = check(root);
  if (errors.length) { console.error(errors.map((e) => 'ERROR ' + e).join('\n')); console.error('\n' + errors.length + ' problem(s) in ' + pages + ' page(s)'); process.exit(1); }
  console.log('site ok: ' + pages + ' pages, links, anchors, language twins and facts verified');
}
