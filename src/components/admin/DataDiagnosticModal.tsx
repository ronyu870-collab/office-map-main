'use client'

import * as React from 'react'
import type { TableConfig, ColDef } from './types'
import { Button, Dialog } from '@/src/components/ui'

interface DataDiagnosticModalProps {
  config: TableConfig
  rows: any[]
  onClose: () => void
}

interface FieldDiag {
  col: ColDef
  total: number
  nullCount: number
  nullPct: number
  min: number | null
  max: number | null
  median: number | null
  uniqueCount: number
  trueCount: number | null
  falseCount: number | null
  hasExtremeWarning: boolean
}

function computeDiagnostics(config: TableConfig, rows: any[]): FieldDiag[] {
  return config.cols.filter(c => !c.hidden).map(col => {
    const total = rows.length
    let nullCount = 0
    const nums: number[] = []
    const uniqueVals = new Set<string>()
    let trueCount = 0
    let falseCount = 0

    for (const row of rows) {
      const val = row[col.key]
      if (val === null || val === undefined || val === '') {
        nullCount++
        continue
      }
      if (col.type === 'number') {
        const n = Number(val)
        if (Number.isFinite(n)) nums.push(n)
        else nullCount++
      } else if (col.type === 'boolean') {
        val ? trueCount++ : falseCount++
      } else {
        uniqueVals.add(String(val))
      }
    }

    const nullPct = total > 0 ? nullCount / total : 0

    let min: number | null = null
    let max: number | null = null
    let median: number | null = null
    let hasExtremeWarning = false

    if (col.type === 'number' && nums.length > 0) {
      nums.sort((a, b) => a - b)
      min = nums[0]
      max = nums[nums.length - 1]
      median = nums.length % 2 === 1
        ? nums[Math.floor(nums.length / 2)]
        : (nums[nums.length / 2 - 1] + nums[nums.length / 2]) / 2

      if (median > 0) {
        if (min < median / 5 || max > median * 5) {
          hasExtremeWarning = true
        }
      }
    }

    return {
      col,
      total,
      nullCount,
      nullPct,
      min,
      max,
      median,
      uniqueCount: col.type === 'number' ? new Set(nums.map(String)).size : uniqueVals.size,
      trueCount: col.type === 'boolean' ? trueCount : null,
      falseCount: col.type === 'boolean' ? falseCount : null,
      hasExtremeWarning,
    }
  })
}

function formatNum(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '-'
  if (Math.abs(n) >= 1000) return n.toLocaleString('zh-CN', { maximumFractionDigits: 1 })
  return n.toFixed(1)
}

