import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { parseServerTiming } from './server-timing.mjs';

const require = createRequire(import.meta.url);
const fixtureId = '11111111-1111-4111-8111-111111111111';
let lag = { auth: 160, database: 10 };
let queries = 0;
const fixture = createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://127.0.0.1');
  const respond = (status, payload) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  };
  if (pathname === '/auth/v1/user' && req.headers.authorization === 'Bearer synthetic-access') {
    return setTimeout(() => respond(200, { id: fixtureId, email: 'fixture@example.test', aud: 'authenticated' }), lag.auth);
  }
  if (pathname === '/rest/v1/user_roles') return respond(200, [{ role: 'viewer' }]);
  if (pathname === '/rest/v1/buildings') {
    queries++;
    return setTimeout(() => respond(200, [{ id: fixtureId, name: '隔离候选楼宇', grade: 'A' }]), lag.database);
  }
  return respond(404, { error: 'unhandled fixture route' });
});
async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

let child;
try {
  const fixturePort = await listen(fixture);
  const reservation = createServer();
  const nextPort = await listen(reservation);
  await new Promise(resolve => reservation.close(resolve));
  const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${fixturePort}`,
    SUPABASE_SECRET_KEY: 'synthetic', PERF_ISOLATED_SERVER_TIMING: 'local' };
  delete env.VERCEL;
  delete env.VERCEL_ENV;
  child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(nextPort)],
    { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const record = chunk => { output = (output + chunk).slice(-4000); };
  child.stdout.on('data', record);
  child.stderr.on('data', record);
  const origin = `http://127.0.0.1:${nextPort}`;
  const route = '/api/map/data';
  const url = `${origin}${route}?mode=compare&scope=catalog`;
  let denied;
  for (let i = 0; i < 40 && child.exitCode === null; i++) {
    denied = await fetch(url, { signal: AbortSignal.timeout(1500) }).catch(() => undefined);
    if (denied) break;
    await delay(250);
  }
  assert.equal(denied?.status, 401, `production build did not reach the actual auth gate: ${output}`);
  assert.equal(denied.headers.get('server-timing'), null);
  assert.equal(queries, 0);

  const observations = [];
  for (const [name, auth, database] of [['slow-auth', 160, 10], ['slow-database', 10, 160]]) {
    lag = { auth, database };
    const res = await fetch(url, { headers: { Authorization: 'Bearer synthetic-access' }, signal: AbortSignal.timeout(5000) });
    assert.equal(res.status, 200, `fixture read failed: ${output}`);
    assert.deepEqual(await res.json(), { buildings: [{ id: fixtureId, name: '隔离候选楼宇', grade: 'A' }], brochures: [] });
    assert.match(res.headers.get('cache-control') ?? '', /private, no-store/);
    const stages = parseServerTiming(route, res.headers.get('server-timing'));
    assert.ok(stages, 'successful isolated response must report stages');
    assert.deepEqual(Object.keys(stages).sort(), ['auth', 'database', 'handler', 'json']);
    assert.ok(stages.handler >= Math.max(stages.auth, stages.database));
    // The fixture adds 150 ms to the selected dependency. Compare which phase
    // dominates rather than asserting a wall-clock product performance target.
    assert.ok(name === 'slow-auth' ? stages.auth > stages.database : stages.database > stages.auth,
      `did not attribute ${name}: ${JSON.stringify(stages)}`);
    observations.push({ scenario: name, injectedMs: lag, stagesMs: stages });
  }
  assert.equal(queries, 2);
  console.log(JSON.stringify({ status: 'pass', environment: 'local production build with loopback Supabase fixture', observations }));
} finally {
  if (child && child.exitCode === null) {
    child.kill();
    await once(child, 'exit');
  }
  await new Promise(resolve => fixture.close(resolve));
}
