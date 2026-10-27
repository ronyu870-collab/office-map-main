/**
 * ColDef → AG Grid ColDef 转换层
 * 将项目自有的列定义转换为 AG Grid 可识别的列配置
 */
import type { ColDef as AgColDef } from 'ag-grid-community'
import type { ColDef, TableConfig, DictBundle } from '../types'
import { tagNames } from './recordModel'

// Tailwind w-XX → px 查找表
const WIDTH_MAP: Record<string, number> = {
  'w-8': 32, 'w-10': 40, 'w-12': 48, 'w-14': 56, 'w-16': 64,
  'w-20': 80, 'w-24': 96, 'w-28': 112, 'w-32': 128, 'w-36': 144,
  'w-40': 160, 'w-44': 176, 'w-48': 192, 'w-52': 208, 'w-56': 224,
  'w-60': 240, 'w-64': 256, 'w-72': 288, 'w-80': 320, 'w-96': 384,
}

export function parseWidth(w?: string | number): number | undefined {
  if (!w) return undefined
  if (typeof w === 'number') return w
  return WIDTH_MAP[w] ?? undefined
}

/**
 * 根据列类型和标签长度决定默认宽度
 */
function defaultWidth(col: ColDef): number {
  // 布尔列
  if (col.type === 'boolean') return 80
  // 日期列
  if (col.type === 'date') return 120
  // JSONB列
  if (col.type === 'jsonb') return 200
  // 长文本列
  if (col.type === 'textarea') return 200
  // 根据标签长度估算（中文字符更宽）
  const labelLen = col.label.length
  const minWidth = 120
  // 中文字符约16px，英文约10px，取平均14px，加上padding和排序图标
  const charWidth = 15
  return Math.max(minWidth, Math.min(350, labelLen * charWidth + 50))
}

/**
 * 构建 AG Grid 的操作列定义（pinned right）
 */
export function buildActionColDef(config: TableConfig): AgColDef {
  const hasHistory = !!config.supportsHistory
  const hasSpecial = !!(config.specialActions && config.specialActions.length > 0)
  const btnCount = 2 + (hasHistory ? 1 : 0) + (hasSpecial ? config.specialActions!.length : 0)
  // 每个按钮约60px宽，加上图标和间距
  const w = Math.max(btnCount * 65 + 20, 130)

  return {
    colId: '__actions',
    headerName: '操作',
    field: '__actions',
    pinned: 'right',
    width: w,
    minWidth: 120,
    sortable: false,
    filter: false,
    editable: false,
    resizable: false,
    cellRenderer: 'ActionCellRenderer',
    headerClass: 'text-center',
  }
}

/**
 * 构建统计模式的 checkbox 列定义（pinned left）
 */
export function buildCheckboxColDef(): AgColDef {
  return {
    colId: '__checkbox',
    headerName: '',
    field: '__checkbox',
    pinned: 'left',
    width: 50,
    minWidth: 50,
    maxWidth: 50,
    sortable: false,
    filter: false,
    editable: false,
    resizable: false,
    headerCheckboxSelection: true,
    checkboxSelection: true,
  }
}

/**
 * 将项目 ColDef 转换为 AG Grid ColDef[]
 * @param cols 项目列定义
 * @param config 表配置（用于操作列）
 * @param dicts 字典包（用于 FK 列的 editorParams）
 * @param statsEnabled 是否启用统计模式（启用时添加 checkbox 列）
 * @returns AG Grid 列定义数组（含操作列）
 */
