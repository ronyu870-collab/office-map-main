import type { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { getAuditRequestContext } from '@/src/utils/server/auditRequestContext';

function requestWithHeaders(headers: Record<string, string>): NextRequest {
  return { headers: new Headers(headers) } as unknown as NextRequest;
}

describe('audit request context', () => {
  it('uses the first server-observed forwarded IP and server User-Agent', () => {
    const context = getAuditRequestContext(requestWithHeaders({
      'x-forwarded-for': '203.0.113.10, 10.0.0.1',
      'x-real-ip': '198.51.100.5',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152.0.0.0 Safari/537.36',
      'x-vercel-ip-country': 'CN',
      'x-vercel-ip-city': 'Beijing',
    }));

    expect(context.ipAddress).toBe('203.0.113.10');
    expect(context.userAgent).toContain('Chrome/152.0.0.0');
    expect(context.country).toBe('CN');
    expect(context.city).toBe('Beijing');
    expect(context.browserName).toBe('Chrome');
  });

  it('falls back to x-real-ip when x-forwarded-for is absent', () => {
    const context = getAuditRequestContext(requestWithHeaders({
      'x-real-ip': '198.51.100.5',
    }));
    expect(context.ipAddress).toBe('198.51.100.5');
  });
});
