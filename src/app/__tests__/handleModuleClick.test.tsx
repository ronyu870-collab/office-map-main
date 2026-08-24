import { describe, it, expect } from 'vitest';
import { isModuleRestricted, isUserAdmin, canAccessModule } from '@/src/utils/accessControl';

describe('访问控制逻辑', () => {
  describe('isModuleRestricted', () => {
    it('以真实路由标识识别租赁成交填报模块', () => {
      expect(isModuleRestricted('lease-submission')).toBe(true);
      expect(isModuleRestricted('deals')).toBe(false);
    });

    it('正确识别非受限模块', () => {
      expect(isModuleRestricted('map')).toBe(false);
      expect(isModuleRestricted('update')).toBe(false);
      expect(isModuleRestricted('oss')).toBe(false);
    });
  });

  describe('isUserAdmin', () => {
    it('只接受规范化后的 admin', () => {
      expect(isUserAdmin('admin')).toBe(true);
      expect(isUserAdmin(' ADMIN ')).toBe(true);
      expect(isUserAdmin('viewer')).toBe(false);
      expect(isUserAdmin('editor')).toBe(false);
      expect(isUserAdmin('executive')).toBe(false);
      expect(isUserAdmin(null)).toBe(false);
    });
  });

  describe('canAccessModule', () => {
    it('editor/admin 可以进入租赁成交填报，viewer 不可以', () => {
      expect(canAccessModule('lease-submission', 'admin')).toBe(true);
      expect(canAccessModule('lease-submission', 'editor')).toBe(true);
      expect(canAccessModule('lease-submission', 'viewer')).toBe(false);
    });

    it('合法角色可以进入普通模块', () => {
      expect(canAccessModule('map', 'viewer')).toBe(true);
      expect(canAccessModule('update', 'editor')).toBe(true);
      expect(canAccessModule('oss', 'admin')).toBe(true);
    });

    it('缺失或未知角色采用 fail-closed', () => {
      expect(canAccessModule('map', null)).toBe(false);
      expect(canAccessModule('map', undefined)).toBe(false);
      expect(canAccessModule('map', 'executive')).toBe(false);
      expect(canAccessModule('lease-submission', '')).toBe(false);
    });
  });
});
