import { required } from './common.mjs';
export function targetConfiguration(env = process.env, { synthetic = false } = {}) {
  const project = required(env, 'BACKUP_PROJECT_REF');
  const account = required(env, 'BACKUP_R2_ACCOUNT_ID');
  const bucket = required(env, 'BACKUP_R2_BUCKET');
  if (!/^[a-z0-9]{20}$/.test(project) || !/^[a-f0-9]{32}$/.test(account) || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error('INVALID_TARGET_CONFIGURATION');
  return { project, account, bucket, prefix: `backups/${project}/`, synthetic,
    ageBin: env.BACKUP_AGE_BIN || 'age',
    cloudflareToken: synthetic ? undefined : required(env, 'BACKUP_CF_CONFIG_READ_TOKEN'),
    credentials: { accessKeyId: required(env, 'BACKUP_R2_ACCESS_KEY_ID'), secretAccessKey: required(env, 'BACKUP_R2_SECRET_ACCESS_KEY') },
    endpoint: synthetic ? required(env, 'BACKUP_TEST_S3_ENDPOINT') : `https://${account}.r2.cloudflarestorage.com`,
  };
}
export function configuration(env = process.env, { synthetic = false } = {}) {
  const project = required(env, 'BACKUP_PROJECT_REF');
  const account = required(env, 'BACKUP_R2_ACCOUNT_ID');
  const bucket = required(env, 'BACKUP_R2_BUCKET');
  if (!/^[a-z0-9]{20}$/.test(project) || !/^[a-f0-9]{32}$/.test(account) || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error('INVALID_TARGET_CONFIGURATION');
  const database = new URL(required(env, 'BACKUP_DATABASE_URL'));
  if (!['postgres:', 'postgresql:'].includes(database.protocol)) throw new Error('INVALID_DATABASE_PROTOCOL');
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname);
  if (synthetic && !local) throw new Error('SYNTHETIC_REQUIRES_LOCALHOST');
  if (!synthetic && (local || !env.BACKUP_DB_ALLOWED_HOSTS?.split(',').map((host) => host.trim()).includes(database.hostname))) throw new Error('DATABASE_HOST_NOT_APPROVED');
  if ([...database.searchParams.keys()].some((k) => k !== 'sslmode') || (database.searchParams.has('sslmode') && !['verify-full'].includes(database.searchParams.get('sslmode')))) throw new Error('DATABASE_TLS_CONFIGURATION_REJECTED');
  const pg = { host: database.hostname, port: Number(database.port || 5432), database: decodeURIComponent(database.pathname.slice(1)), user: decodeURIComponent(database.username), password: decodeURIComponent(database.password) };
  if (!pg.database || !pg.user || !pg.password) throw new Error('DATABASE_CREDENTIALS_REQUIRED');
  if (!synthetic && database.hostname !== `db.${project}.supabase.co` && !(database.hostname.endsWith('.pooler.supabase.com') && pg.user.endsWith(`.${project}`))) throw new Error('DATABASE_PROJECT_MISMATCH');
  const recipient = required(env, 'BACKUP_AGE_RECIPIENT');
  if (!/^age1[0-9a-z]{50,100}$/.test(recipient)) throw new Error('INVALID_AGE_RECIPIENT');
  const profile = env.BACKUP_PROFILE || 'full';
  if (!['full', 'database-only'].includes(profile)) throw new Error('INVALID_BACKUP_PROFILE');
  return {
    ...targetConfiguration(env, { synthetic }), pg,
    pgBin: env.BACKUP_PG_BIN || '',
    caFile: synthetic ? undefined : required(env, 'BACKUP_PG_CA_FILE'),
    recipient,
    sources: {
      supabase: { url: `https://${project}.supabase.co`, key: env.BACKUP_STORAGE_SERVICE_KEY },
      oss: { accessKeyId: env.BACKUP_OSS_ACCESS_KEY_ID, accessKeySecret: env.BACKUP_OSS_ACCESS_KEY_SECRET, region: env.BACKUP_OSS_REGION, bucket: env.BACKUP_OSS_BUCKET },
    },
    profile,
  };
}
