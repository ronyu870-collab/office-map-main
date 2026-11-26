import { pathToFileURL } from 'node:url';
import { readEdition, version } from './edition.mjs';

const literal = value => "'" + value.replaceAll("'", "''") + "'";

export function editionImportSql(edition, apply) {
  const records = edition.map(profile => `(${literal(profile.market)}, ${literal(JSON.stringify(profile))}::jsonb)`).join(',\n');
  return `begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';
set local standard_conforming_strings = on;
create temporary table submarket_edition (market text primary key, research jsonb not null) on commit drop;
insert into submarket_edition (market,research) values
${records};

-- Lock in a stable order before checking versions. A concurrent editorial save is
-- either observed before the import or guarded by updated_at in the editor.
do $edition$
begin
  perform p.submarket
  from public.map_submarket_profiles p join submarket_edition s on s.market = p.submarket
  order by p.submarket for update of p;
  if exists (select 1 from submarket_edition s
    left join public.map_submarket_profiles p on p.submarket = s.market where p.submarket is null) then
    raise exception 'Import stopped: a market has no existing profile';
  end if;
  if exists (
    select 1 from submarket_edition s
    cross join lateral jsonb_array_elements(s.research->'projects') as item(project)
    left join public.buildings b on b.id = (item.project->>'buildingId')::uuid and b.submarket = s.market
      and b.is_active and b.tracking_scope = 'tracked' and b.project_type is distinct from 'future'
    where b.id is null
  ) then
    raise exception 'Import stopped: a representative project is missing or outside its active market';
  end if;
end
$edition$;

with target as (
  select p.submarket, p.updated_at, s.research
  from public.map_submarket_profiles p join submarket_edition s on s.market = p.submarket
  where p.is_published and p.research is null
    and not exists (select 1 from public.map_submarket_research_versions v where v.submarket = p.submarket)
), changed as (
  update public.map_submarket_profiles p
  set research = t.research, updated_at = statement_timestamp(), updated_by = null
  from target t where p.submarket = t.submarket and p.updated_at = t.updated_at
  returning p.submarket, p.research, p.updated_at
), audit as (
  insert into public.audit_logs
    (user_id, action_type, module, target_table, target_id, target_name, details, old_values, new_values)
  select 'tool:chatgpt_submarket_research', 'ADMIN_DATA_OPERATION', 'map', 'map_submarket_profiles',
    submarket, submarket, jsonb_build_object('operation','auto_publish_structured_research','edition','${version}'),
    jsonb_build_object('research',null), jsonb_build_object('research',research,'updated_at',updated_at)
  from changed
  returning target_id
)
select count(*) as updated, (select count(*) from audit) as audited from changed;

select s.market as submarket, case
  when p.research = s.research then 'edition_active'
  when not p.is_published then 'preserved_draft'
  else 'preserved_existing_or_rolled_back'
end as result
from submarket_edition s join public.map_submarket_profiles p on p.submarket = s.market
order by s.market;
${apply ? 'commit;' : 'rollback;'}
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2];
  if (!['--check', '--dry-run', '--apply'].includes(mode) || process.argv.length !== 3) {
    throw new Error('用法：import-edition.mjs --check | --dry-run | --apply');
  }
  const edition = readEdition();
  if (mode === '--check') {
    console.log(`Checked ${edition.length} profiles, ${edition.reduce((sum, item) => sum + item.sources.length, 0)} sources`);
  } else process.stdout.write(editionImportSql(edition, mode === '--apply'));
}
