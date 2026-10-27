import React from 'react';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
// @ts-expect-error The existing pg dependency is JavaScript-only; this adapter runs only in disposable tests.
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { TableConfig } from '@/src/components/admin/types';
import { NextRequest } from 'next/server';

const ADMIN = '33333333-3333-4333-8333-333333333333';
const BUILDING = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
vi.mock('@/src/services/Auth', () => ({ getSession: async () => ({ user: { id: '33333333-3333-4333-8333-333333333333' }, role: 'admin' }) }));
// Client analytics are outside this test. Authoritative database audits remain real.
vi.mock('@/src/utils/audit', () => ({ logAction: vi.fn() }));
vi.mock('ag-grid-react', () => ({ AgGridReact: React.forwardRef(function UnmountedDesktopEngine() { return null; }) }));
vi.mock('@/src/lib/server/impersonationAuth', () => ({ resolveEffectiveRequestIdentity: async () => ({ identity: { effectiveRole: 'admin' } }) }));
import { GridPanel } from '@/src/components/admin/grid/GridPanel';
import { supabase } from '@/src/services/supabaseClient';
import { resolveBuildingId } from '@/src/services/buildingIdentity';
import { GET as mapDataGet } from '@/src/app/api/map/data/route';

const config: TableConfig = { table: 'buildings', label: '项目基础信息', uploadMatchKeys: ['name'], cols: [
  { key: 'id', label: 'ID', type: 'uuid', readOnly: true, hidden: true },
  { key: 'name', label: '项目名称', type: 'text', required: true },
  { key: 'former_names', label: '曾用名', type: 'tags' },
] };
const dicts = {};
let pool: pg.Pool;
let server: Server;
const requests: Array<{ method: string; query: string; status: number; params?: Record<string, unknown> }> = [];

