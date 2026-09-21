'use client';

import * as React from 'react';
import { Menu, Plus } from 'lucide-react';

import { AdminSidebar } from '@/src/components/admin/AdminSidebar';
import { Badge, Button, Dialog, EmptyState, IconButton, Input, LoadingState, PageHeader } from '@/src/components/ui';
import { supabase } from '@/src/services/supabaseClient';

interface DisplayOverride {
  id: string;
  building_id: string;
  field_name: string;
  display_label: string;
  display_value: string;
  created_at: string;
  updated_at: string;
  building_name?: string;
}

interface Building {
  id: string;
  name: string;
}

export default function DisplayOverridesPage() {
  const [overrides, setOverrides] = React.useState<DisplayOverride[]>([]);
  const [buildings, setBuildings] = React.useState<Building[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [showModal, setShowModal] = React.useState(false);
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const [editingOverride, setEditingOverride] = React.useState<DisplayOverride | null>(null);

  // 表单状态
  const [selectedBuildingId, setSelectedBuildingId] = React.useState('');
  const [selectedFieldName, setSelectedFieldName] = React.useState('submarket');
  const [displayLabel, setDisplayLabel] = React.useState('');
  const [displayValue, setDisplayValue] = React.useState('');
  const [searchTerm, setSearchTerm] = React.useState('');

  // 加载数据
  const fetchData = React.useCallback(async () => {
    setLoading(true);
    try {
      // 并行查询覆盖规则和楼宇列表
      const [overridesResult, buildingsResult] = await Promise.all([
        supabase
          .from('building_display_overrides')
          .select('*')
          .order('created_at', { ascending: false }),
        supabase
          .from('buildings')
          .select('id, name')
          .eq('is_active', true)
          .eq('tracking_scope', 'tracked')
          .order('name'),
      ]);

      if (overridesResult.data) {
        // 获取楼宇名称
        const buildingIds = Array.from(new Set(overridesResult.data.map(o => o.building_id)));
        const { data: buildingsData } = await supabase
          .from('buildings')
          .select('id, name')
          .in('id', buildingIds);

        const buildingMap = new Map(buildingsData?.map(b => [b.id, b.name]) || []);
        const enrichedOverrides = overridesResult.data.map(o => ({
          ...o,
          building_name: buildingMap.get(o.building_id) || '未知楼宇',
        }));
        setOverrides(enrichedOverrides);
      }

      if (buildingsResult.data) {
        setBuildings(buildingsResult.data);
      }
    } catch (error) {
      console.error('加载数据失败:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 打开新增模态框
  const handleAdd = () => {
    setEditingOverride(null);
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
      fetchData();
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
      fetchData();
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
      o.building_name?.toLowerCase().includes(term) ||
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
        {loading ? (
          <LoadingState label="正在加载显示覆盖规则" />
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
                    <td className="px-4 py-3 font-medium text-zinc-900">{override.building_name}</td>
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
            <Button onClick={() => void handleSave()}>{editingOverride ? '保存' : '新增'}</Button>
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
                  disabled={!!editingOverride}
                  className="h-9 w-full rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-3 text-[var(--cd-font-size-md)] text-[var(--cd-color-text-primary)] outline-none focus:border-[var(--cd-color-brand)] focus:ring-2 focus:ring-[var(--cd-color-focus)] disabled:bg-[var(--cd-color-surface-alt)]"
                >
                  <option value="">请选择楼宇</option>
                  {buildings.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
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
