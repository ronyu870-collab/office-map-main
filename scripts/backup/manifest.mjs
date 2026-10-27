const sources = ['supabase-storage', 'ali-oss'];
const identity = (source, object) => JSON.stringify([source, object?.bucket, object?.name]);
export const validDigest = (x) => /^[a-f0-9]{64}$/.test(x?.sha256 ?? '') && Number.isSafeInteger(x?.bytes) && x.bytes >= 0;
export function validateManifest(m, c, run) {
  if (m.format !== 1 || m.run !== run || m.project !== c.project || !['full', 'database-only'].includes(m.profile) || !Array.isArray(m.entries) || !Array.isArray(m.inventories) || !Array.isArray(m.evidence) || !Array.isArray(m.schemas) || !(m.serverVersion >= 170000 && m.serverVersion < 180000)) throw new Error('BACKUP_MANIFEST_INVALID');
  if (m.entries.filter((e) => e.kind === 'database').length !== 1 || m.entries.filter((e) => e.kind === 'roles').length !== 1 || m.entries.some((e) => !['database', 'roles', 'object'].includes(e.kind) || !validDigest(e.plain) || !validDigest(e.cipher))) throw new Error('BACKUP_MANIFEST_INVALID');
  if (!Array.isArray(m.extensions) || m.extensions.some((e) => typeof e.name !== 'string' || typeof e.version !== 'string' || typeof e.schema !== 'string')) throw new Error('BACKUP_MANIFEST_INVALID');
  if (m.profile === 'full' ? m.inventories.length !== 2 || !sources.every((s) => m.inventories.some((i) => i.source === s)) : m.inventories.length !== 0) throw new Error('BACKUP_MANIFEST_INVALID');
  const expected = new Set(); const actual = new Set();
  for (const inventory of m.inventories) {
    if (!sources.includes(inventory.source) || !Array.isArray(inventory.items)) throw new Error('BACKUP_MANIFEST_INVALID');
    for (const item of inventory.items.filter((o) => o.kind === 'object')) {
      const id = identity(inventory.source, item);
      if (expected.has(id) || typeof item.name !== 'string' || typeof item.bucket !== 'string') throw new Error('BACKUP_MANIFEST_INVALID');
      expected.add(id);
    }
  }
  for (const entry of m.entries.filter((e) => e.kind === 'object')) {
    const id = identity(entry.source, entry.object);
    if (!expected.has(id) || actual.has(id)) throw new Error('BACKUP_MANIFEST_INVALID');
    actual.add(id);
  }
  if (expected.size !== actual.size) throw new Error('BACKUP_MANIFEST_INVALID');
}
