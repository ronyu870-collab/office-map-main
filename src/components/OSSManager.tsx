'use client';

import React, { useState, useEffect, useRef } from 'react';
import { logAction } from '@/src/utils/audit';
import { getSessionFast } from '@/src/services/Auth';
import { supabase } from '@/src/services/supabaseClient';
import { X, AlertTriangle, Edit2, Trash2, FolderPlus, Upload, Download, Check } from 'lucide-react';

type OSSItem = {
  name: string;
  type: 'folder' | 'file';
  shortName?: string;
  size?: string;
  lastModified?: string;
  url?: string;
};

// Modal 组件
function Modal({ 
  isOpen, 
  onClose, 
  title, 
  children, 
  danger = false 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  title: string; 
  children: React.ReactNode;
  danger?: boolean;
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div 
        className="bg-white rounded-lg shadow-2xl max-w-md w-full mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`px-6 py-4 border-b flex items-center justify-between ${danger ? 'bg-red-50 border-red-200' : 'bg-zinc-50 border-zinc-200'}`}>
          <h3 className={`text-lg font-semibold flex items-center gap-2 ${danger ? 'text-red-900' : 'text-zinc-900'}`}>
            {danger && <AlertTriangle className="w-5 h-5 text-red-600" />}
            {title}
          </h3>
          <button 
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6">
          {children}
        </div>
      </div>
    </div>
  );
}