const TABLE_DESCRIPTIONS: Record<string, string> = {
  buildings: '楼宇基础信息主表。包含项目名称、位置、等级、业主等静态属性。通过 id 与 building_metrics（季度指标）、lease_transactions（租赁成交）等表关联。注意：leasable_area（可租赁面积）与 building_metrics.total_area（总面积）是不同字段，可能来自不同数据源。',
  building_metrics: '每季度更新的楼宇经营指标。包含面积、租金、空置率等核心数据。通过 building_id 外键关联 buildings 表。地图系统的加权平均租金和空置率计算基于此表。每个楼宇每季度最多一条记录。',
  building_historical_metrics: '历史归档指标数据，用于趋势分析。结构与 building_metrics 类似，但按年份/季度存储历史快照。',
  future_supplies: '未来供应项目数据。记录尚未入市的楼宇信息，用于供应预测分析。',
  lease_transactions: '租赁成交记录。包含企业名称、面积、租金、租期等交易详情。数据来源包括人工录入和系统抓取。',
  private_equity_transactions: '私募融资记录。包含企业融资轮次、金额、投资方等信息。',
  user_roles: '系统用户列表。包含用户角色、联系方式等。通过 user_id 与填报数据关联。',
  building_assignments: '楼宇填报任务分配。记录哪个用户负责填报哪些楼宇的季度数据。',
  quarterly_submissions: '季度填报数据提交记录。用户填写的原始数据，经审核后写入 building_metrics。',
  quarterly_updates: '填报操作日志。记录每次填报的原始 payload，用于审计追踪。',
  update_drafts: '填报草稿。用户保存但未提交的填报数据。',
  project_ledger: `【项目台账】是一个虚拟拼接视图，不是数据库实体表。它将"季度填报数据"和"实时动态数据"合并展示，每一行都通过 building_id 关联 buildings 表获取项目基础信息。

══════════════════════════════════════════════
  数据拼接逻辑
══════════════════════════════════════════════

  buildings（建筑基础信息主表）
      │
      ├─► building_metrics（季度填报）
      │     └ 每一行 → 台账一行，source_type = "季度填报"
      │
      └─► building_current_data（最新动态）
            └ 每一行 → 台账一行，source_type = "最新动态"

  两套数据源的"共性指标"（租金、空置等7个字段）共用同一组列展示。
  差异字段以 NULL 填充——季报行没有"数据来源/来源详情/更新人"，动态行没有"总面积/环比变化/季度最后修改"。

══════════════════════════════════════════════
  列分组及数据来源
══════════════════════════════════════════════

  【来源标识】（2列，前端拼接生成，非数据库字段）
  · source_type — "季度填报" 或 "最新动态"，标识该行来自哪张表
  · data_period — 数据时间，季报显示"2025Q4"格式，动态显示"2026-06-26"格式

  【BUILDING_COLS】（18列，全部来自 buildings 表，两组数据源均有值）
  · 列顺序与"存量项目基础信息/未来新增供应/待加入存量"三表完全对齐
  · 包含：项目名称、曾用名、入市时间、加入系统时间、子市场、楼宇等级、
    城市、行政区、业主、物业公司、联系方式、经纬度、LEED认证、
    可租赁面积、启用状态、是否已入市、备注

  【building_metrics 专属】（2列，仅季报有值，动态行为 NULL）
  · is_locked — 该季度数据是否已被锁定
  · metrics_updated_at — 季度数据最后修改时间

  【DATA_METRIC_COLS】（11列，按 building_metrics 列顺序排列）
  · 共有指标（两组均有值）：报价租金、物业费、表面租金、免租期、
    净有效租金、空置面积、空置率
  · 季报独有（动态行为 NULL）：总面积、租金环比变化、租金同比变化、
    空置面积季度变化

  【building_current_data 专属】（3列，仅动态有值，季报行为 NULL）
  · data_source — 数据来源渠道
  · source_detail — 来源补充说明
  · updated_by — 数据更新人

══════════════════════════════════════════════
  ⚠️ 重要提示
══════════════════════════════════════════════

  项目台账为只读视图，不可在此直接编辑或删除数据。如需修改：
  · 基础信息（名称、等级、业主等）→ 到「存量项目基础信息/未来新增供应/待加入存量」编辑
  · 季度指标（租金、空置率等）→ 到「季度更新数据」编辑
  · 最新动态（实时快照）→ 到「实时动态数据」编辑

  下方"字段映射"表列出了全部39个字段的数据库列名、类型和基本属性。
  "数据质量诊断"可帮助识别空值率异常和极端值。`,
}

