import type { NextRequest } from 'next/server';
import { parseDeviceInfo } from '@/src/utils/deviceInfo';

function firstForwardedIp(value: string | null): string | null {
  return value?.split(',')[0]?.trim() || null;
}

function decodedHeader(value: string | null): string | null {
  if (!value) return null;
  try { return decodeURIComponent(value); } catch { return value; }
}

export function getAuditRequestContext(request: NextRequest) {
  const userAgent = request.headers.get('user-agent')?.slice(0, 1000) || null;
  const device = parseDeviceInfo(userAgent);
  return {
    ipAddress: firstForwardedIp(request.headers.get('x-forwarded-for')) || request.headers.get('x-real-ip')?.trim() || null,
    userAgent,
    country: decodedHeader(request.headers.get('x-vercel-ip-country')),
    region: decodedHeader(request.headers.get('x-vercel-ip-country-region')),
    city: decodedHeader(request.headers.get('x-vercel-ip-city')),
    ...device,
  };
}
