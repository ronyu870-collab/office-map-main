// Profiles retain explicit source coverage; database-only never counts as complete.
const definitions = {
  supabase: { sources: ['supabase-storage'], coverage: 'database-and-supabase-storage' },
  full: { sources: ['supabase-storage', 'ali-oss'], coverage: 'database-and-current-objects' },
  'database-only': { sources: [], coverage: 'database-only' },
};
export function profileDefinition(profile) {
  const definition = definitions[profile];
  if (!Object.hasOwn(definitions, profile)) throw new Error('INVALID_BACKUP_PROFILE');
  return definition;
}
export const selectedProfile = (env) => { const profile = env.BACKUP_PROFILE || 'supabase'; profileDefinition(profile); return profile; };
