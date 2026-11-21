import { describe, expect, it } from 'vitest';
import { sanitizeAuditPayload, sanitizeAuditText,sanitizeAuditDetails } from '../auditSanitizer';

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

it('allows only AI task metadata and removes restricted conversation content from ordinary audit',()=>{
 const result=sanitizeAuditDetails('AI_QUERY',{model:'fixture',outcome:'success',duration_ms:42,prompt:'restricted original',answer:'restricted answer',documents:['restricted material'],nested:{access_token:'credential'}});
 expect(result).toEqual({model:'fixture',outcome:'success',duration_ms:42});
 expect(sanitizeAuditDetails('DATA_UPDATE',{question:'restricted',tool_name:'lookup'},'intelligence')).toEqual({tool_name:'lookup'});
});
