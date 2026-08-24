/**
 * 键盘导航访问控制测试
 *
 * 键盘 Enter 与鼠标点击共享同一套 canAccessModule 判定；这里验证
 * 当前真实模块契约，而不是已经删除的历史 /bi 路由。
 */

import { describe, it, expect } from 'vitest';
import { isModuleRestricted, canAccessModule } from '@/src/utils/accessControl';

const restrictedModule = {
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
    it('blocks a viewer from the restricted lease-submission workspace', () => {
      expect(isModuleRestricted(restrictedModule.module)).toBe(true);
      expect(canAccessModule(restrictedModule.module, 'viewer')).toBe(false);
    });

    it('allows an editor into the restricted lease-submission workspace', () => {
      expect(isModuleRestricted(restrictedModule.module)).toBe(true);
      expect(canAccessModule(restrictedModule.module, 'editor')).toBe(true);
    });

    it('allows an admin into the restricted lease-submission workspace', () => {
      expect(isModuleRestricted(restrictedModule.module)).toBe(true);
      expect(canAccessModule(restrictedModule.module, 'admin')).toBe(true);
    });

    it('allows authenticated application roles into an unrestricted module', () => {
      for (const role of ['admin', 'editor', 'viewer'] as const) {
        expect(isModuleRestricted(publicModule.module)).toBe(false);
        expect(canAccessModule(publicModule.module, role)).toBe(true);
      }
    });

    it('fails closed for anonymous or unknown roles even on unrestricted modules', () => {
      for (const role of [null, undefined, '', 'executive']) {
        expect(canAccessModule(publicModule.module, role)).toBe(false);
      }
    });
  });

  describe('Enter-key access flow', () => {
    it('produces the same blocked decision used by the click handler', () => {
      const canAccess = canAccessModule(restrictedModule.module, 'viewer');
      const shouldPreventDefault = !canAccess;

      expect(shouldPreventDefault).toBe(true);
    });

    it('produces the same allowed decision used by the click handler', () => {
      const canAccess = canAccessModule(restrictedModule.module, 'editor');
      const shouldPreventDefault = !canAccess;

      expect(shouldPreventDefault).toBe(false);
    });
  });

  describe('audit decision metadata', () => {
    it('marks a denied restricted-module navigation as blocked', () => {
      const isRestricted = isModuleRestricted(restrictedModule.module);
      const canAccess = canAccessModule(restrictedModule.module, 'viewer');
      const details = {
        module: restrictedModule.module,
        blocked: !canAccess,
        reason: isRestricted && !canAccess ? 'restricted_module' : undefined,
      };

      expect(details).toEqual({
        module: 'lease-submission',
        blocked: true,
        reason: 'restricted_module',
      });
    });
  });
});
