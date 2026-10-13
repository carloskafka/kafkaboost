'use strict';
const { makeProvider, lines } = require('./base');
const { validId } = require('./ids');

// Linux: flatpak (per user, no root needed) and the distro managers apt, dnf and pacman. The distro managers need root:
// the command is run through pkexec (a graphical password prompt), unless the app already runs as root.
const DENIED = [126, 127];   // pkexec: dialog dismissed / not authorized
const priv = (cmd, args, isRoot) => (isRoot ? [cmd, args] : ['pkexec', [cmd, ...args]]);
const plain = (manager, names) => names.filter((id) => validId(manager, id)).map((id) => ({ id, name: id, version: '' }));
const summarize = (rows, re, manager) => rows
  .map((l) => { const m = re.exec(l); return m && validId(manager, m[1]) ? { id: m[1], name: m[1], version: '', summary: m[2] } : null; })
  .filter(Boolean).slice(0, 40);

function flatpak(runner) {
  const cols = (stdout) => lines(stdout).map((l) => l.split('\t')).filter((c) => c.length >= 2 && validId('flatpak', c[0].trim()));
  return makeProvider({
    name: 'flatpak', label: 'Flatpak',
    probe: (run) => run('flatpak', ['--version']),
    list: async (run) => cols((await run('flatpak', ['list', '--app', '--columns=application,name,version'])).stdout)
      .map((c) => ({ id: c[0].trim(), name: (c[1] || c[0]).trim(), version: (c[2] || '').trim() })),
    search: async (run, q) => cols((await run('flatpak', ['search', '--columns=application,name,description', q])).stdout).slice(0, 40)
      .map((c) => ({ id: c[0].trim(), name: (c[1] || c[0]).trim(), version: '', summary: (c[2] || '').trim() })),
    // The Flathub remote is added for the user if it is missing, so the install works on a fresh system.
    before: async (run) => { await run('flatpak', ['remote-add', '--user', '--if-not-exists', 'flathub', 'https://dl.flathub.org/repo/flathub.flatpakrepo']); return null; },
    installCmd: (id) => ['flatpak', ['install', '--user', '-y', '--noninteractive', 'flathub', id]],
    uninstallCmd: (id) => ['flatpak', ['uninstall', '-y', '--noninteractive', id]]
  }, runner);
}

function apt(runner, { isRoot = false } = {}) {
  return makeProvider({
    name: 'apt', label: 'APT',
    probe: (run) => run('apt-get', ['--version']),
    list: async (run) => plain('apt', lines((await run('apt-mark', ['showmanual'])).stdout).map((l) => l.trim())),
    search: async (run, q) => summarize(lines((await run('apt-cache', ['search', '--names-only', q])).stdout), /^(\S+) - (.*)$/, 'apt'),
    installCmd: (id) => priv('env', ['DEBIAN_FRONTEND=noninteractive', 'apt-get', 'install', '-y', '--', id], isRoot),
    uninstallCmd: (id) => priv('env', ['DEBIAN_FRONTEND=noninteractive', 'apt-get', 'remove', '-y', '--', id], isRoot),
    installResult: { denied: DENIED }, uninstallResult: { denied: DENIED }
  }, runner);
}

function dnf(runner, { isRoot = false } = {}) {
  return makeProvider({
    name: 'dnf', label: 'DNF',
    probe: (run) => run('dnf', ['--version']),
    list: async (run) => plain('dnf', lines((await run('dnf', ['repoquery', '--userinstalled', '--queryformat', '%{name}\\n'])).stdout).map((l) => l.trim())),
    search: async (run, q) => summarize(lines((await run('dnf', ['search', '-q', q])).stdout),
      /^([A-Za-z0-9+._-]+?)\.(?:x86_64|aarch64|noarch|i686|armv7hl|ppc64le|s390x)\s*:\s*(.*)$/, 'dnf'),
    installCmd: (id) => priv('dnf', ['install', '-y', id], isRoot),
    uninstallCmd: (id) => priv('dnf', ['remove', '-y', id], isRoot),
    installResult: { denied: DENIED }, uninstallResult: { denied: DENIED }
  }, runner);
}

function pacman(runner, { isRoot = false } = {}) {
  return makeProvider({
    name: 'pacman', label: 'pacman',
    probe: (run) => run('pacman', ['--version']),
    list: async (run) => plain('pacman', lines((await run('pacman', ['-Qqe'])).stdout).map((l) => l.trim())),
    search: async (run, q) => {
      const rows = lines((await run('pacman', ['-Ss', q])).stdout), out = [];
      for (let i = 0; i < rows.length; i++) {
        const m = /^[a-z0-9._-]+\/(\S+) (\S+)/.exec(rows[i]);
        if (m && validId('pacman', m[1])) out.push({ id: m[1], name: m[1], version: m[2], summary: (rows[i + 1] || '').trim() });
      }
      return out.slice(0, 40);
    },
    installCmd: (id) => priv('pacman', ['-S', '--noconfirm', '--needed', '--', id], isRoot),
    uninstallCmd: (id) => priv('pacman', ['-R', '--noconfirm', '--', id], isRoot),
    installResult: { denied: DENIED }, uninstallResult: { denied: DENIED }
  }, runner);
}

module.exports = { flatpak, apt, dnf, pacman, DENIED };
