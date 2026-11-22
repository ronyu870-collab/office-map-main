/* eslint-disable @typescript-eslint/no-require-imports -- Node --require preload must execute before ESM or provider SDK initialization. */
// Applied to the curated offline runner and every Node subprocess. No native
// subprocess escapes: these checks never need curl, shell or another runtime.
const net = require('node:net');
const child = require('node:child_process');
const threads = require('node:worker_threads');
const { syncBuiltinESMExports } = require('node:module');
const guard = __filename;
process.env.COLLIERS_EVAL_OFFLINE = '1';
const local = host => ['localhost', '127.0.0.1', '::1'].includes(host);
const denied = () => { throw Error('EVALUATION_EXTERNAL_IO_BLOCKED'); };
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = args[0];
  const options = Array.isArray(first) ? first[0] : first;
  // Local IPC sockets and loopback Auth/PG are allowed; external IP/DNS is not.
  const host = typeof options === 'object' ? options?.host ?? options?.hostname ?? 'localhost'
    : typeof args[1] === 'string' ? args[1] : 'localhost';
  if (!local(host)) denied();
  return connect.apply(this, args);
};
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  if (!local(new URL(typeof input === 'string' || input instanceof URL ? input : input.url).hostname)) denied();
  return originalFetch(input, options);
};
for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
  const original = child[name];
  child[name] = function (command, args, options, ...rest) {
    if (command !== process.execPath) denied();
    const opts = { ...options, env: { ...(options?.env ?? process.env),
      NODE_OPTIONS: `--require=${guard}`, COLLIERS_EVAL_OFFLINE: '1' } };
    return original.call(this, command, args, opts, ...rest);
  };
}
const fork = child.fork;
child.fork = function (file, args, options) {
  return fork.call(this, file, args, { ...options, execPath: process.execPath,
    execArgv: [...(options?.execArgv ?? process.execArgv), '--require', guard], env: { ...(options?.env ?? process.env), NODE_OPTIONS: `--require=${guard}`, COLLIERS_EVAL_OFFLINE: '1' } });
};
const OriginalWorker = threads.Worker;
threads.Worker = class OfflineWorker extends OriginalWorker {
  constructor(file, options = {}) {
    super(file, { ...options, execArgv: [...(options.execArgv ?? process.execArgv), '--require', guard],
      env: options.env === threads.SHARE_ENV ? threads.SHARE_ENV
        : { ...(options.env ?? process.env), NODE_OPTIONS: `--require=${guard}`, COLLIERS_EVAL_OFFLINE: '1' } });
  }
};
child.exec = child.execSync = denied;
syncBuiltinESMExports();
