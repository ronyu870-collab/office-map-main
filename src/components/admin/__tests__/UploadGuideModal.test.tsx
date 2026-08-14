import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { UploadGuideModal } from '../grid/modals/UploadGuideModal'
import type { TableConfig } from '../types'

const config: TableConfig = {
  table: 'buildings',
  label: '存量项目基础信息',
  uploadMatchKeys: ['name'],
  uploadDescription: '按项目名称匹配。',
  cols: [
    { key: 'name', label: '项目名称', type: 'text', required: true },
    { key: 'submarket', label: '子市场', type: 'text' },
    { key: 'owner', label: '业主', type: 'text' },
  ],
}

describe('UploadGuideModal', () => {
  it('向管理员明确展示填写、留空和清空三条规则', () => {
    render(<UploadGuideModal config={config} onClose={vi.fn()} />)

    expect(screen.getByText('填写内容')).toBeInTheDocument()
    expect(screen.getByText('更新该字段')).toBeInTheDocument()
    expect(screen.getByText('保持留空')).toBeInTheDocument()
    expect(screen.getByText('保留数据库原值')).toBeInTheDocument()
    expect(screen.getByText('需要清空')).toBeInTheDocument()
    expect(screen.getByText('请在表格中单条编辑')).toBeInTheDocument()
  })

  it('不再将已有记录描述为整行覆盖', () => {
    render(<UploadGuideModal config={config} onClose={vi.fn()} />)

    expect(screen.getByText(/只更新这一行中/)).toBeInTheDocument()
    expect(screen.queryByText(/覆盖更新该行所有数据/)).not.toBeInTheDocument()
  })
})
