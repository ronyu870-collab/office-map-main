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
