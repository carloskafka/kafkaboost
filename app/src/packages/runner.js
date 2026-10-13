'use strict';
const { execFile } = require('child_process');

// The only place that starts a process. execFile with an args array: no shell, so no quoting or injection issues.
// It never rejects: failures come back as { code, stdout, stderr, error } so providers can map them to messages.
// A runner is any async (cmd, args, opts) => { code, stdout, stderr, error? }; tests inject a fake one.
function defaultRunner(cmd, args = [], opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, {
      windowsHide: true, timeout: opts.timeout || 15 * 60 * 1000, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8', env: opts.env || process.env
    }, (err, stdout, stderr) => {
      if (!err) return resolve({ code: 0, stdout: stdout || '', stderr: stderr || '' });
      const missing = err.code === 'ENOENT';
      resolve({ code: typeof err.code === 'number' ? err.code : -1, stdout: stdout || '', stderr: stderr || (missing ? '' : err.message), error: missing ? 'ENOENT' : (err.killed ? 'TIMEOUT' : undefined) });
    });
  });
}

module.exports = { defaultRunner };
