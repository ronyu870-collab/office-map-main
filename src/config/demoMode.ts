/**
 * Demo 模式配置
 *
 * 用途：可选的演示脱敏层。
 *
 * 权限原则：Demo Mode 只能改变展示方式，不能扩大或缩小 Viewer/Editor 的功能权限。
 * 当前生产 Viewer 必须保持与 Editor 相同的读取体验，因此默认不配置任何 demo 账号。
 */

// 在此添加需要打码的 demo 账号邮箱
export const DEMO_ACCOUNTS: string[] = []

// 脱敏样式：'blur' | 'blackbar' | 'asterisk'
export const MASK_STYLE: 'blur' | 'blackbar' | 'asterisk' = 'blur'

/**
 * 纯函数版本的 demo 模式判断
 * 用于 ECharts tooltip 等脱离 React 组件树的场景
 */
let _demoEmails: Set<string> | null = null

export function isDemoMode(email?: string | null): boolean {
  if (!email) return false
  if (!_demoEmails) {
    _demoEmails = new Set(DEMO_ACCOUNTS.map(e => e.toLowerCase()))
  }
  return _demoEmails.has(email.toLowerCase())
}

/**
 * 团队视图中需要排除的账号名称（演示/测试账号）
 * 用于 TeamSubmissionMonitor、SubmissionDetailTable 等团队汇总视图
 */
const EXCLUDED_TEAM_NAMES = new Set([
  '演示账号',
  'Demo User',
  '测试账号',
  'Hannah Wang',
  '王楚涵',
])

export function isExcludedFromTeamView(name?: string | null): boolean {
  if (!name?.trim()) return false
  return EXCLUDED_TEAM_NAMES.has(name.trim())
}
