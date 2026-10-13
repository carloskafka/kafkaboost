'use strict';
// Strict validation of everything that ends up in a package-manager command line. Commands are always built as an
// args array (never a shell string), but ids and queries are still checked first: a leading "-" would be read as an
// option and anything outside these character sets is not a real package id of that manager.
const ID_PATTERNS = {
  winget: /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/,
  brew: /^[a-z0-9][a-z0-9@._+-]{0,99}$/,
  flatpak: /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_-]+){2,}$/,
  apt: /^[a-z0-9][a-z0-9+.-]{1,99}$/,
  dnf: /^[A-Za-z0-9][A-Za-z0-9+._-]{0,99}$/,
  pacman: /^[a-z0-9][a-z0-9@._+-]{0,99}$/
};
const QUERY = /^[\p{L}\p{N}][\p{L}\p{N} ._+#-]{0,63}$/u;
const BREW_KINDS = ['cask', 'formula'];

const validId = (manager, id) => typeof id === 'string' && !!ID_PATTERNS[manager] && ID_PATTERNS[manager].test(id);
const validQuery = (q) => typeof q === 'string' && QUERY.test(q.trim());
const validKind = (manager, kind) => (manager === 'brew' ? BREW_KINDS.includes(kind) : kind === undefined || kind === null || kind === '');

module.exports = { ID_PATTERNS, QUERY, BREW_KINDS, validId, validQuery, validKind };
