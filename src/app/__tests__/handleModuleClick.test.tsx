import { describe, it, expect } from 'vitest';
import { isModuleRestricted, isUserAdmin, canAccessModule, canWriteBusinessData } from '@/src/utils/accessControl';

describe('访问控制逻辑', () => {
  describe('isModuleRestricted', () => {
    it('业务工作区不再通过角色隐藏读取入口', () => {
      expect(isModuleRestricted('lease-submission')).toBe(false);
      expect(isModuleRestricted('update')).toBe(false);
      expect(isModuleRestricted('map')).toBe(false);
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
    it('viewer/editor/admin 都可以进入业务读取工作区', () => {
      for (const role of ['viewer', 'editor', 'admin'] as const) {
        expect(canAccessModule('lease-submission', role)).toBe(true);
        expect(canAccessModule('update', role)).toBe(true);
        expect(canAccessModule('map', role)).toBe(true);
        expect(canAccessModule('oss', role)).toBe(true);
      }
    });

    it('缺失或未知角色采用 fail-closed', () => {
      expect(canAccessModule('map', null)).toBe(false);
      expect(canAccessModule('map', undefined)).toBe(false);
      expect(canAccessModule('map', 'executive')).toBe(false);
      expect(canAccessModule('lease-submission', '')).toBe(false);
    });
  });

  describe('business write capability', () => {
    it('viewer 只读，editor/admin 可写业务数据', () => {
      expect(canWriteBusinessData('viewer')).toBe(false);
      expect(canWriteBusinessData('editor')).toBe(true);
      expect(canWriteBusinessData('admin')).toBe(true);
      expect(canWriteBusinessData('unknown')).toBe(false);
    });
  });
});
