'use client';

import * as React from 'react';
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
    <div className="flex-1 overflow-auto p-6">
      <div className="mx-auto max-w-6xl">
        {/* 页面标题 */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900">显示覆盖规则</h1>
            <p className="mt-1 text-sm text-zinc-500">
              配置特殊楼宇的弹窗显示规则，例如将"子市场：其他"替换为"行政区：朝阳区-双井"
            </p>
          </div>
          <button
            onClick={handleAdd}
            className="flex items-center gap-2 rounded-lg bg-[#003e7e] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#002d5e] focus:outline-none focus:ring-2 focus:ring-[#003e7e] focus:ring-offset-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            新增规则
          </button>
        </div>

        {/* 搜索栏 */}
        <div className="mb-4">
          <input
            type="text"
            placeholder="搜索楼宇名称、字段、标签或值..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-zinc-200 px-4 py-2.5 text-sm focus:border-[#003e7e] focus:outline-none focus:ring-1 focus:ring-[#003e7e]"
          />
        </div>

        {/* 表格 */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#003e7e] border-t-transparent" />
          </div>
        ) : filteredOverrides.length === 0 ? (
          <div className="rounded-lg border border-zinc-200 bg-white py-20 text-center">
            <p className="text-sm text-zinc-500">暂无覆盖规则</p>
            <button
              onClick={handleAdd}
              className="mt-4 text-sm font-semibold text-[#003e7e] hover:underline"
            >
              添加第一条规则
            </button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50">
                <tr>
                  <th className="px-4 py-3 font-semibold text-zinc-700">楼宇名称</th>
                  <th className="px-4 py-3 font-semibold text-zinc-700">覆盖字段</th>
                  <th className="px-4 py-3 font-semibold text-zinc-700">显示标签</th>
                  <th className="px-4 py-3 font-semibold text-zinc-700">显示值</th>
                  <th className="px-4 py-3 font-semibold text-zinc-700">创建时间</th>
                  <th className="px-4 py-3 font-semibold text-zinc-700 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {filteredOverrides.map((override) => (
                  <tr key={override.id} className="hover:bg-zinc-50">
                    <td className="px-4 py-3 font-medium text-zinc-900">{override.building_name}</td>
                    <td className="px-4 py-3 text-zinc-600">
                      <span className="inline-block rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium">
                        {override.field_name === 'submarket' ? '子市场' : '楼宇等级'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-600">{override.display_label}</td>
                    <td className="px-4 py-3 font-semibold text-[#003e7e]">{override.display_value}</td>
                    <td className="px-4 py-3 text-zinc-500 text-xs">
                      {new Date(override.created_at).toLocaleDateString('zh-CN')}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleEdit(override)}
                        className="mr-2 text-xs font-semibold text-[#003e7e] hover:underline"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => handleDelete(override.id)}
                        className="text-xs font-semibold text-red-600 hover:underline"
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 模态框 */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-bold text-zinc-900">
              {editingOverride ? '编辑覆盖规则' : '新增覆盖规则'}
            </h2>

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
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-[#003e7e] focus:outline-none focus:ring-1 focus:ring-[#003e7e] disabled:bg-zinc-100"
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
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-[#003e7e] focus:outline-none focus:ring-1 focus:ring-[#003e7e] disabled:bg-zinc-100"
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
                <input
                  type="text"
                  value={displayLabel}
                  onChange={(e) => setDisplayLabel(e.target.value)}
                  placeholder="例如：行政区、市场分类"
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-[#003e7e] focus:outline-none focus:ring-1 focus:ring-[#003e7e]"
                />
              </div>

              {/* 显示值 */}
              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-700">
                  显示值 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={displayValue}
                  onChange={(e) => setDisplayValue(e.target.value)}
                  placeholder="例如：朝阳区-双井、产业园"
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-[#003e7e] focus:outline-none focus:ring-1 focus:ring-[#003e7e]"
                />
              </div>
            </div>

            {/* 操作按钮 */}
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                className="rounded-lg bg-[#003e7e] px-4 py-2 text-sm font-semibold text-white hover:bg-[#002d5e]"
              >
                {editingOverride ? '保存' : '新增'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
