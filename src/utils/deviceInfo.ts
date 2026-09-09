export type AuditDeviceType = 'desktop' | 'mobile' | 'tablet' | 'unknown';

export interface DeviceInfo {
  browserName: string | null;
  browserVersion: string | null;
  osName: string | null;
  osVersion: string | null;
  deviceType: AuditDeviceType;
}

function version(ua: string, pattern: RegExp): string | null {
  const match = ua.match(pattern);
  return match?.[1]?.replace(/_/g, '.') ?? null;
}

/** Conservative UA parsing for audit display only; the raw server UA remains evidence. */
export function parseDeviceInfo(userAgent: string | null | undefined): DeviceInfo {
  const ua = userAgent?.trim() ?? '';
  if (!ua) return { browserName: null, browserVersion: null, osName: null, osVersion: null, deviceType: 'unknown' };

  let browserName: string | null = null;
  let browserVersion: string | null = null;
  if (/Edg\//.test(ua)) { browserName = 'Edge'; browserVersion = version(ua, /Edg\/([\d.]+)/); }
  else if (/CriOS\//.test(ua)) { browserName = 'Chrome'; browserVersion = version(ua, /CriOS\/([\d.]+)/); }
  else if (/Chrome\//.test(ua)) { browserName = 'Chrome'; browserVersion = version(ua, /Chrome\/([\d.]+)/); }
  else if (/FxiOS\//.test(ua)) { browserName = 'Firefox'; browserVersion = version(ua, /FxiOS\/([\d.]+)/); }
  else if (/Firefox\//.test(ua)) { browserName = 'Firefox'; browserVersion = version(ua, /Firefox\/([\d.]+)/); }
  else if (/Safari\//.test(ua) && /Version\//.test(ua)) { browserName = 'Safari'; browserVersion = version(ua, /Version\/([\d.]+)/); }

  let osName: string | null = null;
  let osVersion: string | null = null;
  if (/Windows NT /.test(ua)) {
    osName = 'Windows';
    const nt = version(ua, /Windows NT ([\d.]+)/);
    osVersion = nt === '10.0' ? '10/11' : nt;
  } else if (/Android /.test(ua)) {
    osName = 'Android'; osVersion = version(ua, /Android ([\d.]+)/);
  } else if (/(iPhone|iPad|iPod)/.test(ua)) {
    osName = 'iOS'; osVersion = version(ua, /OS ([\d_]+)/);
  } else if (/Mac OS X /.test(ua)) {
    osName = 'macOS'; osVersion = version(ua, /Mac OS X ([\d_]+)/);
  } else if (/Linux/.test(ua)) {
    osName = 'Linux';
  }

  const deviceType: AuditDeviceType = /iPad|Tablet/.test(ua)
    ? 'tablet'
    : /Mobi|iPhone|iPod|Android/.test(ua)
      ? 'mobile'
      : /Windows|Macintosh|X11|Linux/.test(ua)
        ? 'desktop'
        : 'unknown';

  return { browserName, browserVersion, osName, osVersion, deviceType };
}
