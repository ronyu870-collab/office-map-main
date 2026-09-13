import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

const route = source('src/app/api/oss/route.ts');
const manager = source('src/components/OSSManager.tsx');
const auditCoverage = source('scripts/check-audit-coverage.mjs');

describe('OSS authoritative audit contract', () => {
  it('persists create, delete, and move mutations from the authenticated server route', () => {
    expect(route).toContain("import { writeAuditBestEffort } from '@/src/lib/serverAudit'");
    expect(route).toContain("request_source: 'server'");
    expect(route).toContain("authority: 'server'");
    expect(route).toContain("await writeOssAudit(verified, 'OSS_CREATE_FOLDER'");
    expect(route).toContain("await writeOssAudit(verified, 'OSS_DELETE'");
    expect(route).toContain("await writeOssAudit(verified, 'OSS_MOVE'");
  });

  it('records real partial stats for recursive folder mutations', () => {
    expect(route).toContain("outcome: result.success ? 'success' : 'partial'");
    expect(route).toContain('stats: result.stats');
    expect(route).toContain('stage: result.stage');
    expect(route).toContain("stage: 'delete-source'");
  });

  it('treats file copy success plus source-delete failure as a partial move', () => {
    expect(route).toContain("const stats: MoveStats = { total: 1, copied: 1, deleted: 0, failed: 1 }");
    expect(route).toContain("const message = '新文件已创建，但旧文件未能删除'");
    expect(route).toContain("outcome: 'partial'");
    expect(route).toContain("}, 'oss/move-file-delete-source', oldKey)");
  });

  it('keeps direct browser upload and aggregate batch audit while removing duplicate item mutation events', () => {
    expect(manager).toContain("logAction(userEmail, 'OSS_UPLOAD'");
    expect(manager).toContain("logAction(userEmail, 'OSS_BATCH_DELETE'");
    expect(manager).toContain('audit_scope: \'aggregate\'');
    expect(manager).toContain("item_audit_authority: 'server'");
    expect(manager).toContain('action=delete&batch=1&file=');
    expect(manager).not.toContain("logAction(userEmail, 'OSS_CREATE_FOLDER'");
    expect(manager).not.toContain("logAction(userEmail, 'OSS_DELETE'");
    expect(manager).not.toContain("logAction(userEmail, 'OSS_MOVE'");
  });

  it('removes the temporary OSS exemption from the repository-wide mutation baseline', () => {
    expect(auditCoverage).not.toContain("'src/app/api/oss/route.ts'");
    expect(auditCoverage).toContain("'src/app/api/audit-events/route.ts'");
  });
});
