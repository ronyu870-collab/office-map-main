import { describe, expect, it } from 'vitest';
import { sanitizeAuditPayload, sanitizeAuditText } from '../auditSanitizer';

describe('auditSanitizer', () => {
  it('redacts sensitive keys recursively', () => {
    expect(sanitizeAuditPayload({
      name: 'ABC',
      password: '123456',
      nested: { access_token: 'token-value', safe: true },
      cookie: 'session=x',
    })).toEqual({
      name: 'ABC',
      password: '[REDACTED]',
      nested: { access_token: '[REDACTED]', safe: true },
      cookie: '[REDACTED]',
    });
  });

  it('redacts secrets embedded in error text', () => {
    const result = sanitizeAuditText('request failed authorization: BearerXYZ password=secret123');
    expect(result).not.toContain('BearerXYZ');
    expect(result).not.toContain('secret123');
  });
});