export function DataDiagnosticModal({ config, rows, onClose }: DataDiagnosticModalProps) {
  const diagnostics = React.useMemo(() => computeDiagnostics(config, rows), [config, rows])
  const desc = TABLE_DESCRIPTIONS[config.table] || ''

  return (
    <Dialog
      open
      onOpenChange={(open) => { if (!open) onClose() }}
      title={`数据库说明 — ${config.label}`}
      description={<span>表名：<code className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px]">{config.table}</code> · 当前加载 <strong>{rows.length}</strong> 条记录</span>}
      size="xl"
      footer={<Button variant="secondary" onClick={onClose}>关闭</Button>}
    >
        <div className="space-y-6">

          {/* 表说明 */}
          {desc && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-zinc-800">表说明</h3>
              <div className="rounded-lg bg-zinc-50 p-3 text-xs leading-relaxed text-zinc-600 whitespace-pre-line">{desc}</div>
            </section>
          )}

          {/* 区块1：字段映射 */}
          <section>
            <h3 className="mb-2 text-sm font-semibold text-zinc-800">字段映射</h3>
            <div className="overflow-auto rounded-lg border border-zinc-200">
              <table className="w-full text-xs">
                <thead className="bg-zinc-50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-zinc-600">数据库列名</th>
                    <th className="px-3 py-2 text-left font-semibold text-zinc-600">中文标签</th>
                    <th className="px-3 py-2 text-left font-semibold text-zinc-600">数据类型</th>
                    <th className="px-3 py-2 text-left font-semibold text-zinc-600">显示状态</th>
                    <th className="px-3 py-2 text-left font-semibold text-zinc-600">备注</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {diagnostics.map(d => {
                    const notes: string[] = []
                    if (d.col.readOnly) notes.push('只读')
                    if (d.col.required) notes.push('必填')
                    if (d.col.foreignKey) notes.push(`外键→${d.col.foreignKey}`)
                    if (d.col.masked) notes.push('脱敏')
                    if (d.col.decimals != null) notes.push(`${d.col.decimals}位小数`)
                    return (
                      <tr key={d.col.key + (d.col.sourceKey || '')} className="hover:bg-zinc-50">
                        <td className="px-3 py-1.5 font-mono text-[11px] text-zinc-700">{d.col.key}</td>
                        <td className="px-3 py-1.5 font-medium text-zinc-800">{d.col.label}</td>
                        <td className="px-3 py-1.5 text-zinc-500">{d.col.type}</td>
                        <td className="px-3 py-1.5">
                          {d.col.hidden ? (
                            <span className="inline-block rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500">隐藏</span>
                          ) : (
                            <span className="inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600">显示</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-zinc-400">{notes.join('、') || '-'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* 区块2：数据质量诊断 */}
          <section>
            <h3 className="mb-2 text-sm font-semibold text-zinc-800">数据质量诊断</h3>
            <div className="overflow-auto rounded-lg border border-zinc-200">
              <table className="w-full text-xs">
                <thead className="bg-zinc-50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-zinc-600">字段</th>
                    <th className="px-3 py-2 text-right font-semibold text-zinc-600">总行数</th>
                    <th className="px-3 py-2 text-right font-semibold text-zinc-600">空值数</th>
                    <th className="px-3 py-2 text-right font-semibold text-zinc-600">空值率</th>
                    <th className="px-3 py-2 text-right font-semibold text-zinc-600">最小值</th>
                    <th className="px-3 py-2 text-right font-semibold text-zinc-600">最大值</th>
                    <th className="px-3 py-2 text-right font-semibold text-zinc-600">中位数</th>
                    <th className="px-3 py-2 text-right font-semibold text-zinc-600">唯一值</th>
                    <th className="px-3 py-2 text-left font-semibold text-zinc-600">状态</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {diagnostics.map(d => {
                    const isHighNull = d.nullPct > 0.3
                    return (
                      <tr key={d.col.key + (d.col.sourceKey || '')} className={`hover:bg-zinc-50 ${isHighNull ? 'bg-red-50/50' : ''}`}>
                        <td className="px-3 py-1.5 font-medium text-zinc-800">{d.col.label}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-zinc-600">{d.total}</td>
                        <td className={`px-3 py-1.5 text-right tabular-nums ${isHighNull ? 'font-semibold text-red-600' : 'text-zinc-600'}`}>{d.nullCount}</td>
                        <td className={`px-3 py-1.5 text-right tabular-nums ${isHighNull ? 'font-semibold text-red-600' : 'text-zinc-600'}`}>{(d.nullPct * 100).toFixed(1)}%</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-zinc-600">{d.col.type === 'number' ? formatNum(d.min) : '-'}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-zinc-600">{d.col.type === 'number' ? formatNum(d.max) : '-'}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-zinc-600">{d.col.type === 'number' ? formatNum(d.median) : '-'}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-zinc-600">
                          {d.col.type === 'boolean' ? (
                            <span>{d.trueCount} 是 / {d.falseCount} 否</span>
                          ) : (
                            d.uniqueCount
                          )}
                        </td>
                        <td className="px-3 py-1.5">
                          {isHighNull && (
                            <span className="inline-block rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-600">空值率高</span>
                          )}
                          {d.hasExtremeWarning && (
                            <span className="ml-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-600">疑似极端值</span>
                          )}
                          {!isHighNull && !d.hasExtremeWarning && (
                            <span className="inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600">正常</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

        </div>
    </Dialog>
  )
}
