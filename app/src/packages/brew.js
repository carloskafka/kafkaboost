'use strict';
const { makeProvider, lines } = require('./base');
const { validId } = require('./ids');

// Homebrew on macOS (apps are casks, command-line tools are formulae). An app started from the Finder does not get
// the shell PATH, so the usual install locations are tried before plain "brew".
const BREW_PATHS = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew', 'brew'];

function names(stdout) { return lines(stdout).map((l) => l.trim().split(/\s+/)[0]).filter((n) => validId('brew', n)); }

module.exports = (runner) => {
  let bin = null;
  const find = async (run) => {
    if (bin) return { code: 0, stdout: '', stderr: '' };
    let last = { code: -1, stdout: '', stderr: '', error: 'ENOENT' };
    for (const candidate of BREW_PATHS) { last = await run(candidate, ['--version']); if (last.code === 0 && !last.error) { bin = candidate; break; } }
    return last;
  };
  const b = () => bin || 'brew';
  const of = (list, kind) => list.map((id) => ({ id, name: id, version: '', kind }));
  return makeProvider({
    name: 'brew', label: 'Homebrew',
    probe: find,
    list: async (run) => {
      await find(run);
      return [...of(names((await run(b(), ['list', '--cask', '--versions'])).stdout), 'cask'), ...of(names((await run(b(), ['leaves'])).stdout), 'formula')];
    },
    search: async (run, q) => {
      await find(run);
      return [...of(names((await run(b(), ['search', '--cask', q])).stdout), 'cask'), ...of(names((await run(b(), ['search', '--formula', q])).stdout), 'formula')].slice(0, 40);
    },
    installCmd: (id, kind) => [b(), ['install', kind === 'formula' ? '--formula' : '--cask', id]],
    uninstallCmd: (id, kind) => [b(), ['uninstall', kind === 'formula' ? '--formula' : '--cask', id]]
  }, runner);
};
module.exports.names = names;
