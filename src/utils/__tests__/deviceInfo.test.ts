import { describe, expect, it } from 'vitest';
import { parseDeviceInfo } from '../deviceInfo';

describe('parseDeviceInfo', () => {
  it('parses Windows Chrome desktop', () => {
    const info = parseDeviceInfo('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152.0.0.0 Safari/537.36');
    expect(info.browserName).toBe('Chrome');
    expect(info.browserVersion).toBe('152.0.0.0');
    expect(info.osName).toBe('Windows');
    expect(info.deviceType).toBe('desktop');
  });

  it('parses iPhone Safari mobile', () => {
    const info = parseDeviceInfo('Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1');
    expect(info.browserName).toBe('Safari');
    expect(info.osName).toBe('iOS');
    expect(info.osVersion).toBe('18.6');
    expect(info.deviceType).toBe('mobile');
  });

  it('degrades safely for missing UA', () => {
    expect(parseDeviceInfo(null).deviceType).toBe('unknown');
  });
});
