/**
 * Demo 模式配置
 *
 * 用途：面试演示时，对敏感数据做视觉脱敏
 * 删除时机：找到实习后，删除此文件 + src/components/demo/ 目录即可
 */

// 在此添加需要打码的 demo 账号邮箱
export const DEMO_ACCOUNTS: string[] = [
  'demo@colliers.com',
]

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
