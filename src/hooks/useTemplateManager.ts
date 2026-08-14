import { useCallback } from 'react';
import type { Template } from '@/src/types/admin-memo';

// 模板定义提到模块级别，避免每次渲染重新创建
const TEMPLATES: Template[] = [
  {
    id: 'full',
    name: '完整模板',
    description: '包含所有预定义区块的完整模板',
    content: `# 管理员备忘录

## 📋 操作手册
<!-- 记录系统操作流程、常见问题解决方案 -->

- 在此记录重要的操作流程和注意事项
- 可以使用列表、代码块等 Markdown 语法

## ✅ 待办事项
<!-- 使用 - [ ] 创建任务列表 -->

- [ ] 示例任务 1
- [ ] 示例任务 2
- [x] 已完成的任务示例

## 👥 重要联系人
<!-- 记录关键联系人信息 -->

- **技术支持**: tech-support@example.com
- **运维团队**: ops@example.com

## 🔗 快速链接
<!-- 系统内常用页面的快速导航 -->

- [数据库管理](/admin/database)
- [日志查看](/admin/logs)
- [用户管理](/admin/users)
- [公告管理](/admin/notices)

## 📝 其他备注
<!-- 其他重要信息 -->

- 在此记录其他需要注意的事项
`,
    category: 'full',
  },
];

/**
 * 模板管理 Hook
 */
export function useTemplateManager() {
  const insertTemplate = useCallback((templateId: string): string => {
    const template = TEMPLATES.find((t) => t.id === templateId);
    return template?.content ?? '';
  }, []); // 无依赖，函数稳定

  return { templates: TEMPLATES, insertTemplate };
}
