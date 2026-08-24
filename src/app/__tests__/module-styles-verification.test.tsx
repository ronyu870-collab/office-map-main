import { describe, it, expect } from 'vitest';
import { getModuleStyles, getAccessibilityProps } from '@/src/utils/accessControl';

describe('模块权限样式与可访问性', () => {
  it('viewer 访问 lease-submission 时显示禁用状态', () => {
    const styles = getModuleStyles('lease-submission', 'viewer');
    const props = getAccessibilityProps('lease-submission', '租赁成交填报', 'viewer');

    expect(styles.cardClass).toContain('bg-zinc-100');
    expect(styles.cardClass).toContain('cursor-not-allowed');
    expect(styles.cardClass).not.toContain('hover:-translate-y-0.5');
    expect(styles.iconClass).toContain('text-zinc-400');
    expect(styles.textClass).toContain('text-zinc-400');
    expect(props['aria-disabled']).toBe('true');
    expect(props['aria-label']).toBe('租赁成交填报 - 当前角色无权访问');
  });

  it('editor 可以访问 lease-submission', () => {
    const styles = getModuleStyles('lease-submission', 'editor');
    const props = getAccessibilityProps('lease-submission', '租赁成交填报', 'editor');

    expect(styles.cardClass).toContain('bg-white');
    expect(styles.cardClass).toContain('hover:-translate-y-0.5');
    expect(styles.iconClass).toContain('group-hover:text-primary');
    expect(styles.textClass).toContain('group-hover:text-primary');
    expect(props['aria-disabled']).toBeUndefined();
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
