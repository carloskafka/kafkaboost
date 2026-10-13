'use strict';
const { makeProvider, lines } = require('./base');
const { validId } = require('./ids');

// Windows Package Manager. Its table output is localized (the header says "Nome", "ID", "Versão" on a Portuguese PC),
// so columns are found from the position of the words in the header line, not from their text.
const COMMON = ['--accept-source-agreements', '--disable-interactivity'];
const ALREADY = [0x8A150061, 0x8A15002B];   // package already installed / no applicable upgrade

function parseTable(stdout) {
  const rows = lines(stdout);
  const dash = rows.findIndex((l) => /^-{5,}\s*$/.test(l));
  if (dash < 1) return [];
  const starts = [...rows[dash - 1].matchAll(/\S+(?: \S+)*/g)].map((m) => m.index);
  if (starts.length < 2) return [];
  const out = [];
  for (const row of rows.slice(dash + 1)) {
    if (!row.trim() || row.length <= starts[1]) continue;
    const cell = (i) => row.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : undefined).trim();
    out.push({ name: cell(0), id: cell(1), version: starts.length > 2 ? cell(2) : '' });
  }
  return out;
}

// Only ids that winget can install again (Publisher.Package). Entries it lists as MSIX\... or ARP\... are not installable by id.
const installable = (rows) => rows.filter((r) => validId('winget', r.id));

module.exports = (runner) => makeProvider({
  name: 'winget', label: 'winget',
  probe: (run) => run('winget', ['--version']),
  list: async (run) => installable(parseTable((await run('winget', ['list', ...COMMON])).stdout)),
  search: async (run, q) => installable(parseTable((await run('winget', ['search', q, '--source', 'winget', ...COMMON])).stdout)).slice(0, 40),
  installCmd: (id) => ['winget', ['install', '--id', id, '--exact', '--source', 'winget', '--silent', '--accept-package-agreements', ...COMMON]],
  uninstallCmd: (id) => ['winget', ['uninstall', '--id', id, '--exact', '--silent', ...COMMON]],
  installResult: { okCodes: [0, ...ALREADY], already: ALREADY }
}, runner);
module.exports.parseTable = parseTable;
