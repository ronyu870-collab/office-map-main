// PostgreSQL-17 disposable fixture only. This is NOT a production migration
// nor an alteration of the application's default lock/publish behavior.
export async function installAi5QuarterlyFixture(client, load) {
  const existing = (await client.query("select to_regclass('public.quarterly_submissions') relation")).rows[0].relation;
  if (!existing) {
    await client.query(`create table public.quarterly_submissions (
      id uuid primary key default gen_random_uuid(),
      building_id uuid not null references public.buildings(id),
      user_id uuid, record_year integer not null, record_quarter integer not null,
      total_area double precision, vacant_area double precision, net_effective_rent double precision,
      created_at timestamptz default now(), updated_at timestamptz default now()
    )`);
    await client.query('alter table public.quarterly_submissions enable row level security');
    await client.query('revoke all on public.quarterly_submissions from public, anon, authenticated');
  }
  // Existing synthetic suite seeded "non-draft" records as formally published.
  // Preserve its fixtures *only inside disposable test DB*, with an explicit
  // local default; the dedicated AI5 PG regression separately tests unlocked rows.
  await client.query('alter table public.building_metrics alter column is_locked set default true');
  await client.query(await load('20261120095500_ai5_quarterly_sources.sql'));
}