beforeAll(async () => {
  assert.match(process.env.BUILDING_RENAME_TEST_DB ?? '', /^lease_synthetic_[a-f0-9]+$/);
  assert.ok(process.env.GITHUB_ACTIONS === 'true' || process.env.LEASE_TEST_ALLOW_LOCAL === 'disposable');
  const port = Number(process.env.LEASE_TEST_PG_PORT);
  assert.ok(Number.isInteger(port) && port > 0);
  pool = new pg.Pool({ host: '127.0.0.1', port, user: 'postgres', password: 'synthetic_ci_only', database: process.env.BUILDING_RENAME_TEST_DB, max: 3 });
  const columnSets = new Map<string, Set<string>>();
  for (const table of ['buildings', 'building_metrics']) columnSets.set(table, new Set((await pool.query("select column_name from information_schema.columns where table_schema='public' and table_name=$1", [table])).rows.map((r: { column_name: string }) => r.column_name)));
  server = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    res.setHeader('access-control-allow-origin', '*');
    const url = new URL(req.url!, 'http://127.0.0.1');
    const renameRpc = url.pathname === '/rest/v1/rpc/admin_rename_building';
    const resolveRpc = url.pathname === '/rest/v1/rpc/resolve_building_id';
    const table = url.pathname === '/rest/v1/building_metrics' ? 'building_metrics' : 'buildings';
    const columns = columnSets.get(table)!;
    if ((!renameRpc && !resolveRpc && !['/rest/v1/buildings', '/rest/v1/building_metrics'].includes(url.pathname)) || req.headers.authorization !== 'Bearer synthetic-gateway-key') {
      res.writeHead(403); res.end(JSON.stringify({ message: 'Synthetic gateway only' })); return;
    }
    const client = await pool.connect();
    const args: unknown[] = [];
    const filters: string[] = [];
    let mutationParams: Record<string, unknown> | undefined;
    const quote = (name: string) => { assert.ok(columns.has(name)); return '"' + name + '"'; };
    try {
      await client.query('begin');
      await client.query("select set_config('request.jwt.claim.sub',$1,true)", [ADMIN]);
      await client.query('set local role authenticated');
      for (const [key, value] of url.searchParams) {
        if (['select', 'order', 'offset', 'limit'].includes(key)) continue;
        if (key === 'or') { assert.equal(value, '(project_type.neq.future,project_type.is.null)'); filters.push("(project_type<>'future' or project_type is null)"); continue; }
        if (value === 'is.null') filters.push(quote(key) + ' is null');
        else {
          assert.ok(value.startsWith('eq.'));
          args.push(value.slice(3));
          filters.push(quote(key) + '=$' + args.length + (key === 'former_names' ? '::jsonb' : ''));
        }
      }
      let sql: string;
      if (resolveRpc) {
        let raw = ''; for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw);
        args.push(body.p_id);
        sql = 'select public.resolve_building_id($1) id';
      } else if (renameRpc) {
        assert.equal(req.method, 'POST');
        let raw = ''; for await (const chunk of req) raw += chunk;
        mutationParams = JSON.parse(raw);
        const body = mutationParams!;
        assert.deepEqual(Object.keys(body).sort(), ['p_id','p_expected_name','p_expected_former_names','p_new_name','p_former_names'].sort());
        args.push(body.p_id, body.p_expected_name, body.p_expected_former_names == null ? null : JSON.stringify(body.p_expected_former_names), body.p_new_name, body.p_former_names == null ? null : JSON.stringify(body.p_former_names));
        sql = 'select * from public.admin_rename_building($1,$2,$3::jsonb,$4,$5::jsonb)';
      } else if (req.method === 'PATCH') {
        let raw = ''; for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw);
        const updates = Object.entries(body).map(([key, value]) => {
          assert.notEqual(key, 'id');
          args.push(key === 'former_names' ? JSON.stringify(value) : value);
          return quote(key) + '=$' + args.length + (key === 'former_names' ? '::jsonb' : '');
        });
        assert.ok(filters.length && updates.length);
        sql = 'update public.buildings set ' + updates.join(',') + ' where ' + filters.join(' and ') + ' returning *';
      } else {
        assert.equal(req.method, 'GET');
        sql = 'select * from public.' + table + (filters.length ? ' where ' + filters.join(' and ') : '') + ' order by id';
      }
      const result = await client.query(sql, args);
      await client.query('commit');
      requests.push({ method: req.method!, query: url.search, status: 200, params: mutationParams });
      res.writeHead(200); res.end(JSON.stringify(resolveRpc ? result.rows[0].id : result.rows));
    } catch (error) {
      await client.query('rollback');
      const failure = error as { code?: string; message: string };
      requests.push({ method: req.method!, query: url.search, status: 409, params: mutationParams });
      res.writeHead(409); res.end(JSON.stringify({ code: failure.code, message: failure.message, details: null, hint: null }));
    } finally { client.release(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:' + address.port);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'synthetic-gateway-key');
  vi.stubEnv('SUPABASE_SECRET_KEY', 'synthetic-gateway-key');
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => cleanup());
afterAll(async () => {
  vi.unstubAllEnvs(); vi.unstubAllGlobals();
  await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); });
  await pool.end();
});
async function open(name: string) {
  render(<GridPanel config={config} dicts={dicts} />);
  const title = await screen.findByRole('button', { name });
  fireEvent.click(within(title.closest('li')!).getByRole('button', { name: '编辑' }));
  return screen.findByRole('dialog', { name: '编辑记录' });
}
describe('real GridPanel -> shared Supabase SDK -> loopback Data API test adapter -> PostgreSQL 17', () => {
  it('resolves a retained old ID through the shared SDK and excludes its archive from the editor list', async () => {
    const old = 'cccccccc-cccc-4ccc-8ccc-000000000001';
    expect(await resolveBuildingId(supabase, old)).toBe('cccccccc-cccc-4ccc-8ccc-000000000002');
    render(<GridPanel config={config} dicts={dicts} />);
    await screen.findByRole('button', { name: 'Synthetic merged renamed' });
    expect(screen.queryByRole('button', { name: 'Synthetic merge tower' })).toBeNull();
    const response = await mapDataGet(new NextRequest('https://synthetic.invalid/api/map/data?mode=trend&building_id=' + old));
    expect(response.status).toBe(200);
    const trend = await response.json();
    expect(trend.building_id).toBe('cccccccc-cccc-4ccc-8ccc-000000000002');
    expect(trend.metrics).toHaveLength(2);
    expect(trend.metrics.some((row: { is_locked: boolean; record_quarter: number }) => row.is_locked && row.record_quarter === 2)).toBe(true);
  });
  it('edits the existing project and reads back both names, maps and original ID', async () => {
    const editor = await open('Synthetic Tower');
    fireEvent.change(within(editor).getByLabelText(/项目名称/), { target: { value: 'UI renamed' } });
    fireEvent.click(within(editor).getByRole('button', { name: '保存' }));
    await screen.findByRole('button', { name: 'UI renamed' });
    expect(screen.queryByRole('dialog', { name: '编辑记录' })).toBeNull();
    const b = (await pool.query('select * from public.buildings where id=$1', [BUILDING])).rows[0];
    const f = (await pool.query('select * from public.future_supplies where building_id=$1', [BUILDING])).rows[0];
    expect(b.former_names).toContain('Synthetic Tower');
    expect(f.name).toBe(b.name); expect(f.former_names).toEqual(b.former_names);
    expect((await pool.query("select count(*)::int n from public.lease_building_name_map where alias_name in ('UI renamed','Synthetic Tower') and building_id=$1", [BUILDING])).rows[0].n).toBe(2);
    const write = requests.find(r => r.method === 'POST' && r.status === 200 && r.params?.p_new_name === 'UI renamed')!;
    expect(write.params?.p_id).toBe(BUILDING);
    expect(write.params?.p_expected_name).toBe('Synthetic Tower');
    expect(Array.isArray(write.params?.p_expected_former_names)).toBe(true);
    expect(write.params?.p_new_name).toBe('UI renamed');
    expect(write.params).not.toHaveProperty('notes');
  });
  it('retains input after an actual database conflict and saves a corrected name on retry', async () => {
    const editor = await open('UI renamed');
    fireEvent.change(within(editor).getByLabelText(/项目名称/), { target: { value: 'Synthetic 3' } });
    fireEvent.click(within(editor).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(within(editor).getByRole('button', { name: '保存' })).toBeEnabled());
    expect(within(editor).getByLabelText(/项目名称/)).toHaveValue('Synthetic 3');
    expect((await pool.query('select name from public.buildings where id=$1', [BUILDING])).rows[0].name).toBe('UI renamed');
    expect(requests.some(r=>r.status===409)).toBe(true);
    fireEvent.change(within(editor).getByLabelText(/项目名称/), { target: { value: 'UI final name' } });
    fireEvent.click(within(editor).getByRole('button', { name: '保存' }));
    await screen.findByRole('button', { name: 'UI final name' });
  });
  it('saves multiline aliases through the actual field and SDK as a JSON array', async () => {
    const editor = await open('UI final name');
    fireEvent.change(within(editor).getByLabelText('曾用名'), { target: { value: 'UI extra（east, west）\nUI extra（east, west）' } });
    fireEvent.click(within(editor).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑记录' })).toBeNull());
    const b=(await pool.query('select * from public.buildings where id=$1',[BUILDING])).rows[0];
    expect(b.former_names).toContain('UI extra（east, west）'); expect(b.former_names).toContain('Synthetic Tower');
    expect(b.former_names.filter((n: string)=>n==='UI extra（east, west）')).toHaveLength(1);
  });
});
