'use client'

import * as React from 'react'
import { supabase } from '@/src/services/supabaseClient'
import { logAction } from '@/src/utils/audit'
import { getSession } from '@/src/services/Auth'

interface Building {
  id: string
  name: string
  submarket: string
  grade: string
  sort_order: number
}

type GradeTab = 'A' | 'B' | 'BP'

const GRADE_TABS: { key: GradeTab; label: string }[] = [
  { key: 'A', label: '甲级' },
  { key: 'B', label: '乙级' },
  { key: 'BP', label: '产业园' },
]

const SUBMARKET_ORDER: Record<GradeTab, string[]> = {
  A: ['CBD', '东城商务区', '金融街', '燕莎', '中关村', '望京-酒仙桥', '亚奥', '丽泽', '其他', '通州'],
  B: ['CBD', '东城商务区', '金融街', '燕莎', '中关村', '望京-酒仙桥', '亚奥', '其他'],
  BP: ['望京-酒仙桥', '丰台科技园', '上地', '亦庄', '北清路', '通惠河传媒走廊', '其他'],
}

function gradeToTab(grade: string): GradeTab {
  const g = (grade ?? '').trim().toUpperCase()
  if (g === 'BP' || g.includes('BP') || g === 'BUSINESS PARK') return 'BP'
  if (g === 'B' || g === 'B+' || (g.startsWith('B') && !g.startsWith('BP'))) return 'B'
  return 'A'
}

