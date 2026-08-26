import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(path, 'utf8');
}

describe('Concise product copy', () => {
  it('keeps Home entry cards title-first without redundant descriptions', () => {
    const home = source('src/components/home/HomeWorkspace.tsx');

    for (const copy of [
      '查询楼宇、租金、空置率、供应及子市场数据。',
      '维护楼宇租金、空置率及季度数据。',
      '录入成交信息并完成数据检查。',
      '查找市场报告、研究文件及团队资料。',
      '管理数据库、用户、审计记录与系统配置。',
      '>进入地图<',
    ]) {
      expect(home).not.toContain(copy);
    }

    expect(home).not.toContain('description: string');
    expect(home).toContain("title: '北京办公楼市场地图'");
    expect(home).toContain("title: '季度数据填报'");
    expect(home).toContain("title: '租赁成交填报'");
    expect(home).toContain("title: '研究资料库'");
  });

  it('keeps Admin navigation name-only instead of repeating each function', () => {
    const sidebar = source('src/components/admin/AdminSidebar.tsx');
    const page = source('src/app/admin/page.tsx');

    expect(sidebar).not.toContain('description: string');
    expect(sidebar).not.toContain('item.description');
    expect(page).not.toContain('meta.description');

    for (const copy of [
      '用户资料、角色、账号状态与任务归属。',
      '维护系统现有核心业务表与记录。',
      '查看和管理现有季度填报记录。',
      '管理云端研究资料、目录和文件。',
      '审阅系统已记录的操作和审计事件。',
    ]) {
      expect(`${sidebar}\n${page}`).not.toContain(copy);
    }
  });

  it('removes decorative explanations while preserving operational guidance', () => {
    const research = source('src/app/oss/page.tsx');
    const settings = source('src/app/settings/page.tsx');
    const lease = source('src/app/lease-submission/components/LeaseTransactionWorkspaceForm.tsx');

    expect(research).not.toContain('搜索、定位、打开和维护内部研究资料');
    expect(research).not.toContain('>内部资料<');
    expect(settings).not.toContain('Supabase Auth 强哈希加密');

    // Prevent the simplification pass from deleting text that protects user input.
    expect(settings).toContain('密码长度不能少于 10 位');
    expect(settings).toContain('首次登录需先修改临时密码');
    expect(lease).toContain('带 * 的字段为必填项');
    expect(lease).toContain('表面租金不得超过 1000 元/㎡/月');
    expect(lease).toContain('存在未通过校验的字段');
  });
});
