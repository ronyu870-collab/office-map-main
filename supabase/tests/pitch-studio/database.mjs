import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
export const OWNER='11111111-1111-4111-8111-111111111111', OTHER='22222222-2222-4222-8222-222222222222', ADMIN='33333333-3333-4333-8333-333333333333', VIEWER='44444444-4444-4444-8444-444444444444';
export const sessionFor=uid=>uid.replace(/^[1-4]/,'a');
export async function createPitchDatabase() {
  assert.ok(process.env.GITHUB_ACTIONS==='true'||process.env.PITCH_TEST_ALLOW_LOCAL==='disposable');
  const port=Number(process.env.PITCH_TEST_PG_PORT);assert.ok(Number.isInteger(port)&&port>0&&port<65536);
  const config={host:'127.0.0.1',port,user:'postgres',password:'synthetic_ci_only',connectionTimeoutMillis:5000};
  const admin=new pg.Client({...config,database:'postgres'});await admin.connect();
  const database='pitch_synthetic_'+randomUUID().replaceAll('-','');let setup;
  try {
    assert.equal(Math.floor(Number((await admin.query("select current_setting('server_version_num') n")).rows[0].n)/10000),17);
    for(const role of ['anon','authenticated','service_role'])if(!(await admin.query('select 1 from pg_roles where rolname=$1',[role])).rowCount)await admin.query(`create role ${role}`);
    await admin.query(`create database ${database}`);setup=new pg.Client({...config,database});await setup.connect();
    await setup.query(`create schema auth;create schema private;create schema storage;
      create table auth.users(id uuid primary key,deleted_at timestamptz,banned_until timestamptz);
      create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),not_after timestamptz);
      create table public.user_roles(user_id uuid primary key references auth.users(id),role text not null);
      create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
      alter table storage.objects enable row level security;
      grant usage on schema auth,public,storage to authenticated,anon,service_role;
      grant select,insert,update,delete on storage.objects to authenticated;
      grant select on user_roles to service_role;
    `);
    for(const [id,role] of [[OWNER,'editor'],[OTHER,'editor'],[ADMIN,'admin'],[VIEWER,'viewer']]) {
      await setup.query('insert into auth.users(id) values($1);',[id]);
      await setup.query('insert into public.user_roles values($1,$2)',[id,role]);
      await setup.query("insert into auth.sessions values($1,$2,now()+interval '1 day')",[sessionFor(id),id]);
    }
    for (const migration of ['20261125165826_pitch_studio_foundation.sql', '20261125174626_pitch_studio_render_engine.sql', '20261125182357_pitch_studio_material_library.sql', '20261125192547_pitch_studio_business_templates.sql', '20261125201503_pitch_studio_workspace.sql', '20261126083359_pitch_studio_template_ecosystem.sql', '20261126090000_pitch_studio_ai.sql', '20261126163000_pitch_workspace_revision_apply.sql']) await setup.query(await readFile(new URL('../../migrations/' + migration,import.meta.url),'utf8'));
    await setup.query(await readFile(new URL('../../migrations/20261127090006_pitch_workspace_document_jobs.sql',import.meta.url),'utf8'));
    await setup.query(await readFile(new URL('../../migrations/20261127090106_pitch_document_delivery.sql',import.meta.url),'utf8'));
    await setup.query(await readFile(new URL('../../migrations/20261127090206_pitch_workspace_bindings.sql',import.meta.url),'utf8'));
    await setup.query(await readFile(new URL('../../migrations/20261127090306_pitch_workspace_handoff_replay.sql',import.meta.url),'utf8'));
    await setup.query(await readFile(new URL('../../migrations/20261127090406_pitch_workspace_shares.sql',import.meta.url),'utf8'));
    return {setup,config,database,
      async grant(uid,region='test-region',extra={}) {
        await setup.query(`insert into private.pitch_grants(user_id,organization_id,region,city,business_line,can_generate,maintainer,can_client_export,can_external_ai,valid_until,granted_by)
          values($1,'synthetic-org',$2,'test-city','test-line',true,$3,$4,$5,now()+interval '1 day',$6)`,[uid,region,extra.maintainer??false,extra.client??false,extra.ai??false,ADMIN]);
      },
      async asUser(uid,sql,params=[]) {
        await setup.query('begin');try{
          await setup.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:uid,session_id:sessionFor(uid)})]);
          await setup.query('set local role authenticated');const out=await setup.query(sql,params);await setup.query('commit');return out;
        } catch(error){await setup.query('rollback');throw error;}
      },
      async rpc(uid,input){
        await setup.query('begin');try{
          await setup.query('set local role service_role');
          const out=await setup.query('select public.pitch_studio_access($1,$2,$3) result',[uid,sessionFor(uid),input]);await setup.query('commit');return out.rows[0].result;
        }catch(error){await setup.query('rollback');throw error;}
      },
      async close(){await setup.end();await admin.query(`drop database ${database} with(force)`);await admin.end();}
    };
  }catch(error){await setup?.end();await admin.query(`drop database if exists ${database} with(force)`);await admin.end();throw error;}
}
