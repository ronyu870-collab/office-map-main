import type { ReactNode } from 'react'

// ─── 列定义 ──────────────────────────────────────────────────────────────────

export type ColType = 'text' | 'number' | 'textarea' | 'boolean' | 'date' | 'jsonb' | 'uuid' | 'tags'

export interface ColDef {
  key: string
  label: string
  type: ColType
  readOnly?: boolean
  required?: boolean
  width?: string
  hidden?: boolean
  masked?: boolean
  /** 指向 DictBundle 中的 key，用于外键解析（显示名称、编辑时下拉选择） */
  foreignKey?: string
  /** 虚拟列：从 row[sourceKey] 取值做字典查找，而非 row[key] */
  sourceKey?: string
  /** 静态值翻译映射（如 { A: '甲级', B: '乙级' }），用于显示和筛选 */
  displayMap?: Record<string, string>
  /** 筛选时使用精确匹配而非模糊搜索（用于等级等有前缀冲突的列） */
  exactFilter?: boolean
  /** 数字列显示时保留的小数位数 */
  decimals?: number
  /** 数字列显示时追加的后缀（如 '%' 表示百分比），值会先乘100再拼接 */
  suffix?: string
  /** 不加千分位分隔符（适用于年份等小整数） */
  noThousandSeparator?: boolean
  /** 冻结列：left 表示左侧冻结（常用于项目名称等标识列），right 表示右侧冻结 */
  pinned?: 'left' | 'right'
}

// ─── 表配置 ──────────────────────────────────────────────────────────────────

export interface TableConfig {
  table: string
  label: string
  emoji?: string
  cols: ColDef[]
  orderBy?: string | { col: string; asc?: boolean }[]
  /** 数据过滤：WHERE field = value */
  filterField?: string
  filterValue?: string
  /** 分组标签：同 group 的 tab 在视觉上归为一组 */
  group?: string
  supportsHistory?: boolean
  /** 特殊行级操作（如重置密码），渲染为行内按钮 */
  specialActions?: SpecialAction[]
  /** 工具栏额外按钮（如批量分配CSV），渲染在工具栏中 */
  toolbarExtra?: ToolbarAction[]
  /** 保存前的数据转换（如自动填充 project_name） */
  beforeSave?: (row: Record<string, any>, dicts: DictBundle) => Record<string, any>
  /** 自定义新增逻辑（如创建 Auth 账号），返回 { success, message, targetId? } */
  customSaveAdd?: (row: Record<string, any>, dicts: DictBundle) => Promise<{ success: boolean; message: string; targetId?: string }>
  /** 视图模式切换（如季度填报的"最新数据"vs"全部历史"） */
  viewMode?: {
    enabled: boolean
    views: { key: string; label: string; table: string }[]
  }
  /** 隐藏默认工具栏按钮 */
  hideRawExport?: boolean
  hideTemplate?: boolean
  hideUpload?: boolean
  hideAdd?: boolean
  /** 自定义数据获取（如需要合并多表数据时） */
  customFetch?: (dicts: DictBundle) => Promise<Record<string, any>[]>
  /** 批量上传匹配键：用这些列的组合来定位已有记录（有则覆盖，无则新增） */
  uploadMatchKeys?: string[]
  /** 上传匹配时，若主键未命中，额外检查此列的 JSONB 数组是否包含匹配值（用于曾用名匹配） */
  matchFormerNames?: string
  /** 批量上传时跳过的列（如自动生成的 user_name、grade 等） */
  uploadSkipCols?: string[]
  /** 数据上传说明文本，展示在"上传说明"弹窗中 */
  uploadDescription?: string
  /** 显示"仅启用楼宇"筛选开关，通过 dicts.active_building_ids 过滤 */
  showInactiveFilter?: boolean
  /** 启用统计模式：行级复选框 + 选中行汇总统计 */
  statsMode?: {
    /** 需要求和的列 */
    sumCols: string[]
    /** 加权平均列：{ valueCol, weightCol }，权重为 weightCol 的值 */
    weightedAvgCols: { valueCol: string; weightCol: string; label: string }[]
    /** 派生指标：基于求和结果计算（如 空置率 = 空置面积÷总面积） */
    derivedCols?: { label: string; formula: (sums: Record<string, number>) => number; decimals?: number; suffix?: string }[]
  }
}

// ─── 特殊操作 ────────────────────────────────────────────────────────────────

export interface SpecialAction {
  key: string
  label: string
  icon?: ReactNode
  /** 是否对该行显示此操作按钮 */
  condition: (row: any) => boolean
  handler: (row: any, ctx: ActionContext) => Promise<void>
  style?: 'primary' | 'danger' | 'warning'
}

export interface ToolbarAction {
  key: string
  label: string
  icon?: ReactNode
  handler: () => void
}

// ─── 字典包 ──────────────────────────────────────────────────────────────────

/** 外键解析字典，key 为表名，value 为 { uuid: displayName } 映射 */
export type DictBundle = Record<string, Record<string, string>>

// ─── 操作上下文 ──────────────────────────────────────────────────────────────

export interface ActionContext {
  fetchRows: () => Promise<void>
  showToast: (msg: string, ok?: boolean) => void
  dicts: DictBundle
}

// ─── 模式推断辅助 ────────────────────────────────────────────────────────────

/** Postgres 数据类型 → ColType 映射 */
export function pgTypeToColType(pgType: string): ColType {
  const t = pgType.toLowerCase()
  if (t.includes('int') || t.includes('float') || t.includes('numeric') || t.includes('double') || t.includes('serial') || t.includes('decimal') || t === 'real') return 'number'
  if (t === 'boolean') return 'boolean'
  if (t === 'date') return 'date'
  if (t.includes('timestamp')) return 'date'
  if (t === 'jsonb' || t === 'json') return 'jsonb'
  if (t === 'uuid') return 'uuid'
  if (t === 'text' && false) return 'textarea' // textarea 需要手动标注
  return 'text'
}

/** 系统自动隐藏/只读的列名 */
export const SYSTEM_COLUMNS = new Set(['id', 'created_at', 'updated_at'])
export const READONLY_COLUMNS = new Set(['created_at', 'updated_at'])
