'use client'
import React, { useState, useEffect } from 'react'
import { supabase } from '@/src/services/supabaseClient'
import { MaskedCell } from '@/src/components/demo/MaskedCell'
import type { DictBundle } from '../../types'

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="max-w-6xl max-h-[90vh] w-full mx-4 bg-white rounded-lg shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
          <div>
            <h3 className="text-base font-semibold text-zinc-900">提交历史记录</h3>
            <p className="text-xs text-zinc-500 mt-1">
              项目：{dicts.buildings?.[buildingId] || buildingId} | 时间：{year} Q{quarter}
            </p>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 transition">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="flex-1 overflow-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#003e7e] border-t-transparent" />
            </div>
          ) : data.length === 0 ? (
            <div className="text-center py-12 text-zinc-400">暂无历史记录</div>
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
        </div>
        <div className="px-6 py-4 border-t border-zinc-200 flex justify-end">
          <button onClick={onClose} className="rounded bg-zinc-600 px-4 py-2 text-xs text-white hover:bg-zinc-700">关闭</button>
        </div>
      </div>
    </div>
  )
}
