'use client'
import React, { useState, useEffect } from 'react'
import { supabase } from '@/src/services/supabaseClient'
import { MaskedCell } from '@/src/components/demo/MaskedCell'
import type { DictBundle } from '../../types'
import { Button, Dialog, EmptyState, LoadingState } from '@/src/components/ui'

interface HistoryModalProps {
  buildingId: string
  year: number
  quarter: number
  dicts: DictBundle
  onClose: () => void
}

export function HistoryModal({ buildingId, year, quarter, dicts, onClose }: HistoryModalProps) {
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetch = async () => {
      setLoading(true)
      const { data: rows, error } = await supabase
        .from('quarterly_submissions')
        .select('*')
        .eq('building_id', buildingId)
        .eq('record_year', year)
        .eq('record_quarter', quarter)
        .order('created_at', { ascending: false })

      if (error) {
        console.error('fetchHistory error:', error)
        setData([])
      } else {
        setData(rows || [])
      }
      setLoading(false)
    }
    fetch()
  }, [buildingId, year, quarter])

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }} title="提交历史记录" description={`项目：${dicts.buildings?.[buildingId] || buildingId} · 时间：${year} Q${quarter}`} size="xl" footer={<Button variant="secondary" onClick={onClose}>关闭</Button>}>
          {loading ? (
            <LoadingState label="正在加载提交历史" />
          ) : data.length === 0 ? (
            <EmptyState title="暂无历史记录" />
          ) : (
            <div className="space-y-4">
              {data.map((record, index) => (
                <div key={record.id} className={`border rounded-lg p-4 ${index === 0 ? 'border-emerald-300 bg-emerald-50/30' : 'border-zinc-200 bg-white'}`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      {index === 0 && <span className="px-2 py-0.5 text-[10px] font-medium text-emerald-700 bg-emerald-100 rounded">最新版本</span>}
                      <span className="text-xs text-zinc-500">版本 #{data.length - index}</span>
                    </div>
                    <div className="text-xs text-zinc-400">
                      提交时间：{new Date(record.created_at).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 text-xs">
                    <div><span className="text-zinc-500">提交人：</span><MaskedCell masked><span className="font-medium">{record.user_name}</span></MaskedCell></div>
                    <div><span className="text-zinc-500">报价租金：</span><span className="font-medium">{record.asking_rent ?? '-'}</span></div>
                    <div><span className="text-zinc-500">物业费：</span><span className="font-medium">{record.management_fee ?? '-'}</span></div>
                    <div><span className="text-zinc-500">净有效租金：</span><span className="font-medium text-emerald-600">{record.net_effective_rent ?? '-'}</span></div>
                    <div><span className="text-zinc-500">空置率：</span><span className="font-medium text-blue-600">{record.vacancy_rate != null ? `${(record.vacancy_rate * 100).toFixed(1)}%` : '-'}</span></div>
                    <div><span className="text-zinc-500">总面积：</span><span className="font-medium">{record.total_area ?? '-'}</span></div>
                    {record.notes && <div className="col-span-2 md:col-span-3 lg:col-span-4"><span className="text-zinc-500">备注：</span><span className="font-medium">{record.notes}</span></div>}
                  </div>
                </div>
              ))}
            </div>
          )}
    </Dialog>
  )
}