export function buildAgColumnDefs(
  cols: ColDef[],
  config: TableConfig,
  dicts: DictBundle,
  statsEnabled?: boolean,
): AgColDef[] {
  const agCols: AgColDef[] = []

  // 统计模式时添加 checkbox 列
  // AG Grid v35 owns the selection column through rowSelection/selectionColumnDef.

  for (const col of cols) {
    if (col.hidden) continue

    const agCol: AgColDef = {
      field: col.key,
      headerName: col.label,
      headerTooltip: col.label, // 鼠标悬停显示完整表头
      width: parseWidth(col.width) ?? defaultWidth(col),
      minWidth: 100,
      sortable: col.type !== 'textarea' && col.type !== 'jsonb',
      editable: !col.readOnly,
      hide: false,
      pinned: col.pinned,
    }

    // sourceKey: 虚拟列，用 valueGetter 从源字段取值，强制不可编辑
    if (col.sourceKey) {
      agCol.editable = false
      agCol.valueGetter = (params: any) => {
        const row = params.data
        return row ? row[col.sourceKey!] : undefined
      }
    }

    // 不自动pin列，让用户自己滚动查看
    // 只有ID列可以考虑pin

    // 外键列
    if (col.foreignKey) {
      agCol.cellRenderer = 'ForeignKeyRenderer'
      agCol.cellRendererParams = { foreignKey: col.foreignKey, masked: col.masked }
      if (!col.readOnly) {
        agCol.cellEditor = 'ForeignKeyEditor'
        agCol.cellEditorParams = {
          foreignKey: col.foreignKey,
          options: dicts[col.foreignKey] ?? {},
        }
      }
      // FK 列的筛选
      agCol.filter = 'agTextColumnFilter'
    }
    // displayMap 列
    else if (col.displayMap) {
      agCol.cellRenderer = 'DisplayMapRenderer'
      agCol.cellRendererParams = { displayMap: col.displayMap }
      agCol.filter = 'agTextColumnFilter'
    }
    // 脱敏列（非 FK 场景）
    else if (col.masked) {
      agCol.cellRenderer = 'MaskedRenderer'
      agCol.cellRendererParams = { masked: true }
    }
    // 布尔列
    else if (col.type === 'boolean') {
      agCol.cellRenderer = 'BooleanRenderer'
      agCol.filter = 'agTextColumnFilter'
    }
    else if (col.type === 'tags') {
      agCol.valueGetter = params => tagNames(params.data?.[col.key]).join('\n')
      agCol.valueParser = params => tagNames(params.newValue)
      agCol.cellEditor = 'agLargeTextCellEditor'
      // The grid edits full rows; popup editors are incompatible with that mode.
      agCol.cellEditorPopup = false
      agCol.cellEditorParams = { rows: 5, cols: 40, maxLength: 10000 }
      agCol.filter = 'agTextColumnFilter'
    }
    // JSONB 列
    else if (col.type === 'jsonb') {
      agCol.cellRenderer = 'JsonbRenderer'
      agCol.editable = false
      agCol.sortable = false
    }
    // 数字列
    else if (col.type === 'number') {
      agCol.cellRenderer = 'NumberRenderer'
      agCol.cellRendererParams = {
        decimals: col.decimals,
        suffix: col.suffix,
        noThousandSeparator: col.noThousandSeparator,
      }
      agCol.filter = 'agNumberColumnFilter'
      agCol.cellClass = 'text-right'
    }
    // 日期列
    else if (col.type === 'date') {
      agCol.filter = 'agDateColumnFilter'
    }
    // 文本列（默认）
    else {
      agCol.filter = 'agTextColumnFilter'
    }

    // 精确筛选
    if (col.exactFilter) {
      agCol.filterParams = {
        ...(agCol.filterParams ?? {}),
        filterOptions: ['equals', 'notEqual'],
        maxNumConditions: 1,
      }
    }

    // textarea / jsonb 不可排序
    if (col.type === 'textarea' || col.type === 'jsonb') {
      agCol.sortable = false
    }

    // required: 用于新增表单校验，AG Grid 本身不处理
    // 通过 colDef 的 tooltip 或 headerTooltip 标记
    if (col.required) {
      agCol.headerTooltip = `${col.label}（必填）`
    }

    agCols.push(agCol)
  }

  // 添加操作列（全只读表不显示）
  if (cols.some(c => !c.readOnly)) {
    agCols.push(buildActionColDef(config))
  }

  return agCols
}
