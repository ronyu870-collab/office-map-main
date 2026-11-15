import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const QUERY_P0_BASELINE = '0ae6e4dbcc63c3a557ee05ed70bba016a1ee4a7c';

/** Build the actual P0 source against the same disposable Auth/database.
 * No source edits, fake authorization, production credentials or mutable main ref.
 */
export async function startQueryPerformanceBaseline({ root, env, log, until }) {
  assert.equal(env.AI_QUERY_AUTH_ALLOW_LOCAL, 'disposable');
  assert.equal(new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname, '127.0.0.1');
  const directory = await mkdtemp(path.join(tmpdir(), 'colliers-query-p0-'));
  const app = 'http://127.0.0.1:3290';
  let server;
  const close = async () => {
    if (server && server.exitCode === null && server.signalCode === null) {
      const stopped = once(server, 'exit'); server.kill('SIGTERM'); await stopped;
    }
    await rm(directory, { recursive: true, force: true });
  };
  try {
    const archive = spawn('git', ['archive', '--format=tar', QUERY_P0_BASELINE], { cwd: root, stdio: ['ignore', 'pipe', log.fd] });
    const unpack = spawn('tar', ['-xf', '-', '-C', directory], { stdio: ['pipe', log.fd, log.fd] });
    archive.stdout.pipe(unpack.stdin);
    const exits = await Promise.all([once(archive, 'exit'), once(unpack, 'exit')]);
    assert.ok(exits.every(([code]) => code === 0), 'The exact P0 archive must be available');
    assert.deepEqual(await readFile(path.join(directory, 'package-lock.json')), await readFile(path.join(root, 'package-lock.json')),
      'A/B must use identical installed dependencies; install a separate baseline if the lockfile changes');
    await symlink(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'dir');
    const build = spawn('npm', ['run', 'build'], { cwd: directory, env, stdio: ['ignore', log.fd, log.fd] });
    assert.equal((await once(build, 'exit'))[0], 0, 'The actual P0 production build must pass');
    server = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', '3290'],
      { cwd: directory, env, stdio: ['ignore', log.fd, log.fd] });
    await until(async () => {
      try { return (await fetch(app + '/api/intelligence/query', { signal: AbortSignal.timeout(1000) })).status === 405; }
      catch { return false; }
    }, 'P0 production server startup');
    return { app, commit: QUERY_P0_BASELINE, close };
  } catch (error) { await close(); throw error; }
}
