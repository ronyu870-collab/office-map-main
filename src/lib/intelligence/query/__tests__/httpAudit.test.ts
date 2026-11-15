import { expect, it } from 'vitest';
import { sanitizeAuditContent } from '../auditStore';

it('redacts JSON-escaped multi-word credentials without discarding the submitted business question', () => {
  const rawRequest = JSON.stringify({ question: 'CBD 密码="synthetic multi word secret" 最高楼是什么？' });
  const sanitized = sanitizeAuditContent({ rawRequest });
  expect(JSON.stringify(sanitized)).not.toContain('multi word secret');
  expect(JSON.stringify(sanitized)).toContain('最高楼是什么');
  expect(sanitized.redactionTypes).toContain('explicit_credential');
});
