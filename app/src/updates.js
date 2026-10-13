'use strict';
// Release/changelog logic for the update check. Pure Node (no Electron), so it is unit tested.

const parseVer = (v) => String(v || '').replace(/^v/i, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);

function isNewer(latest, current) {
  const a = parseVer(latest), b = parseVer(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0); }
  return false;
}

const clean = (r) => ({
  version: String(r.tag_name || '').replace(/^v/i, ''),
  name: String(r.name || r.tag_name || ''),
  date: r.published_at || r.created_at || null,
  body: String(r.body || '').slice(0, 20000),
  url: r.html_url || '',
  assets: Array.isArray(r.assets) ? r.assets.filter((a) => a && typeof a.name === 'string').map((a) => ({ name: a.name, browser_download_url: a.browser_download_url, size: a.size })) : []
});

// Releases (GitHub API shape) -> the ones newer than `current`, newest first, drafts and pre-releases skipped.
function newerReleases(releases, current) {
  if (!Array.isArray(releases)) return [];
  return releases
    .filter((r) => r && r.tag_name && !r.draft && !r.prerelease && isNewer(r.tag_name, current))
    .map(clean)
    .sort((x, y) => (isNewer(x.version, y.version) ? -1 : isNewer(y.version, x.version) ? 1 : 0));
}

// The release that matches `version` exactly (for "what's new in this version" after an update).
function releaseFor(releases, version) {
  if (!Array.isArray(releases)) return null;
  const r = releases.find((x) => x && x.tag_name && !x.draft && parseVer(x.tag_name).join('.') === parseVer(version).join('.'));
  return r ? clean(r) : null;
}

// Markdown release notes -> a small block list the page renders with textContent (never innerHTML).
// Supports: # headings, "- " / "* " bullets, blank-line separated paragraphs.
function parseNotes(body) {
  const out = [];
  for (const raw of String(body || '').replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) { out.push({ type: 'h', text: h[1] }); continue; }
    const li = /^[-*+]\s+(.*)$/.exec(line);
    if (li) { out.push({ type: 'li', text: li[1] }); continue; }
    out.push({ type: 'p', text: line });
  }
  return out;
}

// Can this build update itself? Only the installed (NSIS) Windows build can; a portable exe or a source checkout cannot.
function canSelfUpdate({ isPackaged, platform, portable }) {
  return !!isPackaged && platform === 'win32' && !portable;
}

module.exports = { parseVer, isNewer, newerReleases, releaseFor, parseNotes, canSelfUpdate };
