/**
 * 键盘导航访问控制测试
 *
 * 键盘 Enter 与鼠标点击共享同一套 canAccessModule 判定；viewer 与 editor
 * 共享业务读取入口，写权限由页面/API/RLS 单独控制。
 */

import { describe, it, expect } from 'vitest';
import { isModuleRestricted, canAccessModule } from '@/src/utils/accessControl';

const businessModule = {
  module: 'lease-submission',
  href: '/lease-submission',
  title: '租赁成交填报',
};

const publicModule = {
  module: 'map',
  href: '/map',
  title: '核心地图系统',
};

describe('Keyboard navigation access control', () => {
  describe('keyboard and mouse decisions stay consistent', () => {
    it('allows every canonical role into the lease-submission read workspace', () => {
      expect(isModuleRestricted(businessModule.module)).toBe(false);
      for (const role of ['viewer', 'editor', 'admin'] as const) {
        expect(canAccessModule(businessModule.module, role)).toBe(true);
      }
    });

    it('allows authenticated application roles into the map workspace', () => {
      for (const role of ['admin', 'editor', 'viewer'] as const) {
        expect(isModuleRestricted(publicModule.module)).toBe(false);
        expect(canAccessModule(publicModule.module, role)).toBe(true);
      }
    });

    it('fails closed for anonymous or unknown roles', () => {
      for (const role of [null, undefined, '', 'executive']) {
        expect(canAccessModule(publicModule.module, role)).toBe(false);
        expect(canAccessModule(businessModule.module, role)).toBe(false);
      }
    });
  });

  describe('Enter-key access flow', () => {
    it('produces the same allowed decision for viewer and editor', () => {
      for (const role of ['viewer', 'editor'] as const) {
        const canAccess = canAccessModule(businessModule.module, role);
        const shouldPreventDefault = !canAccess;
        expect(shouldPreventDefault).toBe(false);
      }
    });
  });
});
