'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/src/services/supabaseClient';
import { useImpersonation } from '@/src/contexts/ImpersonationContext';

interface UserEntry {
  user_id: string;
  email: string;
  chinese_name: string | null;
  full_name: string | null;
  role: string;
}

export function ImpersonationPanel() {
  const [users, setUsers] = useState<UserEntry[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const { startImpersonation } = useImpersonation();

  useEffect(() => {
    // 获取当前用户 ID（用于排除自己）
    supabase.auth.getUser().then(({ data: { user } }) => {
      setCurrentUserId(user?.id || null);
    });

    supabase
      .from('user_roles')
      .select('user_id, email, chinese_name, full_name, role')
      .order('chinese_name')
      .then(({ data }) => {
        if (data) setUsers(data);
        setLoading(false);
      });
  }, []);

  const filtered = users.filter((u) => {
    // 排除当前登录用户（不能模拟自己）
    if (u.user_id === currentUserId) return false;
    const q = search.toLowerCase();
    return (
      (u.chinese_name || '').toLowerCase().includes(q) ||
      (u.full_name || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q)
    );
  });

  const handleSelect = async (user: UserEntry) => {
    const confirmed = window.confirm(
      `确定要模拟 ${user.chinese_name || user.full_name || user.email} 吗？\n\n模拟期间将以该用户身份浏览所有页面，所有操作为只读。`
    );
    if (confirmed) {
      await startImpersonation(user.user_id);
    }
  };

  return (
    <div className="flex flex-col h-full p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-zinc-900">用户模拟</h2>
        <p className="text-sm text-zinc-500 mt-1">
          选择一个用户进入模拟模式。模拟期间将以该用户身份浏览所有页面，所有操作为只读，不会记录任何行为。
        </p>
      </div>

      <div className="relative mb-4">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          type="text"
          placeholder="搜索姓名或邮箱..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-zinc-300 pl-10 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#003e7e]/20 focus:border-[#003e7e]"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#003e7e] border-t-transparent" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto rounded-lg border border-zinc-200">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 sticky top-0">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium text-zinc-500">姓名</th>
                <th className="text-left px-4 py-2.5 font-medium text-zinc-500">邮箱</th>
                <th className="text-left px-4 py-2.5 font-medium text-zinc-500">角色</th>
                <th className="text-right px-4 py-2.5 font-medium text-zinc-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filtered.map((u) => (
                <tr key={u.user_id} className="hover:bg-zinc-50 transition-colors">
                  <td className="px-4 py-2.5 text-zinc-900 font-medium">
                    {u.chinese_name || u.full_name || '—'}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-500">{u.email}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        u.role === 'admin'
                          ? 'bg-purple-100 text-purple-700'
                          : u.role === 'editor'
                          ? 'bg-blue-100 text-blue-700'
                          : u.role === 'executive'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-zinc-100 text-zinc-600'
                      }`}
                    >
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => handleSelect(u)}
                      className="text-xs text-[#003e7e] hover:text-[#003e7e]/80 font-medium hover:underline"
                    >
                      模拟此用户
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-zinc-400 text-sm">
                    没有找到匹配的用户
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 text-xs text-zinc-400">
        共 {users.length} 个用户，当前显示 {filtered.length} 个
      </div>
    </div>
  );
}
