// Include maintenance/import scripts as well as browser and API producers.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { getLogBadgeStyle, parseAuditLog } from '../auditTranslator';

function sources(directory: string): string[] {
  return readdirSync(directory, {withFileTypes:true}).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sources(path);
    return /\.(mjs|tsx?|jsx?)$/.test(path) && !/\.(test|spec)\./.test(path) ? [path] : [];
  });
}

test('every literal audit action emitted by application or import scripts has specific presentation', () => {
  for (const path of [...sources('src'), ...sources('scripts')]) {
    for (const match of readFileSync(path,'utf8').matchAll(/action_type\s*:\s*['"]([A-Z_]+)['"]/g)) {
      expect(getLogBadgeStyle(match[1]).label, `${path}: ${match[1]}`).not.toBe('系统操作');
      expect(parseAuditLog(match[1]), `${path}: ${match[1]}`).not.toBe('执行了一项系统操作');
    }
  }
});

// External MCP SQL is not part of src/scripts, so cover its persisted actions explicitly.
test('external maintenance actions retain distinct labels and field-aware descriptions', () => {
  for (const action of ['AI_FIELD_FILL','BUILDING_PHOTO_STORAGE_BACKFILL','BUILDING_PHOTO_STORAGE_BACKFILL_RECEIPT','BUILDING_PHOTO_STORAGE_BACKFILL_BACKUP']) {
    expect(getLogBadgeStyle(action).label).not.toBe('系统操作');
    expect(parseAuditLog(action)).not.toBe('执行了一项系统操作');
  }
  expect(parseAuditLog('AI_FIELD_FILL',{field_name:'submarket'})).toBe('补齐楼宇字段：所属子市场');
  expect(parseAuditLog('AI_FIELD_FILL',{field_name:'building_height'})).toBe('补齐楼宇字段：建筑高度');
  expect(parseAuditLog('ADMIN_DATA_OPERATION',{operation:'ai_public_source_backfill'})).toBe('补充子市场公开资料');
  expect(parseAuditLog('ADMIN_DATA_OPERATION',{operation:'auto_publish_submarket_client_brief'})).toBe('发布子市场客户展示资料');
});
