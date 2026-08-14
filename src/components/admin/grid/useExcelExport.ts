'use client'
import { useCallback } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/src/services/supabaseClient'
import { logAction } from '@/src/utils/audit'
import { getSession } from '@/src/services/Auth'
import type { TableConfig, DictBundle, ColDef } from '../types'


function getLookupValue(col: ColDef, row: Record<string, any>): any {
  return row[col.sourceKey ?? col.key]
}

/**
 * Excel 导出 hook — 使用 xlsx 库生成 .xlsx 文件
 */
export function useExcelExport(
  config: TableConfig,
  dicts: DictBundle,
  filtered: any[],
  viewMode: string,
  showToast: (msg: string, ok?: boolean) => void,
) {
  const exportToExcel = useCallback(() => {
    if (filtered.length === 0) { showToast('没有数据可导出', false); return }

    const activeView = config.viewMode?.views.find(v => v.key === viewMode)
    let filenamePrefix = config.label
    if (config.viewMode?.enabled && activeView) {
      filenamePrefix = activeView.label === '最新数据' ? '季度填报数据汇总_各项目最新结果' : '季度填报数据汇总_全量审计历史明细'
    }

    const exportData = filtered.map(row => {
      const exportRow: Record<string, any> = {}
      config.cols.filter(c => !c.hidden).forEach(col => {
        let value = getLookupValue(col, row)
        if (col.displayMap && col.displayMap[String(value)]) {
          value = col.displayMap[String(value)]
        } else if (col.foreignKey && dicts[col.foreignKey]?.[value]) {
          value = dicts[col.foreignKey][value]
        }
        if (col.key === 'created_at' && value) {
          value = new Date(value).toLocaleString('zh-CN', {
            year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
          })
        }
        exportRow[col.label] = value ?? ''
      })
      return exportRow
    })

    const ws = XLSX.utils.json_to_sheet(exportData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, config.label)
    const now = new Date()
    const ts = now.toISOString().slice(0, 10).replace(/-/g, '')
    const filename = `${filenamePrefix}_${ts}.xlsx`
    XLSX.writeFile(wb, filename)
    showToast(`已导出 ${filtered.length} 条数据`)

    getSession().then(session => {
      const userId = session?.user?.email ?? session?.user?.id ?? 'admin'
      logAction(userId, 'ADMIN_DATA_OPERATION', {
        operation: 'EXPORT_EXCEL', table: config.table, table_label: config.label,
        count: filtered.length, filename,
      })
    })
  }, [config, dicts, filtered, viewMode, showToast])

  return { exportToExcel }
}
