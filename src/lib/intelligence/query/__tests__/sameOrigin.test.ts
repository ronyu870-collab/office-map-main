import { describe, expect, it } from 'vitest';
import { isQuerySameOrigin } from '../sameOrigin';
describe('browser same-origin admission with a Next internal listener', () => {
  it('uses HTTP Host and protocol rather than the internal listener name', () => {
    expect(isQuerySameOrigin(new Request('http://localhost:3289/api/intelligence/query', { headers: { Host: '127.0.0.1:3289', Origin: 'http://127.0.0.1:3289' } }))).toBe(true);
    expect(isQuerySameOrigin(new Request('https://internal/api/intelligence/query', { headers: { Host: 'example.invalid', Origin: 'https://example.invalid' } }))).toBe(true);
  });
  it.each(['http://evil.invalid', 'http://localhost:3289', 'https://127.0.0.1:3289', 'null', 'http://127.0.0.1:3289/path'])('refuses foreign or invalid Origin %s despite a forged forwarded host', origin => {
    expect(isQuerySameOrigin(new Request('http://localhost:3289/api/intelligence/query', { headers: { Host: '127.0.0.1:3289', Origin: origin, 'X-Forwarded-Host': 'evil.invalid' } }))).toBe(false);
  });
});
