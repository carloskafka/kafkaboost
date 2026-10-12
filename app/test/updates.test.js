'use strict';
const test = require('node:test');
const assert = require('node:assert');
const u = require('../src/updates');

const rel = (tag, extra = {}) => ({ tag_name: tag, name: tag, body: `notes ${tag}`, html_url: `https://x/${tag}`, published_at: '2026-01-01T00:00:00Z', ...extra });

test('isNewer compares numerically, ignores a leading v and missing parts', () => {
  assert.equal(u.isNewer('v0.2.0', '0.1.9'), true);
  assert.equal(u.isNewer('0.10.0', '0.9.0'), true);
  assert.equal(u.isNewer('1.0', '1.0.0'), false);
  assert.equal(u.isNewer('0.1.0', '0.1.0'), false);
  assert.equal(u.isNewer('0.1.0', '0.2.0'), false);
});

test('newerReleases keeps only newer, published, stable releases, newest first', () => {
  const list = [rel('v0.1.0'), rel('v0.3.0'), rel('v0.2.0'), rel('v0.4.0', { draft: true }), rel('v0.5.0-rc1', { prerelease: true })];
  const out = u.newerReleases(list, '0.1.0');
  assert.deepEqual(out.map((r) => r.version), ['0.3.0', '0.2.0']);
  assert.equal(out[0].body, 'notes v0.3.0');
});

test('newerReleases is empty when up to date and tolerant of bad input', () => {
  assert.deepEqual(u.newerReleases([rel('v0.1.0')], '0.1.0'), []);
  assert.deepEqual(u.newerReleases(null, '0.1.0'), []);
  assert.deepEqual(u.newerReleases([null, {}], '0.1.0'), []);
});

test('releaseFor finds the exact version regardless of the v prefix', () => {
  assert.equal(u.releaseFor([rel('v0.2.0'), rel('v0.1.0')], '0.2.0').version, '0.2.0');
  assert.equal(u.releaseFor([rel('v0.2.0')], '0.9.0'), null);
});

test('parseNotes turns markdown into headings, bullets and paragraphs', () => {
  const blocks = u.parseNotes('## Added\r\n- one\n* two\n\nplain text\n<img src=x onerror=alert(1)>');
  assert.deepEqual(blocks.map((b) => b.type), ['h', 'li', 'li', 'p', 'p']);
  assert.equal(blocks[0].text, 'Added');
  assert.equal(blocks[4].text, '<img src=x onerror=alert(1)>');   // kept as text: the page renders it with textContent
});

test('only the installed Windows build can update itself', () => {
  assert.equal(u.canSelfUpdate({ isPackaged: true, platform: 'win32', portable: false }), true);
  assert.equal(u.canSelfUpdate({ isPackaged: true, platform: 'win32', portable: true }), false);
  assert.equal(u.canSelfUpdate({ isPackaged: false, platform: 'win32', portable: false }), false);
  assert.equal(u.canSelfUpdate({ isPackaged: true, platform: 'linux', portable: false }), false);
});
