'use client'
import React from 'react'
import type { TableConfig } from '../../types'
import { Button, Dialog } from '@/src/components/ui'

interface UploadGuideModalProps {
  config: TableConfig
  onClose: () => void
}

export function UploadGuideModal({ config, onClose }: UploadGuideModalProps) {
  const writableCols = config.cols.filter(c => !c.readOnly && !c.hidden)

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }} title={`数据上传说明 — ${config.label}`} size="lg" footer={<Button variant="secondary" onClick={onClose}>关闭</Button>}>
        <div className="space-y-5 text-sm">
          {/* 三条核心规则 */}
          <div>
            <p className="font-semibold text-zinc-800 mb-3">只需记住三条规则</p>
            <div className="grid gap-2">
              {[
                ['1', '填写内容', '更新该字段'],
                ['2', '保持留空', '保留数据库原值'],
                ['3', '需要清空', '请在表格中单条编辑'],
              ].map(([index, action, result]) => (
                <div key={index} className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#003e7e] text-xs font-semibold text-white">
                    {index}
                  </span>
                  <span className="w-20 shrink-0 font-medium text-zinc-800">{action}</span>
                  <span className="text-zinc-300">→</span>
                  <span className="font-medium text-[#003e7e]">{result}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 匹配规则 */}
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
            <p className="font-semibold text-blue-800 mb-2">系统如何找到记录</p>
            <p className="text-blue-700">以下字段用于判断 Excel 中的一行对应哪条数据库记录，必须填写：</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {config.uploadMatchKeys?.map(mk => {
                const col = config.cols.find(c => c.key === mk)
                return (
                  <span key={mk} className="inline-flex items-center rounded-md bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-800">
                    {col?.label ?? mk}
                  </span>
                )
              })}
            </div>
            <div className="mt-3 space-y-1 text-xs text-blue-700">
              <p><strong>已存在</strong>（匹配字段全部相同）→ 只更新这一行中<strong>实际填写的字段</strong></p>
              <p><strong>不存在</strong>（匹配字段无对应）→ <span className="text-blue-800 font-semibold">新增一条</span>记录</p>
            </div>
          </div>

          {/* 详细说明 */}
          {config.uploadDescription && (
            <div>
              <p className="font-semibold text-zinc-700 mb-1">当前数据表的匹配方式</p>
              <p className="text-zinc-600 leading-relaxed">{config.uploadDescription}</p>
            </div>
          )}

          {/* 操作步骤 */}
          <div>
            <p className="font-semibold text-zinc-700 mb-2">操作步骤</p>
            <ol className="list-decimal list-inside space-y-1.5 text-zinc-600">
              <li>点击工具栏的 <span className="font-mono bg-zinc-100 px-1.5 rounded">模板</span> 下载标准 XLSX 模板</li>
              <li>保留表头，只填写需要新增或修改的内容</li>
              <li>点击 <span className="font-mono bg-zinc-100 px-1.5 rounded">上传</span> 选择填好的 XLSX 文件</li>
              <li>系统完成校验后，报告新增和更新数量</li>
            </ol>
          </div>

          {/* 季度更新数据：锁定规则 */}
          {config.table === 'building_metrics' && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <p className="font-semibold text-red-800 mb-2">数据锁定规则</p>
              <ul className="list-disc list-inside space-y-1.5 text-red-700 text-xs">
                <li><strong>上传即锁定：</strong>XLSX 上传成功后，涉及的全部季度数据将被自动锁定，无法在表格中直接编辑修改</li>
                <li><strong>单行解锁修改：</strong>如需修改某一行数据，点击该行的「编辑」按钮，输入确认短语后解锁该行即可编辑保存</li>
                <li><strong>批量解锁：</strong>如需批量修改某个季度的数据，使用工具栏「锁定管理」解锁整个季度，修改完成后重新上传即可自动锁定</li>
                <li><strong>再次上传：</strong>只更新已填写字段，空白字段保留原值，完成后重新锁定</li>
              </ul>
            </div>
          )}

          {/* 注意事项 */}
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <p className="font-semibold text-amber-800 mb-2">注意事项</p>
            <ul className="list-disc list-inside space-y-1 text-amber-700 text-xs">
              <li>匹配字段（上方高亮的列）始终必填；新增记录时，模板中标注为必填的字段也必须填写</li>
              <li>外键列（如项目名称、用户姓名）填写中文名称即可，系统会自动匹配</li>
              <li>所有类型的空白字段都不会覆盖数据库原值</li>
              <li>批量上传不能清空字段；如需清空，请使用表格中的单条编辑</li>
              <li>XLSX 文件格式为 .xlsx，支持 Excel 或 WPS 打开编辑</li>
            </ul>
          </div>

          {/* 列清单 */}
          <div>
            <p className="font-semibold text-zinc-700 mb-2">上传列清单</p>
            <div className="border border-zinc-200 rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-zinc-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-zinc-600">列名</th>
                    <th className="px-3 py-2 text-left font-medium text-zinc-600">类型</th>
                    <th className="px-3 py-2 text-left font-medium text-zinc-600">说明</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {writableCols.map(col => {
                    const isMatchKey = config.uploadMatchKeys?.includes(col.key)
                    return (
                      <tr key={col.key} className={isMatchKey ? 'bg-blue-50' : ''}>
                        <td className="px-3 py-1.5 font-medium">
                          {col.label}
                          {isMatchKey && <span className="ml-1.5 text-[10px] text-blue-600 bg-blue-100 px-1 rounded">匹配键</span>}
                        </td>
                        <td className="px-3 py-1.5 text-zinc-500">
                          {col.type === 'text' ? '文本' : col.type === 'number' ? '数字' : col.type === 'boolean' ? '是/否' : col.type === 'date' ? '日期' : col.type}
                        </td>
                        <td className="px-3 py-1.5 text-zinc-500">
                          {isMatchKey
                            ? '用于匹配已有记录（必填）'
                            : col.foreignKey
                              ? '填写名称则更新；留空保留原值'
                              : '填写则更新；留空保留原值'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
    </Dialog>
  )
}
