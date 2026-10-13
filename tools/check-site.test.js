'use strict';
// node --test tools/check-site.test.js : the real site passes, and the checker catches the mistakes it exists for.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { check } = require('./check-site');

const root = path.join(__dirname, '..');
const BASE = 'https://carloskafka.github.io/legion-14900hx-throttlestop/';

function page(lang, name, extra) {
  const alt = [['en', name], ['pt-BR', 'pt-br/' + name], ['x-default', name]]
    .map(([h, u]) => '<link rel="alternate" hreflang="' + h + '" href="' + BASE + u + '">').join('');
  const sw = lang === 'en' ? 'pt-br/' + name : '../' + name;
  return '<!DOCTYPE html><html lang="' + lang + '"><head><title>t</title><meta name="description" content="d">' + alt +
    '</head><body><main id="main"><h1 id="top">x</h1><a href="' + sw + '">sw</a>' + (extra || '') + '</main></body></html>';
}
function fixture(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-'));
  fs.mkdirSync(path.join(dir, 'docs', 'pt-br'), { recursive: true });
  const files = { 'docs/index.html': page('en', 'index.html'), 'docs/pt-br/index.html': page('pt-BR', 'index.html') };
  if (mutate) mutate(files);
  for (const [f, c] of Object.entries(files)) { if (c === null) continue; fs.writeFileSync(path.join(dir, f), c); }
  return dir;
}

test('the real site has no problems', () => {
  const r = check(root);
  assert.deepStrictEqual(r.errors, []);
  assert.ok(r.pages >= 12);
});
test('a clean fixture passes', () => assert.deepStrictEqual(check(fixture()).errors, []));
test('a broken link is reported', () => {
  const r = check(fixture((f) => { f['docs/index.html'] = page('en', 'index.html', '<a href="nope.html">x</a>'); }));
  assert.ok(r.errors.some((e) => /missing target nope\.html/.test(e)));
});
test('a missing anchor is reported', () => {
  const r = check(fixture((f) => { f['docs/index.html'] = page('en', 'index.html', '<a href="#ghost">x</a>'); }));
  assert.ok(r.errors.some((e) => /anchor #ghost/.test(e)));
});
test('a missing translation is reported', () => {
  const r = check(fixture((f) => { f['docs/pt-br/index.html'] = null; }));
  assert.ok(r.errors.some((e) => /no pt-br twin/.test(e)));
});
test('different section ids between languages are reported', () => {
  const r = check(fixture((f) => { f['docs/index.html'] = page('en', 'index.html', '<section id="only-en"></section>'); }));
  assert.ok(r.errors.some((e) => /section ids differ/.test(e)));
});
test('an external script and an image without alt are reported', () => {
  const r = check(fixture((f) => { f['docs/index.html'] = page('en', 'index.html', '<script src="https://cdn.example.com/x.js"></script><img src="https://x.test/a.png">'); }));
  assert.ok(r.errors.some((e) => /external script/.test(e)));
  assert.ok(r.errors.some((e) => /img without alt/.test(e)));
});
test('a wrong fact is reported', () => {
  const dir = fixture((f) => { f['docs/index.html'] = page('en', 'index.html', '<b data-fact="tweaks">99</b>'); f['docs/pt-br/index.html'] = page('pt-BR', 'index.html', '<b data-fact="tweaks">99</b>'); });
  fs.mkdirSync(path.join(dir, 'config'));
  fs.writeFileSync(path.join(dir, 'config', 'tweaks.json'), JSON.stringify({ tweaks: [{}, {}] }));
  assert.ok(check(dir).errors.some((e) => /fact "tweaks" says 99/.test(e)));
});
test('mismatching UI check counts are reported', () => {
  const dir = fixture();
  fs.writeFileSync(path.join(dir, 'docs', 'TESTING.md'), '172 checks on Windows, 12 on a faked Linux');
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# UI checks in demo mode (170 + 12)');
  assert.ok(check(dir).errors.some((e) => /UI check counts 170 \+ 12 differ/.test(e)));
});
test('matching UI check counts pass', () => {
  const dir = fixture();
  fs.writeFileSync(path.join(dir, 'docs', 'TESTING.md'), '172 checks on Windows, 12 on a faked Linux');
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# UI checks in demo mode (172 + 12)');
  assert.ok(!check(dir).errors.some((e) => /UI check counts/.test(e)));
});
test('open source wording without a LICENSE file is reported', () => {
  const r = check(fixture((f) => { f['docs/index.html'] = page('en', 'index.html', '<p>Open source (MIT licence)</p>'); }));
  assert.ok(r.errors.some((e) => /no LICENSE file/.test(e)));
});
