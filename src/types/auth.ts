/**
 * 认证相关类型定义
 * @module types/auth
 */

import type { Session, User } from '@supabase/supabase-js';

/**
 * 用户角色类型定义
 * 
 * - admin: 管理员，拥有所有权限
 * - executive: 高管/Boss，只读权限，可查看所有数据
 * - editor: 编辑者，可编辑自己的数据
 * - viewer: 查看者，只能查看自己的数据
 */
export type UserRole = 'admin' | 'executive' | 'editor' | 'viewer';

/**
 * 认证会话结果
 */
export interface AuthSessionResult {
  user: User;
  session: Session;
  role: UserRole;
  displayName: string;
  sessionId: string;
}