export function BuildingSortManager() {
  const [buildings, setBuildings] = React.useState<Building[]>([])
  const [loading, setLoading] = React.useState(true)
  const [activeTab, setActiveTab] = React.useState<GradeTab>('A')
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set())
  const [saving, setSaving] = React.useState(false)
  const [toast, setToast] = React.useState<{ msg: string; ok: boolean } | null>(null)

  React.useEffect(() => { void fetchBuildings() }, [])

  async function fetchBuildings() {
    setLoading(true)
    const { data } = await supabase
      .from('buildings')
      .select('id, name, submarket, grade, sort_order')
      .eq('is_active', true)
      .eq('tracking_scope', 'tracked')
      .order('sort_order')
      .limit(2000)
    setBuildings(data ?? [])
    setLoading(false)
  }

  const filtered = React.useMemo(() => {
    return buildings.filter(b => gradeToTab(b.grade) === activeTab && b.sort_order >= 0)
  }, [buildings, activeTab])

  const submarketGroups = React.useMemo(() => {
    const map = new Map<string, Building[]>()
    for (const b of filtered) {
      const sm = b.submarket || '未分组'
      if (!map.has(sm)) map.set(sm, [])
      map.get(sm)!.push(b)
    }
    // 每组内已按 sort_order 排序（因为 buildings 整体有序）
    const order = SUBMARKET_ORDER[activeTab]
    return Array.from(map.entries()).sort((a, b) => {
      const ia = order.indexOf(a[0])
      const ib = order.indexOf(b[0])
      const oa = ia >= 0 ? ia : order.length
      const ob = ib >= 0 ? ib : order.length
      return oa - ob
    })
  }, [filtered])

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 2000)
  }

  function toggleCollapse(submarket: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(submarket)) next.delete(submarket)
      else next.add(submarket)
      return next
    })
  }

  async function saveSortOrder(updates: { id: string; sort_order: number }[]) {
    setSaving(true)
    try {
      for (const u of updates) {
        await supabase.from('buildings').update({ sort_order: u.sort_order }).eq('id', u.id)
      }
      const s = await getSession();
      logAction(s?.user?.email || 'unknown', 'ADMIN_DATA_OPERATION', {
        operation: 'UPDATE',
        table: 'buildings',
        table_label: '楼宇排序',
        count: updates.length,
      });
      showToast('保存成功', true)
    } catch {
      showToast('保存失败', false)
    }
    setSaving(false)
  }

  async function handleMove(submarket: string, index: number, direction: -1 | 1) {
    const group = submarketGroups.find(([sm]) => sm === submarket)?.[1]
    if (!group) return
    const targetIdx = index + direction
    if (targetIdx < 0 || targetIdx >= group.length) return

    const a = group[index]
    const b = group[targetIdx]
    const newAOrder = b.sort_order
    const newBOrder = a.sort_order

    // 拍卖比克问题：先设一个临时值避免唯一约束冲突
    const temp = -Math.abs(a.sort_order) - 100000
    await supabase.from('buildings').update({ sort_order: temp }).eq('id', a.id)
    await supabase.from('buildings').update({ sort_order: newAOrder }).eq('id', b.id)
    await supabase.from('buildings').update({ sort_order: newBOrder }).eq('id', a.id)

    // 本地更新
    setBuildings(prev => {
      const next = [...prev]
      const idxA = next.findIndex(x => x.id === a.id)
      const idxB = next.findIndex(x => x.id === b.id)
      if (idxA >= 0) next[idxA] = { ...next[idxA], sort_order: newBOrder }
      if (idxB >= 0) next[idxB] = { ...next[idxB], sort_order: newAOrder }
      return next
    })
  }

  async function handleDirectEdit(id: string, newOrder: number) {
    await supabase.from('buildings').update({ sort_order: newOrder }).eq('id', id)
    setBuildings(prev => prev.map(b => b.id === id ? { ...b, sort_order: newOrder } : b))
    showToast('已保存', true)
  }

  async function handleRenumber(submarket: string) {
    const group = submarketGroups.find(([sm]) => sm === submarket)?.[1]
    if (!group) return

    setSaving(true)
    const updates = group.map((b, i) => ({ id: b.id, sort_order: (i + 1) * 10 }))
    for (const u of updates) {
      await supabase.from('buildings').update({ sort_order: u.sort_order }).eq('id', u.id)
    }
    setBuildings(prev => {
      const next = [...prev]
      for (const u of updates) {
        const idx = next.findIndex(x => x.id === u.id)
        if (idx >= 0) next[idx] = { ...next[idx], sort_order: u.sort_order }
      }
      return next
    })
    setSaving(false)
    showToast(`${submarket} 已重新编号`, true)
  }

  async function handleRenumberAll() {
    setSaving(true)
    for (const [submarket] of submarketGroups) {
      const group = submarketGroups.find(([sm]) => sm === submarket)?.[1]
      if (!group) continue
      for (let i = 0; i < group.length; i++) {
        await supabase.from('buildings').update({ sort_order: (i + 1) * 10 }).eq('id', group[i].id)
      }
    }
    await fetchBuildings()
    setSaving(false)
    showToast('全部重新编号完成', true)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#003e7e] border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden w-full">
      {/* 标题栏 */}
      <div className="shrink-0 border-b border-zinc-200 bg-white px-6 py-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-zinc-900">楼宇排序管理</h2>
          <p className="text-xs text-zinc-500 mt-0.5">调整各子市场内楼宇的显示顺序，修改即时生效</p>
        </div>
        <button
          onClick={handleRenumberAll}
          disabled={saving}
          className="px-4 py-2 text-xs font-semibold rounded-lg border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 transition disabled:opacity-50"
        >
          全部重新编号
        </button>
      </div>

      {/* Grade tabs */}
      <div className="shrink-0 border-b border-zinc-200 bg-white px-6 py-2 flex items-center gap-1">
        {GRADE_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              activeTab === tab.key
                ? 'bg-[#003e7e] text-white'
                : 'text-zinc-600 hover:bg-zinc-100'
            }`}
          >
            {tab.label}
            <span className="ml-1.5 opacity-60">
              ({buildings.filter(b => gradeToTab(b.grade) === tab.key).length})
            </span>
          </button>
        ))}
      </div>

      {/* 子市场分组列表 */}
      <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4">
        {submarketGroups.length === 0 && (
          <div className="text-center text-zinc-400 py-16 text-sm">当前分类下没有楼宇</div>
        )}
        {submarketGroups.map(([submarket, group]) => {
          const isCollapsed = collapsed.has(submarket)
          return (
            <div key={submarket} className="border border-zinc-200 rounded-lg bg-white shadow-sm">
              {/* 子市场标题 */}
              <button
                onClick={() => toggleCollapse(submarket)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-50 transition rounded-t-lg"
              >
                <div className="flex items-center gap-2">
                  <svg
                    className={`w-4 h-4 text-zinc-400 transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                  <span className="text-sm font-semibold text-zinc-800">{submarket}</span>
                  <span className="text-xs text-zinc-400">({group.length} 栋)</span>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); handleRenumber(submarket) }}
                  className="text-xs text-zinc-500 hover:text-[#003e7e] transition px-2 py-1 rounded hover:bg-blue-50"
                >
                  重新编号
                </button>
              </button>

              {/* 楼宇列表 */}
              {!isCollapsed && (
                <div className="border-t border-zinc-100">
                  {/* 表头 */}
                  <div className="grid grid-cols-[80px_1fr_120px_80px] gap-2 px-4 py-2 text-xs font-semibold text-zinc-500 bg-zinc-50">
                    <div>顺序</div>
                    <div>项目名称</div>
                    <div>子市场</div>
                    <div className="text-right">操作</div>
                  </div>
                  {group.map((b, idx) => (
                    <div
                      key={b.id}
                      className="grid grid-cols-[80px_1fr_120px_80px] gap-2 px-4 py-2.5 text-sm items-center border-t border-zinc-50 hover:bg-blue-50/30 transition"
                    >
                      <div>
                        <input
                          type="number"
                          value={b.sort_order}
                          onChange={e => {
                            const val = parseInt(e.target.value) || 0
                            setBuildings(prev => prev.map(x => x.id === b.id ? { ...x, sort_order: val } : x))
                          }}
                          onBlur={e => {
                            const val = parseInt(e.target.value) || 0
                            if (val !== b.sort_order) handleDirectEdit(b.id, val)
                          }}
                          className="w-16 px-2 py-1 text-xs font-mono border border-zinc-200 rounded focus:border-[#003e7e] focus:ring-1 focus:ring-[#003e7e]/20 outline-none text-center"
                        />
                      </div>
                      <div className="font-medium text-zinc-800 truncate" title={b.name}>{b.name}</div>
                      <div className="text-xs text-zinc-500">{b.submarket}</div>
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleMove(submarket, idx, -1)}
                          disabled={idx === 0 || saving}
                          className="p-1 rounded hover:bg-zinc-200 text-zinc-400 hover:text-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition"
                          title="上移"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="18 15 12 9 6 15" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleMove(submarket, idx, 1)}
                          disabled={idx === group.length - 1 || saving}
                          className="p-1 rounded hover:bg-zinc-200 text-zinc-400 hover:text-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition"
                          title="下移"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 px-4 py-2.5 rounded-lg text-sm font-medium shadow-lg z-50 ${
          toast.ok ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
