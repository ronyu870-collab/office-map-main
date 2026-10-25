'use client'
import { useState, useRef, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/src/services/supabaseClient'
import { logAction } from '@/src/utils/audit'
import { getSession } from '@/src/services/Auth'
import type { TableConfig, DictBundle } from '../types'
import { parseUploadCellValue } from '../uploadValueParser'
import {
  XLSX_SHEET_ROW_LIMIT,
  validateXlsxRowBudget,
  validateXlsxUploadFile,
} from './xlsxSecurity'


/**
 * XLSX 导入 hook — 模板下载 + 智能匹配 upsert
 */
export function useXlsxImport(
  config: TableConfig,
  dicts: DictBundle,
  fetchRows: () => Promise<void | boolean>,
  showToast: (msg: string, ok?: boolean) => void,
  onRefreshDicts?: () => Promise<void>,
) {
  const [uploading, setUploading] = useState(false)
  const [importErrors, setImportErrors] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const writableCols = config.cols.filter(c => !c.readOnly)

  // ── XLSX 模板下载 ──
  const downloadTemplate = useCallback(() => {
    const visibleWritable = writableCols.filter(c => !c.hidden)
    const header = visibleWritable.map(c => c.label)

    const instructions = visibleWritable.map(col => {
      const parts: string[] = []
      const isRequired = config.uploadMatchKeys?.includes(col.key) || col.required
      if (isRequired) {
        parts.push('【必填】')
      }
      if (col.foreignKey && dicts[col.foreignKey]) {
        parts.push('填写名称，系统自动匹配')
      } else if (col.displayMap) {
        parts.push(`填写：${Object.values(col.displayMap).join('/')}`)
      } else if (col.type === 'boolean') {
        parts.push(isRequired ? '填写：是 或 否' : '填写：是 或 否；更新时留空保留原值')
      } else if (col.type === 'number') {
        parts.push(isRequired ? '填写数字' : '填写数字；更新时留空保留原值')
      } else if (col.type === 'date') {
        parts.push(isRequired ? '格式：YYYY-MM-DD' : '格式：YYYY-MM-DD；更新时留空保留原值')
      } else if (col.type === 'jsonb') {
        parts.push('填写JSON格式')
      } else if (col.type === 'textarea') {
        parts.push(isRequired ? '文本' : '文本；更新时留空保留原值')
      } else {
        parts.push(isRequired ? '文本' : '文本；更新时留空保留原值')
      }
      return parts.join('；')
    })

    const ws = XLSX.utils.aoa_to_sheet([header, instructions])
    ws['!cols'] = visibleWritable.map(() => ({ wch: 22 }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '上传数据')
    const filename = `${config.label}_上传模板.xlsx`
    XLSX.writeFile(wb, filename)
    logAction(undefined, 'EXPORT_DATA', {
      export_type: 'upload_template',
      table: config.table,
      table_label: config.label,
      file_name: filename,
      target_name: filename,
    })
  }, [config, dicts, writableCols])

  const triggerUpload = useCallback(() => {
    setImportErrors([])
    fileInputRef.current?.click()
  }, [])

  // ── XLSX 文件读取 ──
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const fileError = validateXlsxUploadFile(file)
    e.target.value = ''
    if (fileError) {
      showToast(fileError, false)
      return
    }

    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target?.result as ArrayBuffer)
        const workbook = XLSX.read(data, {
          type: 'array',
          cellFormula: false,
          cellHTML: false,
          cellStyles: false,
          bookVBA: false,
          sheetRows: XLSX_SHEET_ROW_LIMIT,
        })
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' }) as unknown[][]
        const budgetError = validateXlsxRowBudget(rows)
        if (budgetError) {
          showToast(budgetError, false)
          return
        }
        void processWorkbook(rows)
      } catch (err: any) {
        showToast(`XLSX 文件解析失败：${err.message}`, false)
      }
    }
    reader.readAsArrayBuffer(file)
  }, [config, dicts, fetchRows, showToast])

  // ── 单元格转字符串 ──
  function cellToString(cell: unknown): string {
    if (cell === null || cell === undefined) return ''
    if (typeof cell === 'number') return String(cell)
    if (typeof cell === 'boolean') return cell ? '是' : '否'
    if (cell instanceof Date) return cell.toISOString().slice(0, 10)
    return String(cell).trim()
  }

  // ── 数据解析与导入 ──
  const processWorkbook = async (rows: unknown[][]) => {
    // 过滤全空行
    const nonEmptyRows = rows.filter(r => r.some(c => c !== null && c !== undefined && String(c).trim() !== ''))
    if (nonEmptyRows.length < 2) { showToast('XLSX 文件为空或只有表头', false); return }

    const visibleWritable = writableCols.filter(c => !c.hidden)
    const headerRow = nonEmptyRows[0].map(c => cellToString(c))
    const expectedLabels = visibleWritable.map(c => c.label)

    if (headerRow.length !== expectedLabels.length || !headerRow.every((h, i) => h === expectedLabels[i])) {
      showToast('表头不匹配，请先点击「下载上传模板」获取标准模板', false); return
    }

    // 跳过说明行
    let dataStartIdx = 1
    if (nonEmptyRows.length > 1) {
      const secondRow = nonEmptyRows[1].map(c => String(c ?? '')).join('')
      if (secondRow.includes('匹配键') || secondRow.includes('必填') || secondRow.includes('填写') || secondRow.includes('系统自动')) {
        dataStartIdx = 2
      }
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const errors: string[] = []
    const parsed: Record<string, any>[] = []

    // 构建外键反向字典（检测同名冲突）
    const reverseDicts: Record<string, Record<string, string>> = {}
    const allColsForDict = [...writableCols]
    if (config.uploadMatchKeys) {
      for (const mk of config.uploadMatchKeys) {
        if (!writableCols.some(c => c.key === mk)) {
          const col = config.cols.find(c => c.key === mk)
          if (col) allColsForDict.push(col)
        }
      }
    }
    for (const col of allColsForDict) {
      if (col.foreignKey && dicts[col.foreignKey] && !reverseDicts[col.key]) {
        reverseDicts[col.key] = {}
        const activeIds = dicts['active_building_ids'] || {}
        for (const [id, name] of Object.entries(dicts[col.foreignKey])) {
          const existingId = reverseDicts[col.key][name]
          if (existingId && existingId !== id) {
            if (activeIds[id] && !activeIds[existingId]) {
              reverseDicts[col.key][name] = id
            }
          } else {
            reverseDicts[col.key][name] = id
          }
        }
      }
    }

    for (let i = dataStartIdx; i < nonEmptyRows.length; i++) {
      const cells = nonEmptyRows[i]
      const rowNum = i + 1
      const rowData: Record<string, any> = {}

      visibleWritable.forEach((col, idx) => {
        const raw = cellToString(cells[idx])
        const parsedCell = parseUploadCellValue(col, raw)

        if (parsedCell.kind === 'skip') {
          return
        }
        if (parsedCell.kind === 'error') {
          errors.push(`第 ${rowNum} 行 - ${col.label}：${parsedCell.message}`)
          return
        }

        if (col.foreignKey && reverseDicts[col.key]) {
          const foreignValue = String(parsedCell.value)
          if (uuidRegex.test(foreignValue)) {
            rowData[col.key] = foreignValue
          } else {
            let resolvedId = reverseDicts[col.key][foreignValue]
            if (!resolvedId && col.foreignKey === 'buildings' && dicts['building_former_names']) {
              resolvedId = dicts['building_former_names'][foreignValue]
            }
            if (!resolvedId) {
              errors.push(`第 ${rowNum} 行 - ${col.label}：找不到名为 "${foreignValue}" 的记录`)
            } else {
              rowData[col.key] = resolvedId
            }
          }
        } else {
          rowData[col.key] = parsedCell.value
        }
      })

      if (errors.length === 0) parsed.push(rowData)
    }

    if (errors.length > 0) { setImportErrors(errors); return }

    const hasMatchKeys = config.uploadMatchKeys && config.uploadMatchKeys.length > 0

    // matchKey 必填校验
    if (hasMatchKeys) {
      for (let i = 0; i < parsed.length; i++) {
        for (const mk of config.uploadMatchKeys!) {
          const val = parsed[i][mk]
          if (val === undefined || val === null || val === '') {
            const col = config.cols.find(c => c.key === mk)
            errors.push(`第 ${i + 2} 行 - ${col?.label ?? mk}：匹配字段不能为空`)
          }
        }
      }
      if (errors.length > 0) { setImportErrors(errors); return }
    }

    setUploading(true)

    if (hasMatchKeys) {
      let insertedCount = 0
      let updatedCount = 0
      const matchErrors: string[] = []

      const { data: existingRows } = await supabase.from(config.table).select('*').limit(10000)
      const existing = existingRows || []

      for (let i = 0; i < parsed.length; i++) {
        const row = parsed[i]
        const rowNum = i + 2

        const allMatches = existing.filter((ex: any) => {
          return config.uploadMatchKeys!.every(mk => {
            const col = config.cols.find(c => c.key === mk)
            const csvVal = row[mk]
            const exVal = ex[mk]
            if (col?.foreignKey) return String(csvVal) === String(exVal)
            return String(csvVal ?? '').trim() === String(exVal ?? '').trim()
          })
        })

        if (allMatches.length > 1) {
          matchErrors.push(`第 ${rowNum} 行匹配到 ${allMatches.length} 条记录，跳过更新（matchKey 组合不唯一）`)
        } else if (allMatches.length === 1) {
          let updateQuery = supabase.from(config.table).update(row)
          for (const mk of config.uploadMatchKeys!) {
            updateQuery = updateQuery.eq(mk, allMatches[0][mk])
          }
          const { error } = await updateQuery
          if (error) matchErrors.push(`第 ${rowNum} 行更新失败: ${error.message}`)
          else updatedCount++
        } else {
          // 新增行：自动注入 filterField/filterValue（如 project_type）
          if (config.filterField && config.filterValue != null && !(config.filterField in row)) {
            row[config.filterField] = config.filterValue
          }
          const { error } = await supabase.from(config.table).insert(row)
          if (error) matchErrors.push(`第 ${rowNum} 行新增失败: ${error.message}`)
          else insertedCount++
        }
      }

      setUploading(false)
      if (matchErrors.length > 0) setImportErrors(matchErrors)
      const parts: string[] = []
      if (insertedCount > 0) parts.push(`新增 ${insertedCount} 条`)
      if (updatedCount > 0) parts.push(`更新 ${updatedCount} 条`)
      if (parts.length > 0) {
        showToast(parts.join('，'))
        const session = await getSession()
        const userId = session?.user?.email ?? session?.user?.id ?? 'admin'
        logAction(userId, 'ADMIN_DATA_OPERATION', {
          operation: 'BULK_UPSERT', table: config.table, table_label: config.label,
          count: parsed.length, inserted: insertedCount, updated: updatedCount,
        })

        // building_metrics 上传后自动锁定涉及的季度
        if (config.table === 'building_metrics') {
          const quarters = new Set<string>()
          for (const row of parsed) {
            if (row.record_year && row.record_quarter) {
              quarters.add(`${row.record_year}-${row.record_quarter}`)
            }
          }
          let lockedQ = 0
          const lockErrors: string[] = []
          for (const key of quarters) {
            const [y, q] = key.split('-').map(Number)
            const { data, error } = await supabase.rpc('lock_quarter', { p_year: y, p_quarter: q })
            if (error) {
              lockErrors.push(`${y}Q${q}: ${error.message}`)
            } else {
              const count = data?.[0]?.locked_count ?? 0
              lockedQ += count
            }
          }
          if (lockedQ > 0) parts.push(`已锁定 ${lockedQ} 行`)
          if (lockErrors.length > 0) {
            console.error('lock_quarter 失败:', lockErrors.join(', '))
            parts.push(`${lockErrors.length} 个季度锁定失败`)
          }
        }

        await fetchRows()
        if (config.table === 'buildings') await onRefreshDicts?.()
      } else if (matchErrors.length === 0) {
        showToast('无数据变更', false)
      }
    } else {
      // 批量新增：自动注入 filterField/filterValue
      if (config.filterField && config.filterValue != null) {
        for (const row of parsed) {
          if (!(config.filterField in row)) row[config.filterField] = config.filterValue
        }
      }
      const { error } = await supabase.from(config.table).insert(parsed)
      setUploading(false)
      if (error) {
        showToast(`导入失败: ${error.message}`, false)
      } else {
        showToast(`成功导入 ${parsed.length} 条数据`)
        const session = await getSession()
        const userId = session?.user?.email ?? session?.user?.id ?? 'admin'
        logAction(userId, 'ADMIN_DATA_OPERATION', {
          operation: 'BULK_INSERT', table: config.table, table_label: config.label, count: parsed.length,
        })
        await fetchRows()
        if (config.table === 'buildings') await onRefreshDicts?.()
      }
    }
  }

  return {
    uploading, importErrors, setImportErrors,
    fileInputRef,
    downloadTemplate, triggerUpload, handleFileSelect,
  }
}