export function OSSManager({ userEmail }: { userEmail: string }) {
  const [currentPrefix, setCurrentPrefix] = useState('');
  const [items, setItems] = useState<OSSItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [userRole, setUserRole] = useState<string>('viewer');
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  
  // Modal 状态
  const [showCreateFolderModal, setShowCreateFolderModal] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showBatchDeleteModal, setShowBatchDeleteModal] = useState(false);
  
  // 操作目标
  const [targetItem, setTargetItem] = useState<OSSItem | null>(null);
  const [newName, setNewName] = useState('');
  const [folderName, setFolderName] = useState('');
  const [operationInProgress, setOperationInProgress] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 新增：获取用户角色
  useEffect(() => {
    const fetchUserRole = async () => {
      try {
        const session = await getSessionFast();
        if (session?.role) {
          setUserRole(session.role);
        }
      } catch (err) {
        console.error('获取用户角色失败:', err);
      }
    };
    fetchUserRole();
  }, []);

  // 新增：检查是否为管理员
  const isAdmin = userRole === 'admin' || userRole === 'super_admin';

  // 加载目录内容
  const loadReports = async (prefix: string) => {
    setLoading(true);
    setCurrentPrefix(prefix);
    setSelectedItems(new Set()); // 切换目录时清空选择
    try {
      const res = await fetch(`/api/oss?action=get-list&prefix=${encodeURIComponent(prefix)}`);
      const result = await res.json();
      if (result.status === 'success') {
        setItems(result.data);
      }
    } catch (e) {
      console.error('获取OSS列表失败', e);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadReports('');
  }, []);

  // 新增：获取 Authorization header
  const getAuthHeader = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  };

  // 批量选择相关
  const toggleSelectItem = (itemName: string) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(itemName)) {
      newSelected.delete(itemName);
    } else {
      newSelected.add(itemName);
    }
    setSelectedItems(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedItems.size === items.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(items.map(item => item.name)));
    }
  };

  const clearSelection = () => {
    setSelectedItems(new Set());
  };

  // 返回上一级
  const goUp = () => {
    const parts = currentPrefix.split('/').filter(p => p);
    parts.pop();
    loadReports(parts.length > 0 ? parts.join('/') + '/' : '');
  };

  // 面包屑导航
  const renderBreadcrumb = () => {
    let bcHtml: React.ReactNode[] = [
      <span key="root" className="cursor-pointer font-semibold text-[#003e7e] hover:underline" onClick={() => loadReports('')}>🏠 根目录</span>
    ];
    if (currentPrefix) {
      const parts = currentPrefix.split('/').filter(p => p);
      let path = '';
      parts.forEach((p, i) => {
        path += p + '/';
        const currentPath = path; // 闭包捕获
        bcHtml.push(<span key={`sep-${i}`} className="mx-1 text-zinc-400">/</span>);
        bcHtml.push(
          <span key={p} className="cursor-pointer font-semibold text-[#003e7e] hover:underline" onClick={() => loadReports(currentPath)}>
            {p}
          </span>
        );
      });
    }
    return <div className="text-sm">{bcHtml}</div>;
  };

  // 新建文件夹（使用 Modal）
  const openCreateFolderModal = () => {
    if (!isAdmin) {
      alert("⚠️ 权限不足：只有管理员可以创建文件夹");
      return;
    }
    setFolderName('');
    setShowCreateFolderModal(true);
  };

  const handleCreateFolder = async () => {
    if (!folderName.trim()) {
      alert("请输入文件夹名称");
      return;
    }
    
    setOperationInProgress(true);
    try {
      const fullPath = `${currentPrefix}${folderName.trim()}/`;
      const authHeader = await getAuthHeader();
      
      const res = await fetch('/api/oss?action=create-folder', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...authHeader
        },
        body: JSON.stringify({ folder: fullPath })
      });
      const data = await res.json();
      
      if (res.status === 403) {
        alert("⚠️ 权限不足：" + data.message);
        return;
      }
      
      if (data.status === 'success') {
        logAction(userEmail, 'OSS_CREATE_FOLDER', { folderName: fullPath });
        setShowCreateFolderModal(false);
        loadReports(currentPrefix);
      } else {
        alert("创建失败: " + data.message);
      }
    } catch (e) {
      alert("请求异常，请检查网络。");
    } finally {
      setOperationInProgress(false);
    }
  };

  // 极速直传引擎
  const executeUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    // 前端权限检查
    if (!isAdmin) {
      alert("⚠️ 权限不足：只有管理员可以上传文件");
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    setUploading(true);
    try {
      const authHeader = await getAuthHeader();
      
      const signRes = await fetch('/api/oss?action=get-signature', {
        headers: authHeader
      });
      
      if (signRes.status === 403) {
        const data = await signRes.json();
        alert("⚠️ 权限不足：" + data.message);
        if (fileInputRef.current) fileInputRef.current.value = '';
        setUploading(false);
        return;
      }
      
      const signData = await signRes.json();
      if (signData.status !== 'success') throw new Error("获取上传签名失败");

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const formData = new FormData();
        const fullKey = `${currentPrefix}${file.name}`;
        
        formData.append('key', fullKey);
        formData.append('policy', signData.policy);
        formData.append('OSSAccessKeyId', signData.accessid); 
        formData.append('signature', signData.signature);
        formData.append('success_action_status', '200');
        formData.append('file', file);
        
        const uploadRes = await fetch(signData.host, { method: 'POST', body: formData });
        if (!uploadRes.ok) throw new Error("阿里云拒绝接收文件");
        
        logAction(userEmail, 'OSS_UPLOAD', { fileName: fullKey, size: file.size });
      }
      alert("✅ 上传成功！"); 
      if (fileInputRef.current) fileInputRef.current.value = ''; 
      loadReports(currentPrefix); 
    } catch (error: any) { 
      alert(`❌ 上传失败: ${error.message}`); 
    } finally { 
      setUploading(false); 
    }
  };

  // 删除单个文件（使用 Modal）
  const openDeleteModal = (item: OSSItem) => {
    if (!isAdmin) {
      alert("⚠️ 权限不足：只有管理员可以删除文件");
      return;
    }
    setTargetItem(item);
    setShowDeleteModal(true);
  };

  const handleDelete = async () => {
    if (!targetItem) return;
    
    setOperationInProgress(true);
    try {
      const authHeader = await getAuthHeader();
      
      const res = await fetch(`/api/oss?action=delete&file=${encodeURIComponent(targetItem.name)}`, { 
        method: 'POST',
        headers: authHeader
      });
      
      if (res.status === 403) {
        const data = await res.json();
        alert("⚠️ 权限不足：" + data.message);
        return;
      }
      
      const data = await res.json();
      
      if (data.status === 'success') {
        // 显示详细的删除结果
        if (data.stats && data.stats.total > 0) {
          alert(`✅ ${data.message}\n\n统计信息：\n- 总对象数：${data.stats.total}\n- 成功删除：${data.stats.success}\n- 失败：${data.stats.failed}`);
        }
        
        logAction(userEmail, 'OSS_DELETE', {
          fileName: targetItem.name,
          type: targetItem.type,
          stats: data.stats
        });
        setShowDeleteModal(false);
        loadReports(currentPrefix);
      } else {
        alert(`❌ 删除失败：${data.message}`);
      }
    } catch (e) {
      alert("删除失败，请检查网络。");
    } finally {
      setOperationInProgress(false);
    }
  };

  // 批量删除
  const openBatchDeleteModal = () => {
    if (!isAdmin) {
      alert("⚠️ 权限不足：只有管理员可以删除文件");
      return;
    }
    if (selectedItems.size === 0) {
      alert("请先选择要删除的文件");
      return;
    }
    setShowBatchDeleteModal(true);
  };

  const handleBatchDelete = async () => {
    if (selectedItems.size === 0) return;
    
    setOperationInProgress(true);
    try {
      const authHeader = await getAuthHeader();
      let successCount = 0;
      let failCount = 0;
      
      for (const itemName of Array.from(selectedItems)) {
        try {
          const res = await fetch(`/api/oss?action=delete&file=${encodeURIComponent(itemName)}`, { 
            method: 'POST',
            headers: authHeader
          });
          
          if (res.ok) {
            successCount++;
          } else {
            failCount++;
          }
        } catch (e) {
          failCount++;
        }
      }
      
      if (successCount > 0) {
        logAction(userEmail, 'OSS_BATCH_DELETE', { count: successCount });
      }
      setShowBatchDeleteModal(false);
      clearSelection();
      loadReports(currentPrefix);
      
      if (failCount > 0) {
        alert(`批量删除完成：成功 ${successCount} 个，失败 ${failCount} 个`);
      }
    } catch (e) {
      alert("批量删除失败，请检查网络。");
    } finally {
      setOperationInProgress(false);
    }
  };

  // 重命名/移动（使用 Modal）
  const openRenameModal = (item: OSSItem) => {
    if (!isAdmin) {
      alert("⚠️ 权限不足：只有管理员可以重命名文件");
      return;
    }
    setTargetItem(item);
    setNewName(item.name);
    setShowRenameModal(true);
  };

  const handleRename = async () => {
    if (!targetItem || !newName.trim() || newName === targetItem.name) {
      alert("请输入有效的新名称");
      return;
    }

    setOperationInProgress(true);
    try {
      const authHeader = await getAuthHeader();
      
      const res = await fetch('/api/oss?action=move', { 
        method: 'POST', 
        headers: { 
          'Content-Type': 'application/json',
          ...authHeader
        }, 
        body: JSON.stringify({ oldKey: targetItem.name, newKey: newName.trim() }) 
      });
      
      if (res.status === 403) {
        const data = await res.json();
        alert("⚠️ 权限不足：" + data.message);
        return;
      }
      
      const data = await res.json();
      if (data.status === 'success') {
        // 显示详细的重命名结果
        if (data.stats && data.stats.total > 0) {
          alert(`✅ ${data.message}\n\n统计信息：\n- 总对象数：${data.stats.total}\n- 已复制：${data.stats.copied}\n- 已删除：${data.stats.deleted}\n- 失败：${data.stats.failed}`);
        }
        
        logAction(userEmail, 'OSS_MOVE', {
          fileName: targetItem.name,
          targetPath: newName.trim(),
          stats: data.stats
        });
        setShowRenameModal(false);
        loadReports(currentPrefix); 
      } else {
        alert("重命名失败: " + (data.message || '未知错误'));
      }
    } catch (e) { 
      alert("请求异常，请检查网络。"); 
    } finally {
      setOperationInProgress(false);
    }
  };

  return (
    <>
      <div className="bg-white border border-zinc-200 rounded-lg shadow-sm overflow-hidden flex flex-col h-full w-full">
        {/* 顶部工具栏 */}
        <div className="bg-zinc-50 border-b border-zinc-200 px-4 py-3 flex items-center justify-between shrink-0">
          {renderBreadcrumb()}
          <div className="flex gap-2">
            {/* 只有管理员才能看到管理按钮 */}
            {isAdmin ? (
              <>
                {selectedItems.size > 0 && (
                  <button 
                    onClick={openBatchDeleteModal}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-red-600 rounded hover:bg-red-700 transition-colors flex items-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" />
                    删除选中 ({selectedItems.size})
                  </button>
                )}
                <button 
                  onClick={openCreateFolderModal} 
                  className="px-3 py-1.5 text-xs font-semibold text-[#003e7e] bg-white border border-[#003e7e] rounded hover:bg-blue-50 transition-colors flex items-center gap-1"
                >
                  <FolderPlus className="w-3 h-3" />
                  新建文件夹
                </button>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  multiple 
                  accept=".pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx" 
                  className="hidden" 
                  onChange={executeUpload} 
                />
                <button 
                  onClick={() => fileInputRef.current?.click()} 
                  disabled={uploading}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-[#003e7e] rounded hover:bg-[#002b5e] transition-colors disabled:opacity-50 flex items-center gap-1"
                >
                  <Upload className="w-3 h-3" />
                  {uploading ? '上传中...' : '上传文件'}
                </button>
              </>
            ) : (
              <div className="text-xs text-zinc-500 italic">
                仅查看模式（管理员可上传和管理文件）
              </div>
            )}
          </div>
        </div>

        {/* 文件列表 */}
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-white sticky top-0 z-10 border-b border-zinc-200">
              <tr>
                {isAdmin && (
                  <th className="px-4 py-3 w-10">
                    <input 
                      type="checkbox"
                      checked={items.length > 0 && selectedItems.size === items.length}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 text-[#003e7e] rounded border-zinc-300 focus:ring-[#003e7e]"
                    />
                  </th>
                )}
                <th className="px-4 py-3 font-semibold text-zinc-600 w-1/2">名称</th>
                <th className="px-4 py-3 font-semibold text-zinc-600">大小</th>
                <th className="px-4 py-3 font-semibold text-zinc-600">最后修改</th>
                <th className="px-4 py-3 font-semibold text-zinc-600 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {loading ? (
                <tr><td colSpan={isAdmin ? 5 : 4} className="px-4 py-8 text-center text-zinc-500">拉取目录中...</td></tr>
              ) : items.length === 0 ? (
                <>
                  {currentPrefix && (
                    <tr className="hover:bg-zinc-50 cursor-pointer" onClick={goUp}>
                      <td colSpan={isAdmin ? 5 : 4} className="px-4 py-3 font-semibold text-[#003e7e]">🔙 返回上层...</td>
                    </tr>
                  )}
                  <tr><td colSpan={isAdmin ? 5 : 4} className="px-4 py-8 text-center text-zinc-400">此文件夹为空</td></tr>
                </>
              ) : (
                <>
                  {currentPrefix && (
                    <tr className="hover:bg-zinc-50 cursor-pointer" onClick={goUp}>
                      <td colSpan={isAdmin ? 5 : 4} className="px-4 py-3 font-semibold text-[#003e7e]">🔙 返回上层...</td>
                    </tr>
                  )}
                  {items.map((item) => {
                    if (item.type === 'folder') {
                      const folderName = item.name.replace(currentPrefix, '').replace('/', '');
                      return (
                        <tr key={item.name} className="hover:bg-zinc-50">
                          {isAdmin && (
                            <td className="px-4 py-3">
                              <input 
                                type="checkbox"
                                checked={selectedItems.has(item.name)}
                                onChange={() => toggleSelectItem(item.name)}
                                onClick={(e) => e.stopPropagation()}
                                className="w-4 h-4 text-[#003e7e] rounded border-zinc-300 focus:ring-[#003e7e]"
                              />
                            </td>
                          )}
                          <td 
                            className="px-4 py-3 font-medium text-zinc-800 cursor-pointer" 
                            onClick={() => loadReports(item.name)}
                          >
                            📁 {folderName}
                          </td>
                          <td className="px-4 py-3 text-zinc-400">-</td>
                          <td className="px-4 py-3 text-zinc-400">-</td>
                          <td className="px-4 py-3 text-right">
                            {isAdmin && (
                              <button 
                                onClick={() => openDeleteModal(item)}
                                className="text-xs text-red-600 hover:underline inline-flex items-center gap-1"
                              >
                                <Trash2 className="w-3 h-3" />
                                删除
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    } else {
                      const dateStr = item.lastModified ? item.lastModified.split('T')[0] : '-';
                      return (
                        <tr key={item.name} className="hover:bg-zinc-50">
                          {isAdmin && (
                            <td className="px-4 py-3">
                              <input 
                                type="checkbox"
                                checked={selectedItems.has(item.name)}
                                onChange={() => toggleSelectItem(item.name)}
                                className="w-4 h-4 text-[#003e7e] rounded border-zinc-300 focus:ring-[#003e7e]"
                              />
                            </td>
                          )}
                          <td className="px-4 py-3 text-[#003e7e] font-medium truncate max-w-xs" title={item.shortName}>
                            📄 {item.shortName}
                          </td>
                          <td className="px-4 py-3 text-zinc-500 text-xs">{item.size}</td>
                          <td className="px-4 py-3 text-zinc-500 text-xs">{dateStr}</td>
                          <td className="px-4 py-3 text-right">
                            <button 
                              onClick={() => window.open(item.url, '_blank')} 
                              className="text-xs text-[#003e7e] hover:underline mr-3 inline-flex items-center gap-1"
                            >
                              <Download className="w-3 h-3" />
                              下载
                            </button>
                            {isAdmin && (
                              <>
                                <button 
                                  onClick={() => openRenameModal(item)} 
                                  className="text-xs text-[#003e7e] hover:underline mr-3 inline-flex items-center gap-1"
                                >
                                  <Edit2 className="w-3 h-3" />
                                  重命名
                                </button>
                                <button 
                                  onClick={() => openDeleteModal(item)} 
                                  className="text-xs text-red-600 hover:underline inline-flex items-center gap-1"
                                >
                                  <Trash2 className="w-3 h-3" />
                                  删除
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    }
                  })}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 新建文件夹 Modal */}
      <Modal 
        isOpen={showCreateFolderModal} 
        onClose={() => setShowCreateFolderModal(false)}
        title="新建文件夹"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-2">
              文件夹名称
            </label>
            <input
              type="text"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="例如：一线城市 或 2026Q1"
              className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-[#003e7e] focus:border-transparent"
              onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
              autoFocus
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setShowCreateFolderModal(false)}
              className="px-4 py-2 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-lg hover:bg-zinc-50 transition-colors"
              disabled={operationInProgress}
            >
              取消
            </button>
            <button
              onClick={handleCreateFolder}
              disabled={operationInProgress || !folderName.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-[#003e7e] rounded-lg hover:bg-[#002b5e] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {operationInProgress ? '创建中...' : '创建'}
            </button>
          </div>
        </div>
      </Modal>

      {/* 重命名 Modal */}
      <Modal 
        isOpen={showRenameModal} 
        onClose={() => setShowRenameModal(false)}
        title={`重命名${targetItem?.type === 'folder' ? '文件夹' : '文件'}`}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-2">
              新名称
            </label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-[#003e7e] focus:border-transparent font-mono text-sm"
              onKeyDown={(e) => e.key === 'Enter' && handleRename()}
              autoFocus
            />
            <div className="mt-2 space-y-1">
              <p className="text-xs text-zinc-500">
                💡 提示：修改路径可以移动文件到其他文件夹
              </p>
              {targetItem?.type === 'folder' && (
                <p className="text-xs text-blue-600">
                  📁 文件夹重命名会递归处理所有子对象（复制到新位置后删除旧对象）
                </p>
              )}
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setShowRenameModal(false)}
              className="px-4 py-2 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-lg hover:bg-zinc-50 transition-colors"
              disabled={operationInProgress}
            >
              取消
            </button>
            <button
              onClick={handleRename}
              disabled={operationInProgress || !newName.trim() || newName === targetItem?.name}
              className="px-4 py-2 text-sm font-medium text-white bg-[#003e7e] rounded-lg hover:bg-[#002b5e] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {operationInProgress ? '处理中...' : '确认'}
            </button>
          </div>
        </div>
      </Modal>

      {/* 删除确认 Modal */}
      <Modal 
        isOpen={showDeleteModal} 
        onClose={() => setShowDeleteModal(false)}
        title="确认删除"
        danger
      >
        <div className="space-y-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-sm text-red-900">
              确定要删除以下{targetItem?.type === 'folder' ? '文件夹' : '文件'}吗？
            </p>
            <p className="mt-2 text-sm font-mono text-red-700 break-all">
              {targetItem?.type === 'folder' 
                ? targetItem.name.replace(currentPrefix, '').replace('/', '')
                : targetItem?.shortName}
            </p>
            {targetItem?.type === 'folder' && (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-red-600 font-semibold">
                  ⚠️ 警告：删除文件夹将递归删除其中的所有文件和子文件夹！
                </p>
                <p className="text-xs text-red-600">
                  • 系统会自动列出文件夹下的所有对象<br/>
                  • 批量删除所有子文件和子文件夹<br/>
                  • 最后删除文件夹本身<br/>
                  • 操作完成后会显示详细统计信息
                </p>
              </div>
            )}
          </div>
          <p className="text-sm text-zinc-600">
            此操作无法撤销，请谨慎操作。
          </p>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setShowDeleteModal(false)}
              className="px-4 py-2 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-lg hover:bg-zinc-50 transition-colors"
              disabled={operationInProgress}
            >
              取消
            </button>
            <button
              onClick={handleDelete}
              disabled={operationInProgress}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              {operationInProgress ? '删除中...' : '确认删除'}
            </button>
          </div>
        </div>
      </Modal>

      {/* 批量删除确认 Modal */}
      <Modal 
        isOpen={showBatchDeleteModal} 
        onClose={() => setShowBatchDeleteModal(false)}
        title="批量删除确认"
        danger
      >
        <div className="space-y-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-sm text-red-900 font-semibold">
              确定要删除选中的 {selectedItems.size} 个项目吗？
            </p>
            <div className="mt-3 max-h-40 overflow-y-auto space-y-1">
              {Array.from(selectedItems).map(itemName => {
                const item = items.find(i => i.name === itemName);
                return (
                  <div key={itemName} className="text-xs font-mono text-red-700 flex items-center gap-2">
                    <Check className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">
                      {item?.type === 'folder' ? '📁' : '📄'} {item?.shortName || itemName}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          <p className="text-sm text-zinc-600">
            此操作无法撤销，请谨慎操作。
          </p>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setShowBatchDeleteModal(false)}
              className="px-4 py-2 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-lg hover:bg-zinc-50 transition-colors"
              disabled={operationInProgress}
            >
              取消
            </button>
            <button
              onClick={handleBatchDelete}
              disabled={operationInProgress}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              {operationInProgress ? '删除中...' : `删除 ${selectedItems.size} 项`}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}