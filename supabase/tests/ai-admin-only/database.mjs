import { readFile } from 'node:fs/promises';
export const migration = '20261113123123_ai_admin_only_access.sql';
export async function loadAuditPrerequisites(db) {
  for (const file of ['20261113032515_ai_query_http_security.sql',
    '20261113084732_ai_query_atomic_intake.sql', '20261113090954_ai_audit_console_read.sql']) {
    await db.setup.query(await readFile(new URL('../../migrations/' + file, import.meta.url), 'utf8'));
  }
}
export async function applyAdminOnly(db) {
  await db.setup.query(await readFile(new URL('../../migrations/' + migration, import.meta.url), 'utf8'));
}
