import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { parseServerTiming } from './server-timing.mjs';

const require = createRequire(import.meta.url);
const fixtureId = '11111111-1111-4111-8111-111111111111';
const adminId = '22222222-2222-4222-8222-222222222222';
const directoryCalls = { profiles: 0, authDirectory: 0, stock: 0, future: 0 };
let releaseAssignments;
const heldAssignments = new Promise(resolve => { releaseAssignments = resolve; });
let lag = { auth: 160, database: 10 };
let queries = 0;
const fixture = createServer((req, res) => {
  const { pathname, searchParams } = new URL(req.url, 'http://127.0.0.1');
  const respond = (status, payload) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  };
  if (pathname === '/auth/v1/user' && req.headers.authorization === 'Bearer synthetic-access') {
    return setTimeout(() => respond(200, { id: fixtureId, email: 'fixture@example.test', aud: 'authenticated' }), lag.auth);
  }
  if (pathname === '/auth/v1/user' && req.headers.authorization === 'Bearer synthetic-admin-access') {
    return respond(200, { id: adminId, email: 'admin@example.test', aud: 'authenticated' });
  }
  if (pathname === '/rest/v1/user_roles') {
    const user = searchParams.get('user_id');
    if (searchParams.get('select') === 'role') return respond(200, [{ role: user === `eq.${adminId}` ? 'admin' : 'viewer' }]);
    if (user) return respond(200, [{ user_id: fixtureId, role: 'viewer', email: 'fixture@example.test' }]);
    directoryCalls.profiles++;
    return respond(200, [{ user_id: fixtureId, role: 'viewer', email: 'profile@example.test' }]);
  }
  if (pathname === '/auth/v1/admin/users') {
    directoryCalls.authDirectory++;
    return respond(200, { users: [{ id: fixtureId, email: 'directory@example.test', banned_until: '2099-01-01T00:00:00Z' }], aud: 'authenticated' });
  }
  if (pathname === '/rest/v1/building_assignments') {
    directoryCalls.stock++;
    return void heldAssignments.then(() => respond(200, [{ user_id: fixtureId }, { user_id: fixtureId }]));
  }
  if (pathname === '/rest/v1/future_supply_assignments') {
    directoryCalls.future++;
    return void heldAssignments.then(() => respond(200, [
      { user_id: fixtureId, record_year: 2020, record_quarter: 4 },
      { user_id: fixtureId, record_year: 2099, record_quarter: 1 },
    ]));
  }
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

  const adminRoute = '/api/admin/users';
  const adminHeaders = { Authorization: 'Bearer synthetic-admin-access' };
  const getAdminView = (view, headers) => fetch(`${origin}${adminRoute}?view=${view}`, { headers, signal: AbortSignal.timeout(7000) });
  for (const view of ['directory', 'assignments']) {
    const denied = await getAdminView(view);
    assert.equal(denied.status, 401);
    const viewer = await getAdminView(view, { Authorization: 'Bearer synthetic-access' });
    assert.equal(viewer.status, 403);
    const simulatedViewer = await getAdminView(view, { ...adminHeaders, 'x-colliers-impersonate-user': fixtureId });
    assert.equal(simulatedViewer.status, 403);
    assert.equal(simulatedViewer.headers.get('server-timing'), null);
  }
  assert.deepEqual(directoryCalls, { profiles: 0, authDirectory: 0, stock: 0, future: 0 });
  const countResponse = getAdminView('assignments', adminHeaders);
  // Observe failures even if the assertion about the independent directory fails first.
  void countResponse.catch(() => {});
  for (let i = 0; i < 60 && (directoryCalls.stock === 0 || directoryCalls.future === 0); i++) await delay(50);
  assert.deepEqual(directoryCalls, { profiles: 0, authDirectory: 0, stock: 1, future: 1 });

  const directory = await getAdminView('directory', adminHeaders);
  assert.equal(directory.status, 200, `directory did not return while assignments were held: ${output}`);
  assert.equal(directory.headers.get('cache-control'), 'private, no-store');
  const { users } = await directory.json();
  assert.equal(users.length, 1);
  assert.deepEqual([users[0].email, users[0].role, users[0].disabled], ['directory@example.test', 'user', true]);
  assert.ok(!Object.hasOwn(users[0], 'stock_assignment_count'));
  assert.deepEqual(Object.keys(parseServerTiming(adminRoute, directory.headers.get('server-timing'))).sort(), ['auth', 'auth-directory', 'handler', 'json', 'profiles']);
  assert.deepEqual(directoryCalls, { profiles: 1, authDirectory: 1, stock: 1, future: 1 });

  releaseAssignments();
  const counts = await countResponse;
  assert.equal(counts.status, 200);
  assert.equal(counts.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await counts.json(), { assignments: [{ user_id: fixtureId, stock_assignment_count: 2, future_assignment_count: 1 }] });
  assert.deepEqual(Object.keys(parseServerTiming(adminRoute, counts.headers.get('server-timing'))).sort(), ['auth', 'future-assignments', 'handler', 'json', 'stock-assignments']);
  console.log(JSON.stringify({ status: 'pass', environment: 'local production build with loopback Supabase fixture', observations,
    adminDirectory: { listBeforeAssignments: true, directoryCalls, deniedRoles: ['anonymous', 'viewer', 'simulated-viewer'] } }));
} finally {
  releaseAssignments();
  if (child && child.exitCode === null) {
    child.kill();
    await once(child, 'exit');
  }
  await new Promise(resolve => fixture.close(resolve));
}
