/**
 * Admin Memo 类型定义
 */

/**
 * 编辑器模式
 */
export type EditorMode = 'edit' | 'preview';

/**
 * 冲突数据
 */
export interface ConflictData {
  serverUpdatedAt: string;
  serverUpdatedBy: string;
  localContent: string;
}

/**
 * 系统任务类型
 */
export type SystemTaskType = 'pending_update' | 'storage_warning' | 'custom';

/**
 * 任务优先级
 */
export type TaskPriority = 'high' | 'medium' | 'low';

/**
 * 系统任务
 */
export interface SystemTask {
  id: string;
  type: SystemTaskType;
  title: string;
  description: string;
  priority: TaskPriority;
  link?: string;
  createdAt: Date;
}

/**
 * 模板类别
 */
export type TemplateCategory = 'full' | 'section';

/**
 * 内容模板
 */
export interface Template {
  id: string;
  name: string;
  description: string;
  content: string;
  category: TemplateCategory;
}

/**
 * 自动保存状态
 */
export interface AutoSaveStatus {
  isSaving: boolean;
  lastSaved: Date | null;
  error: Error | null;
}

/**
 * 本地缓存结构
 */
export interface LocalMemoCache {
  content: string;
  timestamp: string;
  userEmail: string;
}

/**
 * 待办事项统计
 */
export interface TaskStats {
  completed: number;
  total: number;
}
