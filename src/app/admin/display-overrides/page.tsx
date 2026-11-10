'use client';

import * as React from 'react';
import { Menu, Plus } from 'lucide-react';

import { AdminSidebar } from '@/src/components/admin/AdminSidebar';
import { Badge, Button, Dialog, EmptyState, IconButton, Input, LoadingState, PageHeader } from '@/src/components/ui';
import { DISPLAY_OVERRIDE_LIST_FIELDS } from '@/src/services/displayOverrideFields.mjs';
import { supabase } from '@/src/services/supabaseClient';

interface DisplayOverride {
  id: string;
  building_id: string;
  field_name: string;
  display_label: string;
  display_value: string;
  created_at: string;
  building: { name: string } | null;
}

function buildingName(override: DisplayOverride) {
  return override.building?.name || '未知楼宇';
}

interface Building {
  id: string;
  name: string;
}

export default function DisplayOverridesPage() {
  const [overrides, setOverrides] = React.useState<DisplayOverride[]>([]);
  const [buildings, setBuildings] = React.useState<Building[]>([]);
  const [listStatus, setListStatus] = React.useState<'loading' | 'ready' | 'error'>('loading');
  const activeList = React.useRef<AbortController | null>(null);
  const [pickerStatus, setPickerStatus] = React.useState<'loading' | 'ready' | 'error'>('loading');
  const [pickerAttempt, retryPicker] = React.useReducer(attempt => attempt + 1, 0);
  const [showModal, setShowModal] = React.useState(false);
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const [editingOverride, setEditingOverride] = React.useState<DisplayOverride | null>(null);

  // 表单状态
  const [selectedBuildingId, setSelectedBuildingId] = React.useState('');
  const [selectedFieldName, setSelectedFieldName] = React.useState('submarket');
  const [displayLabel, setDisplayLabel] = React.useState('');
  const [displayValue, setDisplayValue] = React.useState('');
  const [searchTerm, setSearchTerm] = React.useState('');

  const fetchData = React.useCallback(async () => {
    activeList.current?.abort();
    const request = new AbortController();
    activeList.current = request;
    try {
      const { data, error } = await supabase
        .from('building_display_overrides')
        .select(DISPLAY_OVERRIDE_LIST_FIELDS)
        .order('created_at', { ascending: false })
        .abortSignal(request.signal)
        .returns<DisplayOverride[]>();
      if (request.signal.aborted) return;
      if (error) throw error;
      setOverrides(data ?? []);
      setListStatus('ready');
    } catch {
      if (!request.signal.aborted) setListStatus('error');
    }
  }, []);

  React.useEffect(() => {
    void fetchData();
    return () => {
      activeList.current?.abort();
      activeList.current = null;
    };
  }, [fetchData]);

  const refreshList = () => {
    if (!activeList.current) return;
    setListStatus('loading');
    void fetchData();
  };

  React.useEffect(() => {
    if (!showModal || editingOverride) return;
    const request = new AbortController();
    async function loadPicker() {
      try {
        const { data, error } = await supabase
          .from('buildings')
          .select('id, name')
          .eq('is_active', true)
          .eq('tracking_scope', 'tracked')
          .order('name')
          .abortSignal(request.signal);
        if (request.signal.aborted) return;
        if (error) throw error;
        setBuildings(data ?? []);
        setPickerStatus('ready');
      } catch {
        if (!request.signal.aborted) setPickerStatus('error');
      }
    }
    void loadPicker();
    return () => request.abort();
  }, [showModal, editingOverride, pickerAttempt]);

  // 打开新增模态框
  const handleAdd = () => {
    setEditingOverride(null);
    setBuildings([]);
    setPickerStatus('loading');
    setSelectedBuildingId('');
    setSelectedFieldName('submarket');
    setDisplayLabel('');
    setDisplayValue('');
    setShowModal(true);
  };

  // 打开编辑模态框
  const handleEdit = (override: DisplayOverride) => {
    setEditingOverride(override);
    setSelectedBuildingId(override.building_id);
    setSelectedFieldName(override.field_name);
    setDisplayLabel(override.display_label);
    setDisplayValue(override.display_value);
    setShowModal(true);
  };

  // 保存（新增/编辑）
  const handleSave = async () => {
    if (!editingOverride && (pickerStatus !== 'ready' || !buildings.some(building => building.id === selectedBuildingId))) return;
    if (!selectedBuildingId || !displayLabel || !displayValue) {
      alert('请填写所有必填字段');
      return;
    }

    try {
      if (editingOverride) {
        // 编辑
        const { error } = await supabase
          .from('building_display_overrides')
          .update({
            field_name: selectedFieldName,
            display_label: displayLabel,
            display_value: displayValue,
          })
          .eq('id', editingOverride.id);

        if (error) throw error;
      } else {
        // 新增
        const { error } = await supabase
          .from('building_display_overrides')
          .insert({
            building_id: selectedBuildingId,
            field_name: selectedFieldName,
            display_label: displayLabel,
            display_value: displayValue,
          });

        if (error) throw error;
      }

      setShowModal(false);
      refreshList();
    } catch (error: any) {
      console.error('保存失败:', error);
      if (error.code === '23505') {
        alert('该楼宇的此字段已有覆盖规则，请勿重复添加');
      } else {
        alert(`保存失败: ${error.message}`);
      }
    }
  };

  // 删除
  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这条覆盖规则吗？')) return;

    try {
      const { error } = await supabase
        .from('building_display_overrides')
        .delete()
        .eq('id', id);

      if (error) throw error;
      refreshList();
    } catch (error: any) {
      console.error('删除失败:', error);
      alert(`删除失败: ${error.message}`);
    }
  };

  // 过滤后的列表
  const filteredOverrides = overrides.filter(o => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      buildingName(o).toLowerCase().includes(term) ||
      o.field_name.toLowerCase().includes(term) ||
      o.display_label.toLowerCase().includes(term) ||
      o.display_value.toLowerCase().includes(term)
    );
  });

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden">
      <AdminSidebar active="display-overrides" mobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)} />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--cd-color-canvas)]">
        <div className="flex h-10 shrink-0 items-center border-b border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-3 lg:hidden">
          <IconButton label="打开管理导航" variant="ghost" size="sm" onClick={() => setMobileNavOpen(true)}><Menu size={16} /></IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
          <div className="mx-auto max-w-6xl">
            <PageHeader
              title="显示覆盖规则"
              description="配置楼宇弹窗中的字段显示。"
              actions={<Button onClick={handleAdd}><Plus size={15} />新增规则</Button>}
              className="mb-4"
            />

        {/* 搜索栏 */}
        <div className="mb-4">
          <Input
            type="text"
            placeholder="搜索楼宇名称、字段、标签或值"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        {/* 表格 */}
        {listStatus === 'loading' ? (
          <LoadingState label="正在加载显示覆盖规则" />
        ) : listStatus === 'error' ? (
          <EmptyState title="显示覆盖规则加载失败" action={<Button variant="secondary" onClick={refreshList}>重试列表</Button>} />
        ) : filteredOverrides.length === 0 ? (
          <EmptyState title="暂无覆盖规则" action={<Button variant="secondary" onClick={handleAdd}>添加第一条规则</Button>} />
        ) : (
          <div className="overflow-x-auto rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)]">
            <table className="w-full min-w-[760px] text-left text-[var(--cd-font-size-sm)]">
              <thead className="border-b border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)]">
                <tr>
                  <th className="px-4 py-2.5 font-medium text-[var(--cd-color-text-secondary)]">楼宇名称</th>
                  <th className="px-4 py-2.5 font-medium text-[var(--cd-color-text-secondary)]">覆盖字段</th>
                  <th className="px-4 py-2.5 font-medium text-[var(--cd-color-text-secondary)]">显示标签</th>
                  <th className="px-4 py-2.5 font-medium text-[var(--cd-color-text-secondary)]">显示值</th>
                  <th className="px-4 py-2.5 font-medium text-[var(--cd-color-text-secondary)]">创建时间</th>
                  <th className="px-4 py-2.5 text-right font-medium text-[var(--cd-color-text-secondary)]">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {filteredOverrides.map((override) => (
                  <tr key={override.id} className="hover:bg-zinc-50">
                    <td className="px-4 py-3 font-medium text-zinc-900">{buildingName(override)}</td>
                    <td className="px-4 py-3 text-zinc-600">
                      <Badge>
                        {override.field_name === 'submarket' ? '子市场' : '楼宇等级'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-zinc-600">{override.display_label}</td>
                    <td className="px-4 py-3 font-semibold text-[#003e7e]">{override.display_value}</td>
                    <td className="px-4 py-3 text-zinc-500 text-xs">
                      {new Date(override.created_at).toLocaleDateString('zh-CN')}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="ghost" size="sm" onClick={() => handleEdit(override)} className="mr-1">编辑</Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(override.id)} className="text-[var(--cd-color-danger)]">删除</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
          </div>
        </div>
      </main>

      {/* 模态框 */}
      <Dialog
        open={showModal}
        onOpenChange={setShowModal}
        title={editingOverride ? '编辑覆盖规则' : '新增覆盖规则'}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setShowModal(false)}>取消</Button>
            <Button disabled={!editingOverride && (pickerStatus !== 'ready' || !selectedBuildingId)} onClick={() => void handleSave()}>{editingOverride ? '保存' : '新增'}</Button>
          </>
        )}
      >
        <div className="space-y-4">
              {/* 楼宇选择 */}
              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-700">
                  楼宇 <span className="text-red-500">*</span>
                </label>
                <select
                  value={selectedBuildingId}
                  onChange={(e) => setSelectedBuildingId(e.target.value)}
                  disabled={!!editingOverride || pickerStatus !== 'ready'}
                  className="h-9 w-full rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-3 text-[var(--cd-font-size-md)] text-[var(--cd-color-text-primary)] outline-none focus:border-[var(--cd-color-brand)] focus:ring-2 focus:ring-[var(--cd-color-focus)] disabled:bg-[var(--cd-color-surface-alt)]"
                >
                  {editingOverride ? (
                    <option value={editingOverride.building_id}>{buildingName(editingOverride)}</option>
                  ) : (
                    <>
                      <option value="">请选择楼宇</option>
                      {buildings.map((b) => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </>
                  )}
                </select>
                {!editingOverride && pickerStatus === 'loading' && <p role="status" className="mt-2 text-xs">正在加载可选楼宇</p>}
                {!editingOverride && pickerStatus === 'error' && (
                  <div className="mt-2 flex items-center gap-2">
                    <span role="alert" className="text-xs">可选楼宇加载失败</span>
                    <Button variant="secondary" size="sm" onClick={() => { setPickerStatus('loading'); retryPicker(); }}>重试楼宇</Button>
                  </div>
                )}
              </div>

              {/* 字段选择 */}
              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-700">
                  覆盖字段 <span className="text-red-500">*</span>
                </label>
                <select
                  value={selectedFieldName}
                  onChange={(e) => {
                    setSelectedFieldName(e.target.value);
                    if (!editingOverride) {
                      setDisplayLabel(e.target.value === 'submarket' ? '行政区' : '市场分类');
                    }
                  }}
                  disabled={!!editingOverride}
                  className="h-9 w-full rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-3 text-[var(--cd-font-size-md)] text-[var(--cd-color-text-primary)] outline-none focus:border-[var(--cd-color-brand)] focus:ring-2 focus:ring-[var(--cd-color-focus)] disabled:bg-[var(--cd-color-surface-alt)]"
                >
                  <option value="submarket">子市场</option>
                  <option value="grade">楼宇等级</option>
                </select>
              </div>

              {/* 显示标签 */}
              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-700">
                  显示标签 <span className="text-red-500">*</span>
                </label>
                <Input
                  type="text"
                  value={displayLabel}
                  onChange={(e) => setDisplayLabel(e.target.value)}
                  placeholder="例如：行政区、市场分类"
                />
              </div>

              {/* 显示值 */}
              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-700">
                  显示值 <span className="text-red-500">*</span>
                </label>
                <Input
                  type="text"
                  value={displayValue}
                  onChange={(e) => setDisplayValue(e.target.value)}
                  placeholder="例如：朝阳区-双井、产业园"
                />
              </div>
        </div>
      </Dialog>
    </div>
  );
}
