import { describe, it, expect } from 'vitest';
import { getModuleStyles, getAccessibilityProps } from '@/src/utils/accessControl';

describe('模块权限样式与可访问性', () => {
  it('viewer 与 editor 都可以访问 lease-submission', () => {
    for (const role of ['viewer', 'editor'] as const) {
      const styles = getModuleStyles('lease-submission', role);
      const props = getAccessibilityProps('lease-submission', '租赁成交填报', role);

      expect(styles.cardClass).toContain('bg-white');
      expect(styles.cardClass).toContain('hover:-translate-y-0.5');
      expect(styles.iconClass).toContain('group-hover:text-primary');
      expect(styles.textClass).toContain('group-hover:text-primary');
      expect(props['aria-disabled']).toBeUndefined();
    }
  });

  it('admin 可以访问 lease-submission', () => {
    expect(getModuleStyles('lease-submission', 'admin').cardClass).toContain('bg-white');
    expect(getAccessibilityProps('lease-submission', '租赁成交填报', 'admin')['aria-disabled']).toBeUndefined();
  });

  it('普通地图模块对合法角色开放，但未知角色 fail-closed', () => {
    expect(getModuleStyles('map', 'viewer').cardClass).toContain('bg-white');
    expect(getModuleStyles('map', 'editor').cardClass).toContain('bg-white');
    expect(getModuleStyles('map', 'executive').cardClass).toContain('bg-zinc-100');
    expect(getAccessibilityProps('map', '地图', null)['aria-disabled']).toBe('true');
  });
});
