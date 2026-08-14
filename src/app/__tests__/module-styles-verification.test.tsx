/**
 * 模块样式应用验证测试
 * 
 * 验证任务 3.3：更新模块卡片渲染逻辑应用动态样式
 * - 使用 getModuleStyles 获取样式类名
 * - 使用 getAccessibilityProps 获取 ARIA 属性
 * - 为受限模块应用灰色禁用样式
 * - 移除受限模块的 hover 效果
 */

import { describe, it, expect } from 'vitest';
import { getModuleStyles, getAccessibilityProps } from '@/src/utils/accessControl';

describe('任务 3.3: 模块样式应用验证', () => {
  describe('getModuleStyles - 样式类名生成', () => {
    it('非管理员访问受限模块（bi）应返回灰色禁用样式', () => {
      const styles = getModuleStyles('bi', 'viewer');
      
      // 验证卡片样式包含灰色背景和禁用光标
      expect(styles.cardClass).toContain('bg-zinc-100');
      expect(styles.cardClass).toContain('cursor-not-allowed');
      expect(styles.cardClass).not.toContain('hover:-translate-y-0.5'); // 无 hover 效果
      
      // 验证图标样式为浅灰色和半透明
      expect(styles.iconClass).toContain('text-zinc-400');
      expect(styles.iconClass).toContain('opacity-50');
      
      // 验证文本样式为浅灰色
      expect(styles.textClass).toContain('text-zinc-400');
      
      // 验证光标样式
      expect(styles.cursorClass).toBe('cursor-not-allowed');
    });
    
    it('非管理员访问受限模块（deals）应返回灰色禁用样式', () => {
      const styles = getModuleStyles('deals', 'editor');
      
      expect(styles.cardClass).toContain('bg-zinc-100');
      expect(styles.cardClass).toContain('cursor-not-allowed');
      expect(styles.iconClass).toContain('text-zinc-400');
      expect(styles.iconClass).toContain('opacity-50');
      expect(styles.textClass).toContain('text-zinc-400');
    });
    
    it('管理员访问受限模块应返回正常样式（带 hover 效果）', () => {
      const styles = getModuleStyles('bi', 'admin');
      
      // 验证卡片样式包含正常背景和 hover 效果
      expect(styles.cardClass).toContain('bg-white');
      expect(styles.cardClass).toContain('hover:-translate-y-0.5');
      expect(styles.cardClass).toContain('hover:shadow-md');
      
      // 验证图标样式包含 hover 效果
      expect(styles.iconClass).toContain('text-zinc-500');
      expect(styles.iconClass).toContain('group-hover:text-[#003e7e]');
      
      // 验证文本样式包含 hover 效果
      expect(styles.textClass).toContain('text-zinc-700');
      expect(styles.textClass).toContain('group-hover:text-[#003e7e]');
      
      // 验证光标样式
      expect(styles.cursorClass).toBe('cursor-pointer');
    });
    
    it('非受限模块（map）对所有用户返回正常样式', () => {
      const viewerStyles = getModuleStyles('map', 'viewer');
      const adminStyles = getModuleStyles('map', 'admin');
      
      // 验证两者样式相同
      expect(viewerStyles.cardClass).toBe(adminStyles.cardClass);
      expect(viewerStyles.iconClass).toBe(adminStyles.iconClass);
      expect(viewerStyles.textClass).toBe(adminStyles.textClass);
      
      // 验证都是正常样式
      expect(viewerStyles.cardClass).toContain('bg-white');
      expect(viewerStyles.cardClass).toContain('hover:-translate-y-0.5');
    });
  });
  
  describe('getAccessibilityProps - ARIA 属性生成', () => {
    it('非管理员访问受限模块应返回 aria-disabled 和描述性 aria-label', () => {
      const props = getAccessibilityProps('bi', '商业智能看板', 'viewer');
      
      expect(props['aria-disabled']).toBe('true');
      expect(props['aria-label']).toBe('商业智能看板 - 需要管理员权限');
      expect(props.role).toBe('link');
    });
    
    it('管理员访问受限模块不应返回 aria-disabled', () => {
      const props = getAccessibilityProps('bi', '商业智能看板', 'admin');
      
      expect(props['aria-disabled']).toBeUndefined();
      expect(props['aria-label']).toBeUndefined();
      expect(props.role).toBe('link');
    });
    
    it('非受限模块对所有用户不返回 aria-disabled', () => {
      const viewerProps = getAccessibilityProps('map', '地图', 'viewer');
      const adminProps = getAccessibilityProps('map', '地图', 'admin');
      
      expect(viewerProps['aria-disabled']).toBeUndefined();
      expect(adminProps['aria-disabled']).toBeUndefined();
    });
  });
  
  describe('样式和 ARIA 属性一致性', () => {
    it('当样式为禁用时，ARIA 属性也应为禁用', () => {
      const moduleId = 'bi';
      const moduleTitle = '商业智能看板';
      const role = 'viewer';
      
      const styles = getModuleStyles(moduleId, role);
      const props = getAccessibilityProps(moduleId, moduleTitle, role);
      
      // 如果样式是禁用的（灰色背景），ARIA 也应该是禁用的
      if (styles.cardClass.includes('bg-zinc-100')) {
        expect(props['aria-disabled']).toBe('true');
      }
      
      // 如果样式是正常的（白色背景），ARIA 不应该有 disabled
      if (styles.cardClass.includes('bg-white')) {
        expect(props['aria-disabled']).toBeUndefined();
      }
    });
  });
});
