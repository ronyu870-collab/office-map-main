'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { getSession, getSessionFast } from '@/src/services/Auth';
import { supabase } from '@/src/services/supabaseClient';
import { logAction } from '@/src/utils/audit';
import { useBuildings } from '@/src/hooks/useBuildings';
import { useImpersonation } from '@/src/contexts/ImpersonationContext';
import { handleDataFetchError } from '@/src/utils/errorHandler';
import { retryAsync } from '@/src/utils/retryAsync';

// 子市场排序配置（与 BuildingSortManager 保持一致）
const SUBMARKET_ORDER: Record<string, string[]> = {
  GradeA: ['CBD', '东城商务区', '金融街', '燕莎', '中关村', '望京-酒仙桥', '亚奥', '丽泽', '其他', '通州'],
  GradeB: ['CBD', '东城商务区', '金融街', '燕莎', '中关村', '望京-酒仙桥', '亚奥', '其他'],
  BP: ['望京-酒仙桥', '丰台科技园', '上地', '亦庄', '北清路', '通惠河传媒走廊', '其他'],
};

// ---------------------
// 万能表头匹配器 (复刻 V1)
// ---------------------
function getVal(item: any, keys: string[]) {
  if (!item) return '';
  for (let k of keys) {
    if (item[k] !== undefined) return item[k];
  }
  const itemKeys = Object.keys(item);
  for (let k of keys) {
    const match = itemKeys.find(ik => ik.replace(/\s+/g, '').toLowerCase() === k.replace(/\s+/g, '').toLowerCase());
    if (match) return item[match];
  }
  return '';
}

const safeNum = (val: any) => {
  if (val === '' || val === undefined || val === null) return 0;
  if (String(val).includes('%')) return parseFloat(val) / 100;
  return parseFloat(val) || 0;
};

export default function UpdatePage() {
  return (
    <React.Suspense fallback={<div className="flex items-center justify-center h-screen"><div className="h-8 w-8 animate-spin rounded-full border-2 border-[#003e7e] border-t-transparent" /></div>}>
      <UpdatePageInner />
    </React.Suspense>
  );
}

function UpdatePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const previewAsUserId = searchParams.get('as');
  const [ready, setReady] = React.useState(false);
  const [currentUser, setCurrentUser] = React.useState<any>(null);
  const [matchName, setMatchName] = React.useState('');
  const [draftUserName, setDraftUserName] = React.useState(''); // 草稿加载用的用户名（预览模式下为目标用户）
  const [isPreview, setIsPreview] = React.useState(false);
  const [previewUserName, setPreviewUserName] = React.useState('');
  const [currentSubmissionLabel, setCurrentSubmissionLabel] = React.useState('');

  const [currentTab, setCurrentTab] = React.useState('GradeA');
  const [draftStatus, setDraftStatus] = React.useState('');

  // 草稿数据状态：{[id]: { qOwner, qPropMan, qQuote, qProp, qFace, qFree, qVacArea, qRemark }}
  const [draftData, setDraftData] = React.useState<Record<string, any>>({});

  const [showModal, setShowModal] = React.useState(false);
  const [modalText, setModalText] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  // 未来供应分配数据
  const [futureSupplyAssignments, setFutureSupplyAssignments] = React.useState<any[]>([]);
  const [futureSupplyData, setFutureSupplyData] = React.useState<Record<string, any>>({});
  const [futureSupplyDrafts, setFutureSupplyDrafts] = React.useState<Record<string, any>>({});


  // 分配给当前用户的楼宇（来自 building_assignments）
  // null = 尚未加载，[] = 已加载但无分配，[...] = 已加载有分配
  const [assignedBuildingIds, setAssignedBuildingIds] = React.useState<string[] | null>(null);

  // 模拟模式
  const { isImpersonating } = useImpersonation();
  const [assignmentsError, setAssignmentsError] = React.useState<string | null>(null);
  const [assignmentsRetryKey, setAssignmentsRetryKey] = React.useState(0);

  // 🚨 数据保护：保存上一次成功加载的 buildings 数据
  const lastSuccessfulBuildings = React.useRef<any[] | null>(null);

  // 本季度填报的年份和季度
  const now = new Date();
  const defaultQuarter = Math.ceil((now.getMonth() + 1) / 3);
  const [submitYear, setSubmitYear] = React.useState<number>(now.getFullYear());
  const [submitQuarter, setSubmitQuarter] = React.useState<number>(defaultQuarter);

  // building_metrics 数据：{ [building_id]: BuildingMetric[] }（按年季降序）
  const [metricsMap, setMetricsMap] = React.useState<Record<string, any[]>>({});

  // 使用 useBuildings Hook 获取楼宇数据（不再按 ownerUser 过滤，改由 building_assignments 控制）
  // ✅ 性能优化：使用缓存数据，避免每次挂载都重新验证
  const { buildings, isLoading: buildingsLoading, error: buildingsError, mutate } = useBuildings({
    revalidateOnMount: true,
  });

  // 🚨 数据保护：当 buildings 有效时，保存到 ref 中
  React.useEffect(() => {
    if (buildings && buildings.length > 0) {
      console.log('🚨 [数据保护] buildings 数据有效，保存到 lastSuccessfulBuildings:', buildings.length, '条');
      lastSuccessfulBuildings.current = buildings;
    } else if (buildings && buildings.length === 0) {
      // 明确返回空数组（不是 undefined），也保存
      console.log('🚨 [数据保护] buildings 明确返回空数组，保存到 lastSuccessfulBuildings');
      lastSuccessfulBuildings.current = buildings;
    } else if (buildings === undefined && lastSuccessfulBuildings.current !== null) {
      // SWR 重新验证时 buildings 可能暂时变为 undefined
      console.warn('🚨 [数据保护] ⚠️ buildings 变为 undefined（可能是 SWR 重新验证），保留上次成功的数据');
    }
  }, [buildings]);

  // 🚨 数据保护：使用受保护的 buildings 数据
  const protectedBuildings = React.useMemo(() => {
    if (buildings !== undefined) {
      return buildings;
    }
    // buildings 为 undefined 时，使用上次成功的数据
    if (lastSuccessfulBuildings.current !== null) {
      console.warn('🚨 [数据保护] 使用 lastSuccessfulBuildings 防止数据丢失');
      return lastSuccessfulBuildings.current;
    }
    return undefined;
  }, [buildings]);

  // 处理楼宇数据：按 building_assignments 过滤，注入 referenceData，并添加 _category 分类
  const myBuildings = React.useMemo(() => {
    console.log('🚨 [计算逻辑启动] myBuildings useMemo 触发');
    console.log('   - protectedBuildings:', protectedBuildings ? `${protectedBuildings.length} 条` : 'undefined（SWR 尚未加载）');
    console.log('   - assignedBuildingIds:', assignedBuildingIds === null ? 'null（尚未加载）' : `${assignedBuildingIds.length} 条`);
    console.log('   - metricsMap keys:', Object.keys(metricsMap).length);

    // 🚨 关键修复：只有在明确"还在加载"时才返回空数组
    // protectedBuildings undefined = SWR 还在加载，不要提前返回空数组
    if (!protectedBuildings || assignedBuildingIds === null) {
      console.log('🚨 [计算逻辑] protectedBuildings 或 assignedBuildingIds 尚未就绪，返回 []');
      return [];
    }

    const idSet = new Set(assignedBuildingIds);
    console.log('🚨 [计算逻辑] idSet 大小:', idSet.size);
    console.log('🚨 [计算逻辑] idSet 前 5 个:', Array.from(idSet).slice(0, 5));

    const filtered = protectedBuildings.filter((b: any) => idSet.has(b.id));
    console.log('🚨 [计算逻辑] 过滤后的楼宇数量:', filtered.length);

    if (filtered.length === 0 && idSet.size > 0) {
      console.error('🚨 [计算逻辑] 🔴 过滤后为空！可能原因：');
      console.error('   - building_id 类型不匹配');
      console.error('   - 分配表中的 building_id 在 buildings 表中不存在');
      console.error('   - buildings 示例 ID:', protectedBuildings.slice(0, 3).map((b: any) => ({ id: b.id, type: typeof b.id })));
      console.error('   - assignedBuildingIds 示例:', Array.from(idSet).slice(0, 3).map(id => ({ id, type: typeof id })));
    }

    console.log('🚨 [计算逻辑] 开始 map 循环，处理', filtered.length, '条记录');
    let processedCount = 0;

    const result = filtered.map((b: any) => {
        processedCount++;
        if (processedCount <= 3 || processedCount === filtered.length) {
          console.log(`🚨 [计算逻辑] 处理第 ${processedCount}/${filtered.length} 条:`, b.id, b.name);
        }

        const copy = { ...b };

        // 检查 b.id 是否有效
        if (!b.id) {
          console.error('🚨 [计算逻辑] 🔴 发现 building.id 为 null/undefined:', b);
        }

        // 注入 referenceData（最新一条 metrics 记录）
        const metrics = metricsMap[b.id] ?? [];
        const ref = metrics[0] ?? null; // 已按年季降序，第一条即最新
        copy._referenceData = ref;
        // 将 referenceData 字段映射为 getVal 能识别的"上季度"字段名
        if (ref) {
          copy['上季度租金报价']    = ref.asking_rent;
          copy['上季度物业费']      = ref.management_fee;
          copy['上季度表面租金']    = ref.face_rent;
          copy['上季度免租期']      = ref.rent_free_period;
          copy['上季度净有效租金']  = ref.net_effective_rent;
          copy['上季度空置面积']    = ref.vacant_area;
          copy['上季度空置率']      = ref.vacancy_rate;
          // 🚨 修复：total_area 只从 building_metrics 获取
          copy['总面积']            = ref.total_area;
        }
        // 映射基础字段为 getVal 能识别的中文字段名
        copy['写字楼名称']  = b.name;
        copy['子市场']      = b.submarket;
        copy._sort_order = b.sort_order ?? 0;
        copy['业主']        = b.owner ?? b.landlord ?? '';
        copy['物业']        = b.property_management ?? '';
        copy['写字楼等级']  = b.grade;
        // 如果 building_metrics 中没有 total_area，回退到楼宇基础信息的 leasable_area
        if (!copy['总面积']) copy['总面积'] = b.total_area ?? 0;

        const g = String(b.grade ?? '').trim().toUpperCase();
        // grade 映射规则：
        // "BP", "Business Park" → BP
        // "B", "B+" 等含 B 的 → GradeB
        // "A", "A+", "P"(Premium), "" 等 → GradeA
        if (g === 'BP' || g.includes('BP') || g === 'BUSINESS PARK') copy._category = 'BP';
        else if (g === 'B' || g === 'B+' || (g.startsWith('B') && !g.startsWith('BP'))) copy._category = 'GradeB';
        else copy._category = 'GradeA'; // 包含 A、A+、P(Premium)、空值等

        return copy;
      });

    // 排序：先按子市场分组顺序，再按 sort_order
    result.sort((a, b) => {
      const catA = a._category as string;
      const catB = b._category as string;
      if (catA !== catB) return 0; // 不同分类之间不排序（由 tab 切换分开显示）
      const order = SUBMARKET_ORDER[catA] ?? [];
      const idxA = order.indexOf(a.submarket);
      const idxB = order.indexOf(b.submarket);
      const smA = idxA >= 0 ? idxA : order.length;
      const smB = idxB >= 0 ? idxB : order.length;
      if (smA !== smB) return smA - smB;
      return (a._sort_order ?? 0) - (b._sort_order ?? 0);
    });

    // 将未来供应楼宇追加到末尾
    for (const assignment of futureSupplyAssignments) {
      const fs = futureSupplyData[assignment.future_supply_id];
      if (!fs) continue;
      const copy: any = {
        id: fs.id,
        name: fs.name,
        submarket: fs.submarket || '',
        grade: fs.grade || '',
        owner: fs.owner || '',
        property_management: '',
        total_area: fs.total_area || 0,
        _isFutureSupply: true,
        _assignmentId: assignment.id,
      };
      const g = String(fs.grade ?? '').trim().toUpperCase();
      if (g === 'BP' || g.includes('BP') || g === 'BUSINESS PARK') copy._category = 'BP';
      else if (g === 'B' || g === 'B+' || (g.startsWith('B') && !g.startsWith('BP'))) copy._category = 'GradeB';
      else copy._category = 'GradeA';
      result.push(copy);
    }

    console.log('🚨 [计算逻辑] map 循环完成，返回', result.length, '条记录');
    return result;
  }, [protectedBuildings, assignedBuildingIds, metricsMap, futureSupplyAssignments, futureSupplyData]);

  // 初始化鉴权 + 拉取分配数据（两步分离，各自有独立错误处理）
  React.useEffect(() => {
    setReady(true);
    setAssignmentsError(null);
    let cancelled = false;

    void (async () => {
      // 🚨 探针 1: 检查当前 Session 状态
      console.log('🚨 [探针 1] 开始获取 Session...');
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      console.log('🚨 [探针 1] Session 状态:', currentSession ? '✅ 存在' : '🔴 NULL（未登录）');
      if (currentSession) {
        console.log('🚨 [探针 1] 用户 ID:', currentSession.user?.id);
        console.log('🚨 [探针 1] 用户邮箱:', currentSession.user?.email);
        console.log('🚨 [探针 1] Token 前 20 字符:', currentSession.access_token?.substring(0, 20) + '...');
      }

      // Step 1: 获取 session
      let session: Awaited<ReturnType<typeof getSessionFast>>;
      try {
        session = await getSessionFast();
        console.log('🚨 [探针 2] getSessionFast 返回:', session ? '✅ 有数据' : '🔴 NULL');
      } catch (e) {
        console.error('🚨 [探针 2] getSessionFast 异常:', e);
        console.error('[UpdatePage] getSessionFast 异常:', e);
        if (!cancelled) router.replace('/login');
        return;
      }

      if (cancelled) return;
      if (!session?.user) {
        console.error('🚨 [探针 3] Session 或 User 为空，跳转登录页');
        router.replace('/login');
        return;
      }

      const user = session.user;
      setCurrentUser(user);
      const name = (user.user_metadata?.full_name as string) || (user.email?.split('@')[0] ?? '未知用户');
      setMatchName(name);
      setDraftUserName(name); // 默认草稿用当前用户
      console.log('🚨 [探针 4] 当前用户:', name, '| UUID:', user.id);

      // 权限校验：admin 和 editor 可访问
      const { data: myRole } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .single();
      if (myRole?.role !== 'admin' && myRole?.role !== 'editor') {
        router.replace('/');
        return;
      }

      // 管理员预览模式：验证权限并切换到目标用户
      let assignmentUserId = user.id;
      if (previewAsUserId) {
        const { data: roleRow } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id)
          .single();
        if (roleRow?.role === 'admin') {
          setIsPreview(true);
          assignmentUserId = previewAsUserId;
          // 获取预览用户的显示名和邮箱（邮箱用于草稿匹配）
          const { data: previewUser } = await supabase
            .from('user_roles')
            .select('chinese_name, full_name, email')
            .eq('user_id', previewAsUserId)
            .single();
          setPreviewUserName(previewUser?.chinese_name || previewUser?.full_name || previewAsUserId);
          // 预览模式下用目标用户的 email prefix 加载草稿
          const previewDraftName = previewUser?.full_name || previewUser?.email?.split('@')[0] || '';
          if (previewDraftName) setDraftUserName(previewDraftName);
        } else {
          // 非管理员忽略 as 参数
          console.warn('[UpdatePage] 非管理员尝试使用预览模式，已忽略');
        }
      }

      // Step 2: 拉取 building_assignments（独立 try/catch，不影响 session 逻辑）
      try {
        console.log('🚨 [探针 5] 开始查询 building_assignments...');
        console.log('🚨 [探针 5] 查询参数 user_id:', user.id);

        const assignments = await retryAsync(async () => {
          const result = await supabase
            .from('building_assignments')
            .select('building_id')
            .eq('user_id', assignmentUserId);
          if (result.error) throw result.error;
          return result.data ?? [];
        }, { attempts: 3, baseDelayMs: 250 });

        console.log('🚨 [探针 6] building_assignments 查询结果:');
        console.log('   - 是否有错误: ✅ 否');
        console.log('   - 返回数据:', assignments);
        console.log('   - 记录数量:', assignments?.length || 0);

        if (cancelled) return;

        const ids: string[] = Array.isArray(assignments)
          ? assignments.map((a: any) => a.building_id)
          : [];
        console.log('🚨 [探针 7] 提取的 building_id 列表:', ids);
        console.log('🚨 [探针 7] 数量:', ids.length);

        // 🚨 数据保护探针：在更新状态前记录变化
        console.log('🚨 [状态更新] 分配 ID 即将从', assignedBuildingIds === null ? 'null（首次加载）' : `${assignedBuildingIds.length} 条`, '更新为', ids.length, '条');
        if (assignedBuildingIds !== null && assignedBuildingIds.length > 0 && ids.length === 0) {
          console.error('🚨 [状态更新] 🔴🔴🔴 严重警告：分配 ID 从', assignedBuildingIds.length, '条变为 0 条！');
          console.error('🚨 [状态更新] 🔴 这可能导致楼宇列表消失！');
          console.error('🚨 [状态更新] 🔴 调用堆栈:', new Error().stack);
          // 🚨 数据保护：如果已有数据，不允许覆盖为空
          console.warn('🚨 [数据保护] 拒绝将分配 ID 从', assignedBuildingIds.length, '条覆盖为 0 条，保留现有数据');
          return;
        }

        setAssignedBuildingIds(ids);

        // Step 3: 拉取 building_metrics（按年季降序，用于"上季度参考"列）
        if (ids.length > 0) {
          try {
            console.log('🚨 [探针 8] 开始查询 building_metrics...');
            console.log('🚨 [探针 8] 查询的 building_id 列表:', ids.slice(0, 5), '...');

            const metrics = await retryAsync(async () => {
              const result = await supabase
                .from('building_metrics')
                .select('building_id,record_year,record_quarter,asking_rent,management_fee,face_rent,rent_free_period,net_effective_rent,vacancy_rate,vacant_area,total_area')
                .in('building_id', ids)
                .order('record_year', { ascending: false })
                .order('record_quarter', { ascending: false });
              if (result.error) throw result.error;
              return result.data ?? [];
            }, { attempts: 3, baseDelayMs: 250 });

            console.log('🚨 [探针 9] building_metrics 查询结果:');
            console.log('   - 是否有错误: ✅ 否');
            console.log('   - 返回数据量:', metrics?.length || 0);

            if (cancelled) return;

            // 按 building_id 分组，每组已按年季降序，第一条即最新
            const map: Record<string, any[]> = {};
            for (const row of metrics) {
              if (!map[row.building_id]) map[row.building_id] = [];
              map[row.building_id].push(row);
            }
            console.log('🚨 [探针 10] metrics 分组结果，楼宇数量:', Object.keys(map).length);
            setMetricsMap(map);
          } catch (e) {
            console.warn('🚨 [探针 11] building_metrics 请求异常（静默降级）:', e);
            console.warn('[UpdatePage] building_metrics 请求异常（静默降级）:', e);
          }
        } else {
          console.log('🚨 [探针 12] ids.length = 0，跳过 building_metrics 查询');
        }

        // Step 4: 拉取未来供应分配（独立 try/catch）
        try {
          const { data: fsAssignments, error: fsErr } = await supabase
            .from('future_supply_assignments')
            .select('id, future_supply_id, record_year, record_quarter')
            .eq('user_id', assignmentUserId)
            .eq('record_year', submitYear)
            .eq('record_quarter', submitQuarter);

          if (!cancelled && !fsErr && fsAssignments && fsAssignments.length > 0) {
            setFutureSupplyAssignments(fsAssignments);
            // 查询对应的 future_supplies 数据
            const fsIds = fsAssignments.map(a => a.future_supply_id);
            const { data: fsData } = await supabase
              .from('future_supplies')
              .select('id, name, submarket, grade, owner, total_area, district')
              .in('id', fsIds);
            if (fsData) {
              const fsMap: Record<string, any> = {};
              for (const fs of fsData) fsMap[fs.id] = fs;
              setFutureSupplyData(fsMap);
            }
          }
        } catch (e) {
          console.warn('[UpdatePage] future_supply_assignments 查询异常（静默降级）:', e);
        }
      } catch (e: any) {
        console.error('🚨 [探针 13] building_assignments 请求异常:', e);
        console.error('   - 异常类型:', e?.constructor?.name);
        console.error('   - 异常消息:', e?.message);
        console.error('   - 异常堆栈:', e?.stack);
        console.error('[UpdatePage] building_assignments 请求异常:', e);
        if (!cancelled) {
          setAssignmentsError(`读取分配数据时发生异常：${e?.message ?? '未知错误'}`);
          // 🚨 数据保护：异常时，不要覆盖已有数据
          if (assignedBuildingIds === null) {
            console.warn('🚨 [数据保护] building_assignments 请求异常，但这是首次加载，设置为空数组');
            setAssignedBuildingIds([]);
          } else {
            console.warn('🚨 [数据保护] building_assignments 请求异常，保留现有数据:', assignedBuildingIds.length, '条');
          }
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [assignmentsRetryKey, router]);

  // 读取当前填报季度配置，并将提交年季默认值同步为管理员配置
  React.useEffect(() => {
    void (async () => {
      const { data } = await supabase.from('app_settings').select('key, value').in('key', ['current_submission_year', 'current_submission_quarter'])
      if (data) {
        let y = '', q = ''
        for (const row of data) {
          if (row.key === 'current_submission_year') y = row.value
          if (row.key === 'current_submission_quarter') q = row.value
        }
        if (y && q) {
          setCurrentSubmissionLabel(`${y} Q${q}`)
          setSubmitYear(Number(y))
          setSubmitQuarter(Number(q))
        }
      }
    })()
  }, [])

  // 当用户名和楼宇数据都准备好后，拉取初始草稿
  React.useEffect(() => {
    if (draftUserName && myBuildings.length > 0) {
      void fetchDraftFromServer(draftUserName, currentTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftUserName, myBuildings.length]);

  // 定时自动保存 — 仅当草稿有实际楼宇数据时才保存，避免空表单覆盖已有草稿
  React.useEffect(() => {
    if (!draftUserName || isImpersonating || isPreview) return;
    const timer = setInterval(() => {
      const merged = { ...draftData, __futureSupply__: futureSupplyDrafts };
      // 检查是否有实际楼宇数据（排除只有 __futureSupply__ 的空壳）
      const hasBuildingData = Object.keys(merged).some(k => k !== '__futureSupply__');
      if (!hasBuildingData) return; // 草稿为空，跳过保存
      syncDraftToServer(merged, currentTab, 'save', false).catch(e => {
        console.warn('🚨 [草稿] 定时自动保存失败（静默降级）:', e);
      });
    }, 30000);
    return () => clearInterval(timer);
  }, [draftUserName, draftData, futureSupplyDrafts, currentTab, isImpersonating, isPreview]);

  // 从云端 Supabase 拉取草稿
  const fetchDraftFromServer = async (userName: string, tab: string) => {
    try {
      setDraftStatus('正在读取云端草稿...');
      console.log('🚨 [草稿] 开始获取草稿:', { userName, tab });

      const { data, error } = await supabase
        .from('update_drafts')
        .select('draft_data')
        .eq('user_name', userName)
        .eq('tab', tab)
        .single();

      if (error) {
        console.error('🚨 [草稿] 获取草稿失败（静默降级）:', error);
        console.error('   - 错误信息:', error.message);
        console.error('   - 错误代码:', error.code);
        console.error('   - 错误详情:', error.details);
        console.error('   - 错误提示:', error.hint);
        console.warn('⚠️  草稿获取失败，将使用空草稿继续，不影响楼宇列表显示');
        setDraftData({});
        setDraftStatus('');
        return; // 静默降级，不影响主流程
      }

      if (data?.draft_data) {
        console.log('🚨 [草稿] 获取草稿成功，记录数:', Object.keys(data.draft_data).length);
        const { __futureSupply__, ...rest } = data.draft_data;
        setDraftData(rest);
        if (__futureSupply__ && typeof __futureSupply__ === 'object') {
          setFutureSupplyDrafts(__futureSupply__);
        } else {
          setFutureSupplyDrafts({});
        }
      } else {
        console.log('🚨 [草稿] 无草稿数据，使用空对象');
        setDraftData({});
        setFutureSupplyDrafts({});
      }
      setDraftStatus('');
    } catch (e: any) {
      console.error('🚨 [草稿] 获取草稿异常（静默降级）:', e);
      console.error('   - 异常类型:', e?.constructor?.name);
      console.error('   - 异常消息:', e?.message);
      console.warn('⚠️  草稿获取异常，将使用空草稿继续，不影响楼宇列表显示');
      setDraftData({});
      setDraftStatus('');
      // 不抛出错误，静默降级
    }
  };

  // 将草稿同步到 Supabase
  const syncDraftToServer = async (draft: any, tab: string, action: 'save' | 'clear', isManual: boolean = false) => {
    try {
      if (isManual) setDraftStatus('正在同步至云端...');

      console.log('🚨 [草稿] 开始同步草稿:', { action, tab, isManual });

      if (action === 'save') {
        const { error } = await supabase.from('update_drafts').upsert(
          { user_name: draftUserName, tab: tab, draft_data: draft, updated_at: new Date().toISOString() },
          { onConflict: 'user_name,tab' }
        );

        if (error) {
          console.error('🚨 [草稿] 保存草稿失败（静默降级）:', error);
          console.error('   - 错误信息:', error.message);
          console.error('   - 错误代码:', error.code);
          console.warn('⚠️  草稿保存失败，但不影响本地编辑和楼宇列表显示');
          if (isManual) {
            setDraftStatus('草稿保存失败（权限问题）');
            // 如果是手动保存，提示用户
            alert('草稿保存失败：' + error.message + '\n\n您的编辑仍然保留在本地，可以继续填写。');
          } else {
            setDraftStatus('');
          }
          return; // 静默降级
        }

        console.log('🚨 [草稿] 保存草稿成功');
        setDraftStatus(`已云端保存 (${new Date().toTimeString().substring(0, 5)})`);
      } else {
        const { error } = await supabase.from('update_drafts').delete().eq('user_name', draftUserName).eq('tab', tab);

        if (error) {
          console.error('🚨 [草稿] 清除草稿失败（静默降级）:', error);
          console.warn('⚠️  草稿清除失败，但不影响提交流程');
        } else {
          console.log('🚨 [草稿] 清除草稿成功');
        }

        setDraftStatus('');
      }
    } catch (e: any) {
      console.error('🚨 [草稿] 同步草稿异常（静默降级）:', e);
      console.error('   - 异常类型:', e?.constructor?.name);
      console.error('   - 异常消息:', e?.message);
      console.warn('⚠️  草稿同步异常，但不影响本地编辑和楼宇列表显示');
      if (isManual) {
        setDraftStatus('草稿同步异常');
        alert('草稿同步异常：' + (e?.message || '未知错误') + '\n\n您的编辑仍然保留在本地，可以继续填写。');
      } else {
        setDraftStatus('');
      }
      // 不抛出错误，静默降级
    }
  };

  // 切换标签页
  const handleSwitchTab = async (tabName: string) => {
    if (currentTab === tabName) return;
    try {
      const merged = { ...draftData, __futureSupply__: futureSupplyDrafts };
      const hasBuildingData = Object.keys(merged).some(k => k !== '__futureSupply__');
      if (hasBuildingData) {
        await syncDraftToServer(merged, currentTab, 'save', false);
      }
    } catch (e) {
      console.warn('🚨 [草稿] 切换标签页时保存草稿失败（静默降级）:', e);
    }
    setCurrentTab(tabName);
    setFutureSupplyDrafts({});
    try {
      await fetchDraftFromServer(draftUserName, tabName);
    } catch (e) {
      console.warn('🚨 [草稿] 切换标签页时获取草稿失败（静默降级）:', e);
      setDraftData({});
    }
  };

  // 手动暂存草稿
  const manualSave = async () => {
    try {
      const merged = { ...draftData, __futureSupply__: futureSupplyDrafts };
      await syncDraftToServer(merged, currentTab, 'save', true);
      alert("草稿已成功保存至云端！换电脑登录或退出账号也不会丢失。");
    } catch (e: any) {
      console.error('🚨 [草稿] 手动保存失败:', e);
      // syncDraftToServer 内部已经处理了错误提示
    }
  };

  // 处理输入框变更（使用 building.id 作为 key，避免排序变化导致数据错位）
  const handleInputChange = (buildingId: string, field: string, value: string) => {
    setDraftData(prev => ({
      ...prev,
      [buildingId]: {
        ...(prev[buildingId] || {}),
        [field]: value
      }
    }));
  };

  // 处理未来供应输入框变更
  const handleFutureSupplyInputChange = (assignmentId: string, field: string, value: string) => {
    setFutureSupplyDrafts(prev => ({
      ...prev,
      [assignmentId]: {
        ...(prev[assignmentId] || {}),
        [field]: value
      }
    }));
  };

  // 执行正式提交 —— 普通楼宇→quarterly_submissions，未来供应→future_supply_submissions
  const executeSubmit = async () => {
    setShowModal(false);
    setSubmitting(true);
    setDraftStatus('正在打包并上传数据...');

    const filteredBuildings = myBuildings.filter(b => b._category === currentTab);
    const regularRows: any[] = [];
    const futureRows: any[] = [];

    filteredBuildings.forEach((building) => {
      const d = building._isFutureSupply
        ? (futureSupplyDrafts[building._assignmentId] || {})
        : (draftData[building.id] || {});

      const hasData = d.qQuote || d.qProp || d.qFace || d.qFree || d.qVacArea || d.qOwner || d.qPropMan || d.qRemark;
      if (!hasData) return;

      const faceRent  = parseFloat(d.qFace)    || 0;
      const freeMonth = parseFloat(d.qFree)     || 0;
      const vacArea   = parseFloat(d.qVacArea)  || 0;
      const totalArea = building._isFutureSupply ? (building.total_area || 1) : (safeNum(getVal(building, ['总面积', 'Total Area'])) || 1);

      const netEffectiveRent = faceRent > 0 ? faceRent * (36 - freeMonth) / 36 : null;
      const vacancyRate      = d.qVacArea !== undefined && d.qVacArea !== '' ? vacArea / totalArea : null;

      const row = {
        user_id:            currentUser?.id ?? null,
        user_name:          matchName,
        record_year:        submitYear,
        record_quarter:     submitQuarter,
        asking_rent:        d.qQuote   ? Math.round(Number(d.qQuote))   : null,
        management_fee:     d.qProp    ? Math.round(Number(d.qProp))    : null,
        face_rent:          d.qFace    ? parseFloat(d.qFace)            : null,
        rent_free_period:   d.qFree    ? parseFloat(d.qFree)            : null,
        net_effective_rent: netEffectiveRent !== null ? parseFloat(netEffectiveRent.toFixed(2)) : null,
        vacant_area:        d.qVacArea ? Math.round(Number(d.qVacArea)) : null,
        vacancy_rate:       vacancyRate !== null ? parseFloat((vacancyRate * 100).toFixed(2)) : null,
        total_area:         totalArea,
        owner:              d.qOwner   || null,
        property_management: d.qPropMan || null,
        notes:              d.qRemark  || null,
      };

      if (building._isFutureSupply) {
        futureRows.push({ ...row, future_supply_id: building.id });
      } else {
        regularRows.push({ ...row, building_id: building.id });
      }
    });

    const totalCount = regularRows.length + futureRows.length;
    if (totalCount === 0) {
      alert('当前分类下没有填写任何数据，无需提交');
      setSubmitting(false);
      setDraftStatus('');
      return;
    }

    try {
      // 分别写入两张表
      if (regularRows.length > 0) {
        const { error } = await supabase.from('quarterly_submissions').insert(regularRows);
        if (error) throw error;
      }
      if (futureRows.length > 0) {
        const { error } = await supabase.from('future_supply_submissions').insert(futureRows);
        if (error) throw error;
      }

      logAction(currentUser?.email, 'SUBMIT_QUARTERLY_DATA', { count: totalCount, regular: regularRows.length, future: futureRows.length, tab: currentTab, year: submitYear, quarter: submitQuarter });

      // 🔥 修改：提交成功后，不删除草稿，而是将草稿内容更新为与刚刚提交的内容一致
      // 这样用户下次打开时能看到最后一次提交的基础，并在基础上继续填写
      try {
        // 将刚刚提交的数据同步回草稿（保持草稿与最新提交一致）
        const mergedPost = { ...draftData, __futureSupply__: futureSupplyDrafts };
        await syncDraftToServer(mergedPost, currentTab, 'save', false);
        console.log('✅ 提交成功后已将草稿更新为最新提交内容');
      } catch (e) {
        console.warn('🚨 [草稿] 提交后更新草稿失败（静默降级）:', e);
        // 不影响提交成功的提示
      }

      const parts: string[] = [];
      if (regularRows.length > 0) parts.push(`${regularRows.length} 条普通楼宇`);
      if (futureRows.length > 0) parts.push(`${futureRows.length} 条未来供应`);
      alert(`提交成功，共上传 ${parts.join(' + ')} 数据\n\n提示：您的草稿已保留，下次可在此基础上继续填写剩余字段`);
      setSubmitting(false);
      setDraftStatus('');
    } catch (e: any) {
      alert('提交失败: ' + e.message);
      setSubmitting(false);
      setDraftStatus('');
    }
  };

  // 提交前校验 (V1 逻辑)
  const submitData = async () => {
    try {
      const mergedPre = { ...draftData, __futureSupply__: futureSupplyDrafts };
      await syncDraftToServer(mergedPre, currentTab, 'save', false);
    } catch (e) {
      console.warn('🚨 [草稿] 提交前保存草稿失败（静默降级）:', e);
      // 不阻止提交
    }

    let incompleteBuildings: string[] = [];
    let snCount = 1;

    myBuildings.forEach((building) => {
      if (building._category !== currentTab) return;

      const bName = getVal(building, ['写字楼名称', 'Project Name CN']);
      const d = building._isFutureSupply
        ? (futureSupplyDrafts[building._assignmentId] || {})
        : (draftData[building.id] || {});

      const isComplete = (d.qQuote && d.qProp && d.qFace && d.qFree && d.qVacArea);
      if (!isComplete) {
        incompleteBuildings.push(`序号 ${snCount}：${bName}`);
      }
      snCount++;
    });

    if (incompleteBuildings.length > 0) {
      let msg = `系统检测到当前分类还有 <b style="font-size:16px;">${incompleteBuildings.length}</b> 个楼宇的数据没有填写完：<br><br>`;
      msg += incompleteBuildings.slice(0, 4).join('<br>');
      if (incompleteBuildings.length > 4) msg += `<br>... (省略显示)`;
      msg += `<br><br><span style="color:#d32f2f;">提醒：除了业主、物业和备注外，其他均为必填项。</span>`;

      setModalText(msg);
      setShowModal(true);
      return;
    }

    executeSubmit();
  };

  // 🚨 优先检查错误状态，避免卡在 Loading
  // Error 状态 - buildings 查询失败
  if (buildingsError) {
    const errorInfo = handleDataFetchError(buildingsError);
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f6f9] p-4">
        <div className="max-w-md rounded-lg border border-red-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-500">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <h2 className="text-lg font-semibold text-gray-900">数据加载失败</h2>
          </div>
          <p className="text-sm text-gray-600 mb-4">{errorInfo.message}</p>
          <div className="flex gap-3">
            {errorInfo.retryable && (
              <button
                onClick={() => mutate()}
                className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 4 23 10 17 10"/>
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                </svg>
                {errorInfo.userAction}
              </button>
            )}
            {errorInfo.redirect && (
              <button
                onClick={() => router.push(errorInfo.redirect!)}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                {errorInfo.userAction}
              </button>
            )}
            <Link
              href="/"
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              返回首页
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // assignments 查询错误状态
  if (assignmentsError) {
    return (
      <div className="flex flex-col h-screen bg-zinc-50 overflow-hidden font-sans">
        <div className="border-b border-zinc-200/80 bg-[#003e7e] px-5 h-14 flex justify-between items-center shrink-0">
          <span className="text-[14px] font-semibold tracking-tight text-white">季度数据填报</span>
          <Link href="/" className="flex items-center gap-1.5 text-[12px] text-white/70 transition hover:text-white">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
            退出填报
          </Link>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="max-w-md rounded-lg border border-red-200 bg-white p-6 shadow-sm text-center">
            <p className="text-sm text-red-600 mb-4">{assignmentsError}</p>
            <div className="flex justify-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setAssignmentsError(null);
                  setAssignedBuildingIds(null);
                  setAssignmentsRetryKey(value => value + 1);
                }}
                className="rounded-md bg-[#003e7e] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#003566] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003e7e]/30"
              >
                重新加载
              </button>
              <Link href="/" className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">返回首页</Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Loading 状态 - 显示骨架屏
  // 🚨 修复：使用 protectedBuildings 而不是 buildings，防止 SWR 重新验证时闪现
  // 🚨 修复：移除 buildingsLoading 判断，因为它可能在错误时仍为 true
  if (!ready || protectedBuildings === undefined || assignedBuildingIds === null) return (
    <div className="flex flex-col h-screen bg-zinc-50 overflow-hidden font-sans">
      {/* Header 骨架 */}
      <div className="border-b border-zinc-200/80 bg-[#003e7e] px-5 h-14 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-[14px] font-semibold tracking-tight text-white">季度数据填报</span>
          <span className="rounded border border-white/20 px-1.5 py-0.5 text-[10px] font-medium text-white/60">{matchName || '加载中...'}</span>
        </div>
        <Link href="/" className="flex items-center gap-1.5 text-[12px] text-white/70 transition hover:text-white">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          退出填报
        </Link>
      </div>
      {/* 加载指示器 */}
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#003e7e] border-t-transparent" />
          <span className="text-sm text-zinc-600">正在加载您负责的楼宇数据...</span>
        </div>
      </div>
    </div>
  );

  if (!ready) return (
    <div className="flex flex-col h-screen bg-zinc-50 overflow-hidden font-sans">
      {/* Header 骨架 */}
      <div className="border-b border-zinc-200/80 bg-[#003e7e] px-5 h-14 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-[14px] font-semibold tracking-tight text-white">季度数据填报</span>
        </div>
        <Link href="/" className="flex items-center gap-1.5 text-[12px] text-white/70 transition hover:text-white">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          退出填报
        </Link>
      </div>
      {/* 加载指示器 */}
      <div className="flex-1 flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#003e7e] border-t-transparent" />
      </div>
    </div>
  );

  // 无分配任务的空状态（assignedBuildingIds 此时已确定不为 null）
  if (assignedBuildingIds.length === 0) {
    return (
      <div className="flex flex-col h-screen bg-zinc-50 overflow-hidden font-sans">
        <div className="border-b border-zinc-200/80 bg-[#003e7e] px-5 h-14 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-[14px] font-semibold tracking-tight text-white">季度数据填报</span>
            <span className="rounded border border-white/20 px-1.5 py-0.5 text-[10px] font-medium text-white/60">{matchName}</span>
          </div>
          <Link href="/" className="flex items-center gap-1.5 text-[12px] text-white/70 transition hover:text-white">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
            退出填报
          </Link>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-center max-w-sm">
            <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-300">
              <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6M9 12h6M9 15h4"/>
            </svg>
            <p className="text-sm text-zinc-500">目前没有分配给您的填报任务，请联系管理员。</p>
            <Link href="/" className="mt-2 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-xs text-zinc-600 hover:bg-zinc-50">返回首页</Link>
          </div>
        </div>
      </div>
    );
  }

  const filteredBuildings = myBuildings.filter(b => b._category === currentTab);

  return (
    <div className="flex flex-col h-screen bg-zinc-50 overflow-hidden font-sans">
      {/* Header */}
      <div className="border-b border-zinc-200/80 bg-[#003e7e] px-5 h-14 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-[14px] font-semibold tracking-tight text-white">季度数据填报</span>
          {currentSubmissionLabel && (
            <span className="rounded bg-white/20 px-2 py-0.5 text-[11px] font-bold text-white">{currentSubmissionLabel}</span>
          )}
          <span className="rounded border border-white/20 px-1.5 py-0.5 text-[10px] font-medium text-white/60">{matchName}</span>
        </div>
        <Link href="/" className="flex items-center gap-1.5 text-[12px] text-white/70 transition hover:text-white">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          退出填报
        </Link>
      </div>

      {/* 管理员预览模式横幅 */}
      {isPreview && (
        <div className="shrink-0 bg-amber-50 border-b border-amber-200 px-5 py-2 flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-600 shrink-0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span className="text-xs text-amber-700 font-medium">管理员预览模式</span>
          <span className="text-xs text-amber-600">— 正在查看 {previewUserName} 的填报页面（只读）</span>
          <a href="/admin" className="ml-auto text-xs text-amber-700 underline hover:text-amber-900">返回管理后台</a>
        </div>
      )}

      <div className="flex-1 flex flex-col min-h-0 bg-white m-2.5 rounded-xl border border-zinc-200/60 shadow-sm p-4 box-border">
        {/* Tab 栏 */}
        <div className="flex gap-1.5 items-center border-b border-zinc-200/80 pb-3 mb-3 shrink-0">
          {(['GradeA', 'GradeB', 'BP'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => handleSwitchTab(tab)}
              className={`px-4 py-1.5 text-[13px] font-medium rounded-md transition-colors ${
                currentTab === tab
                  ? 'bg-primary text-white'
                  : 'bg-zinc-50 text-zinc-600 hover:bg-zinc-100 border border-zinc-200/60'
              }`}
            >
              {tab === 'GradeA' ? '甲级写字楼' : tab === 'GradeB' ? '乙级写字楼' : '产业园 (BP)'}
            </button>
          ))}
          <span className="ml-auto text-[12px] text-emerald-600 font-medium">{draftStatus}</span>
        </div>

        {/* 核心表格区 - 使用内联样式保证 100% 还原 V1 CSS */}
        <div className="flex-1 overflow-auto border border-gray-300 rounded-sm min-h-0 relative">
          <style dangerouslySetInnerHTML={{__html: `
            .v1-table { border-collapse: separate; border-spacing: 0; font-size: 11px; min-width: 2000px; width: 100%; }
            .v1-table th, .v1-table td { border-right: 1px solid #eee; border-bottom: 1px solid #eee; padding: 6px 4px; text-align: center; vertical-align: middle; font-variant-numeric: tabular-nums; }
            .v1-table .th-group-base { background: #f8f9fa; color: #333; border-bottom: 2px solid #ccc !important; position: sticky; top: 0; z-index: 11; }
            .v1-table .th-group-last { background: #eef2f5; color: #003E7E; border-bottom: 2px solid #90caf9 !important; position: sticky; top: 0; z-index: 11; }
            .v1-table .th-group-curr { background: #fff8e1; color: #f57f17; border-bottom: 2px solid #ffe082 !important; position: sticky; top: 0; z-index: 11; }
            .v1-table .th-base { background: #fafafa; color: #555; position: sticky; top: 27px; z-index: 10; font-weight: 600; box-shadow: 0 1px 0 #eee; }
            .v1-table .th-last { background: #f4f6f8; color: #003E7E; position: sticky; top: 27px; z-index: 10; font-weight: 600; box-shadow: 0 1px 0 #eee; width: 60px; }
            .v1-table .th-curr { background: #fffde7; color: #d84315; position: sticky; top: 27px; z-index: 10; font-weight: 600; box-shadow: 0 1px 0 #eee; width: 85px; }
            .v1-table .col-fixed-1 { position: sticky; left: 0; z-index: 20; background: #fafafa; border-right: 1px solid #eee; width: 30px; }
            .v1-table .col-fixed-2 { position: sticky; left: 30px; z-index: 20; background: #fff; border-right: 2px solid #ddd !important; width: 120px; text-align: left;}
            .v1-table th.col-fixed-1, .v1-table th.col-fixed-2 { z-index: 30; background: #fafafa; }
            .v1-table tbody td.col-fixed-1 { background: #fafafa; }
            .v1-table tbody td.col-fixed-2 { background: #fff; }
            .v1-table tbody tr:hover td.col-fixed-1 { background: #f5f5f5; }
            .v1-table tbody tr:hover td.col-fixed-2 { background: #fafafa; }
            .v1-table input, .v1-table textarea { width: 100%; padding: 4px 2px; border: 1px solid #ccc; border-radius: 2px; box-sizing: border-box; font-family: inherit; font-size: 11px; text-align: center; outline:none; transition: border-color 150ms, background-color 150ms; }
            .v1-table input:focus, .v1-table textarea:focus { border-color: #003E7E; background: #e3f2fd; }
            .v1-table textarea { text-align: left; resize: none; overflow: hidden; }
            .v1-table textarea:focus { overflow-y: auto; }
            .v1-table .calc-cell { background: #fcfcfc; font-weight: bold; }
            .v1-table tbody tr { transition: background-color 150ms; }
            .v1-table tbody tr:hover { background-color: rgba(250, 250, 250, 0.8); }
          `}} />

          <table className="v1-table">
            <thead>
              <tr>
                <th colSpan={1} className="th-group-base" style={{position:'sticky', left:0, zIndex:31, background:'#f8f9fa'}}></th>
                <th colSpan={1} className="th-group-base" style={{position:'sticky', left:30, zIndex:31, background:'#f8f9fa'}}></th>
                <th colSpan={4} className="th-group-base">基础信息</th>
                <th colSpan={7} className="th-group-last">上季度参考</th>
                <th colSpan={10} className="th-group-curr">本季度填报</th>
              </tr>
              <tr>
                <th className="th-base col-fixed-1">序号</th>
                <th className="th-base col-fixed-2">项目名称</th>
                <th className="th-base" style={{width:'70px'}}>子市场</th>
                <th className="th-base" style={{width:'80px'}}>业主 (可补充)</th>
                <th className="th-base" style={{width:'80px'}}>物业 (可补充)</th>
                <th className="th-base" style={{width:'60px'}}>总面积</th>

                <th className="th-last">报价</th>
                <th className="th-last">物业费</th>
                <th className="th-last">表面租金</th>
                <th className="th-last" style={{width:'115px', whiteSpace:'nowrap'}}>免租期(三年)</th>
                <th className="th-last">净有效租金</th>
                <th className="th-last">空置面积</th>
                <th className="th-last">空置率</th>

                <th className="th-curr">报价</th>
                <th className="th-curr">物业费</th>
                <th className="th-curr">表面租金</th>
                <th className="th-curr" style={{width:'115px', whiteSpace:'nowrap'}}>免租期(三年)</th>
                <th className="th-curr" style={{background:'#fff3e0'}}>净有效租金</th>
                <th className="th-curr" style={{background:'#fff3e0', whiteSpace:'nowrap'}}>租金变化率</th>
                <th className="th-curr">空置面积</th>
                <th className="th-curr" style={{background:'#fff3e0', whiteSpace:'nowrap'}}>空置面积变化</th>
                <th className="th-curr" style={{background:'#fff3e0'}}>空置率</th>
                <th className="th-curr" style={{width:'100px'}}>备注</th>
              </tr>
            </thead>
            <tbody>
              {filteredBuildings.length === 0 ? (
                <tr><td colSpan={23} style={{textAlign:'center', padding:'40px', color:'#888', fontSize:'13px'}}>当前分类 ({currentTab}) 下没有需要填报的项目。</td></tr>
              ) : (
                filteredBuildings.map((item, index) => {
                  const d = item._isFutureSupply
                    ? (futureSupplyDrafts[item._assignmentId] || {})
                    : (draftData[item.id] || {});
                  const count = index + 1;

                  const isFutureSupply = item._isFutureSupply === true;
                  const name = isFutureSupply ? item.name : (getVal(item, ['写字楼名称', 'Project Name CN', 'name']) || '-');
                  const district = isFutureSupply ? (item.submarket || '-') : (getVal(item, ['子市场', 'SUBMARKET']) || '-');
                  const totalArea = isFutureSupply ? (item.total_area || 1) : (safeNum(getVal(item, ['总面积', 'Total Area'])) || 1);
                  const defaultOwner = isFutureSupply ? '' : getVal(item, ['业主', 'Landlord']);
                  const defaultProp = isFutureSupply ? '' : getVal(item, ['物业', '物业公司', 'Property Management']);

                  // 未来供应无上季度参考数据
                  const lastQuote = isFutureSupply ? 0 : safeNum(getVal(item, ['上季度租金报价', '报价', '租金报价']));
                  const lastPropFee = isFutureSupply ? 0 : safeNum(getVal(item, ['上季度物业费', '物业费']));
                  const lastFace = isFutureSupply ? 0 : safeNum(getVal(item, ['上季度表面租金', '表面租金', '表面']));
                  const lastFree = isFutureSupply ? 0 : safeNum(getVal(item, ['上季度免租期', '免租期', '免租期（三年租约）']));
                  const lastNet = isFutureSupply ? 0 : safeNum(getVal(item, ['上季度净有效租金', '净有效租金']));
                  const lastVacArea = isFutureSupply ? 0 : safeNum(getVal(item, ['上季度空置面积', '空置面积']));
                  const rawVacRate = isFutureSupply ? '' : getVal(item, ['上季度空置率', '空置率']);
                  const lastVacRate = safeNum(rawVacRate);

                  // 实时的 React 计算引擎 (替换原来的 js calcRow)
                  const faceRent = parseFloat(d.qFace) || 0;
                  const freeMonth = parseFloat(d.qFree) || 0;
                  const vacArea = parseFloat(d.qVacArea) || 0;

                  let currentNet = 0;
                  if (faceRent > 0) currentNet = faceRent * (36 - freeMonth) / 36;

                  // 未来供应无上季度数据，变化率显示为"-"
                  let rentChangeStr = '-';
                  let rentChangeColor = '#666';
                  if (!isFutureSupply && currentNet > 0 && lastNet > 0) {
                      const rawChange = (currentNet - lastNet) / lastNet * 100;
                      const changePct = parseFloat(rawChange.toFixed(1));
                      rentChangeStr = changePct.toFixed(1) + '%';
                      rentChangeColor = changePct > 0 ? '#d32f2f' : (changePct < 0 ? '#2e7d32' : '#666');
                  }

                  let areaChangeStr = '-';
                  let areaChangeColor = '#666';
                  let vacRateStr = '-';
                  if (d.qVacArea !== undefined && d.qVacArea !== '') {
                      if (!isFutureSupply) {
                        const areaDiff = Math.round(vacArea - lastVacArea);
                        areaChangeStr = (areaDiff > 0 ? '+' : '') + areaDiff.toLocaleString();
                        areaChangeColor = areaDiff > 0 ? '#d32f2f' : (areaDiff < 0 ? '#2e7d32' : '#666');
                      }
                      vacRateStr = ((vacArea / totalArea) * 100).toFixed(1) + '%';
                  }

                  const rowStyle = isFutureSupply ? {background: '#fffbeb'} : {};
                  const nameColor = isFutureSupply ? '#d97706' : '#003E7E';

                  // 根据是否是未来供应，选择不同的 onChange 处理
                  const handleChange = isFutureSupply
                    ? (field: string) => (e: any) => handleFutureSupplyInputChange(item._assignmentId, field, e.target.value)
                    : (field: string) => (e: any) => handleInputChange(item.id, field, e.target.value);

                  return (
                    <tr key={item.id} style={rowStyle}>
                      <td className="col-fixed-1" style={{color:'#888', ...rowStyle}}>{count}</td>
                      <td className="col-fixed-2" style={{color: nameColor, fontWeight:'bold', ...rowStyle}}>{name}</td>
                      <td>{district}</td>

                      <td style={{background:'#f8f9fa'}}><textarea rows={1} onFocus={e=>e.target.rows=3} onBlur={e=>e.target.rows=1} value={d.qOwner ?? defaultOwner} onChange={handleChange('qOwner')} readOnly={isImpersonating} className={isImpersonating ? 'bg-zinc-100 cursor-not-allowed' : ''} /></td>
                      <td style={{background:'#f8f9fa'}}><textarea rows={1} onFocus={e=>e.target.rows=3} onBlur={e=>e.target.rows=1} value={d.qPropMan ?? defaultProp} onChange={handleChange('qPropMan')} readOnly={isImpersonating} className={isImpersonating ? 'bg-zinc-100 cursor-not-allowed' : ''} /></td>

                      <td>{totalArea.toLocaleString()}</td>

                      <td style={{color:'#888'}}>{lastQuote > 0 ? Math.round(lastQuote) : '-'}</td>
                      <td style={{color:'#888'}}>{lastPropFee > 0 ? Math.round(lastPropFee) : '-'}</td>
                      <td style={{color:'#888'}}>{lastFace || '-'}</td>
                      <td style={{color:'#888'}}>{lastFree || '-'}</td>
                      <td style={{color:'#888', fontWeight:'bold'}}>{lastNet > 0 ? lastNet.toFixed(1) : '-'}</td>
                      <td style={{color:'#888'}}>{lastVacArea > 0 ? Math.round(lastVacArea).toLocaleString() : '-'}</td>
                      <td style={{color:'#888'}}>{rawVacRate !== '' ? (lastVacRate*100).toFixed(1) + '%' : '-'}</td>

                      <td><input type="number" step="1" value={d.qQuote || ''} onChange={handleChange('qQuote')} readOnly={isImpersonating} className={isImpersonating ? 'bg-zinc-100 cursor-not-allowed' : ''} /></td>
                      <td><input type="number" step="1" value={d.qProp || ''} onChange={handleChange('qProp')} readOnly={isImpersonating} className={isImpersonating ? 'bg-zinc-100 cursor-not-allowed' : ''} /></td>
                      <td><input type="number" step="0.01" value={d.qFace || ''} onChange={handleChange('qFace')} readOnly={isImpersonating} className={isImpersonating ? 'bg-zinc-100 cursor-not-allowed' : ''} /></td>
                      <td><input type="number" step="0.1" value={d.qFree || ''} onChange={handleChange('qFree')} readOnly={isImpersonating} className={isImpersonating ? 'bg-zinc-100 cursor-not-allowed' : ''} /></td>

                      <td className="calc-cell" style={{color:'#d84315'}}>{currentNet > 0 ? currentNet.toFixed(1) : '-'}</td>
                      <td className="calc-cell" style={{color: rentChangeColor}}>{rentChangeStr}</td>

                      <td><input type="number" step="1" value={d.qVacArea || ''} onChange={handleChange('qVacArea')} readOnly={isImpersonating} className={isImpersonating ? 'bg-zinc-100 cursor-not-allowed' : ''} /></td>

                      <td className="calc-cell" style={{color: areaChangeColor}}>{areaChangeStr}</td>
                      <td className="calc-cell" style={{color:'#003E7E'}}>{vacRateStr}</td>

                      <td><textarea rows={1} onFocus={e=>e.target.rows=3} onBlur={e=>e.target.rows=1} value={d.qRemark || ''} onChange={handleChange('qRemark')} readOnly={isImpersonating} className={isImpersonating ? 'bg-zinc-100 cursor-not-allowed' : ''} /></td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* 底部操作栏 */}
        <div className="flex justify-end items-center gap-3 mt-4 pt-4 border-t border-zinc-200/80 shrink-0">
          {myBuildings.some(b => b._isFutureSupply) && (
            <span className="flex items-center gap-1.5 text-[11px] text-amber-700 mr-2">
              <span className="inline-block w-3 h-3 rounded-sm bg-amber-200 border border-amber-300"></span>
              新增供应项目（黄色高亮，无上季度参考数据）
            </span>
          )}
          <span className="text-[12px] text-zinc-400 mr-auto">系统将自动同步草稿至云端</span>
          {isPreview || isImpersonating ? (
            <span className="text-xs text-zinc-400">{isImpersonating ? '模拟模式下不可操作' : '预览模式下不可操作'}</span>
          ) : (
            <>
              <button onClick={manualSave} className="rounded-md border border-zinc-200/60 bg-white px-5 py-2 text-[13px] font-medium text-zinc-600 transition-all duration-150 hover:bg-zinc-50 active:scale-[0.98]">暂存草稿</button>
              <button onClick={submitData} disabled={submitting} className="rounded-md bg-primary px-6 py-2 text-[13px] font-semibold text-white transition-all duration-150 hover:bg-primary-hover active:scale-[0.98] disabled:opacity-50">
                {submitting ? '上传中...' : '提交上传'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* 拦截弹窗 */}
      {showModal && (
        <div className="fixed inset-0 bg-zinc-900/20 backdrop-blur-sm z-50 flex justify-center items-center transition-opacity duration-150">
          <div className="bg-white p-8 rounded-xl border border-zinc-200/60 shadow-xl max-w-md w-full mx-4 animate-in fade-in zoom-in-95 duration-150">
            <h3 className="text-zinc-900 text-base font-semibold tracking-tight mt-0 mb-4">存在未填完的楼宇</h3>
            <div className="text-[13px] text-zinc-600 leading-relaxed mb-6" dangerouslySetInnerHTML={{__html: modalText}} />
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowModal(false)} className="rounded-md border border-zinc-200/60 px-5 py-2 text-[13px] font-medium text-zinc-600 transition-all duration-150 hover:bg-zinc-50 active:scale-[0.98]">去补充填写</button>
              <button onClick={executeSubmit} className="rounded-md bg-primary px-5 py-2 text-[13px] font-semibold text-white transition-all duration-150 hover:bg-primary-hover active:scale-[0.98]">强行提交</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
