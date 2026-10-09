import { supabase } from "./supabaseClient";
import { withImpersonationHeaders } from "./impersonationHeaders";
import { readPagedRows } from "../utils/readPagedRows";
import type { NumericLike } from "../utils/calculations";

/**
 * 新架构 apiClient（Supabase 版）
 *
 * 目标：
 * - 废弃旧版 `_legacy_v1/api/*` 的自建接口
 * - 直接通过 Supabase 查询底表/视图
 * - 保持“纯函数”：不做 UI 提示，不做缓存副作用；遇到错误一律 throw Error
 *
 * 注意：
 * - 由于你当前仓库中尚未包含 Supabase 的 Database 类型生成文件（例如 `src/types/supabase.ts`），
 * 这里先用显式 Interface 描述我们期望的字段形状。
 * - 当你确定真实表结构后，建议用 Supabase CLI 生成类型并替换这些手写接口。
 */

/**
 * buildings 底表（建议与你的 Supabase 表字段对齐）
 *
 * 兼容旧版 data.xlsx 常用字段（map.html / update.html 会用到）：
 * - name/district/grade/leed/built_year
 * - position：经纬度（建议拆成 lng/lat 两列，更易索引与类型化）
 * - metrics：净有效租金、空置率、空置面积、总面积等
 */
export interface BuildingRow {
  id: string;

  name: string;
  district: string | null;
  submarket: string | null; // 🔥 子市场字段
  sort_order: number;
  built_year: string | null;
  grade: string | null;
  leed: string | null;

  lng: number | null; // 允许为 null，防止由于前端类型校验报错
  lat: number | null; // 允许为 null

  /** 可选：底表可能直接存“当前值” */
  net_effective_rent?: number | null;
  vacancy_rate?: number | null; // 0~1
  vacancy_area?: number | null;
  total_area?: number | null;

  owner?: string | null;
  landlord?: string | null;
  property_management?: string | null;
  /** 可选：用于 update（分配负责人） */
  owner_user?: string | null;
}

/**
 * building_metrics 表/视图：把“季度指标”单独拆表时使用
 * - 这里按“当前/上期”两个维度做示例，你可以按季度维度扩展（year/quarter）
 */
export interface BuildingMetricsRow {
  building_id: string;

  // 当前
  net_effective_rent: NumericLike;
  vacancy_rate: NumericLike;
  vacancy_area: NumericLike;
  total_area: NumericLike;

  // 上期（可选）
  prev_net_effective_rent?: NumericLike;
  prev_vacancy_rate?: NumericLike;
  prev_vacancy_area?: NumericLike;

  // 时间维度（可选）
  as_of?: string | null; // 例如 "2026Q1" 或 ISO 日期
}

type SupabaseQueryError = { message: string } | null;

function assertNoError(error: SupabaseQueryError, context: string): void {
  if (!error) return;
  throw new Error(`${context}：${error.message}`);
}

/**
 * 获取楼宇清单（用于地图、筛选等）。
 *
 * 默认读取 `buildings` 表。
 */
export async function getBuildings(params?: {
  /**
   * 仅返回指定字段（可减少网络负载）。
   * 注意：字段名必须与 Supabase 表字段一致。
   */
  select?: string;
  /** 是否只拉取有有效坐标的楼宇（默认 false，确保看板数据完整） */
  requirePosition?: boolean;
  /** 仅拉取某负责人名下楼宇（用于 update.html 的“我的楼宇”） */
  ownerUser?: string;
}): Promise<BuildingRow[]> {
  // 🚨 修复：使用数据库实际的字段名（移除 total_area，该字段不存在）
  const select =
    params?.select ??
    "id,name,district,submarket,completion_year,grade,leed_certification,location_lng,location_lat,owner,property_management,sort_order,leasable_area";

  console.log("🚨 [getBuildings] 开始执行, select:", select);

  // 关键修改：默认值改为 false，防止无经纬度的数据在 API 层被过滤
  const requirePosition = params?.requirePosition ?? false;

  if (params?.ownerUser) {
    console.warn("[getBuildings] ownerUser is deprecated; assignments define ownership");
  }
  const data = await readPagedRows<Record<string, any>>((from, to) => {
    let query = supabase.from("buildings").select(select)
      .eq("is_active", true).eq("tracking_scope", "tracked");
    if (requirePosition) query = query.not("location_lng", "is", null).not("location_lat", "is", null);
    return query.order("id").range(from, to);
  });

  const result = data.map((b: any) => ({
    id: b.id,
    name: b.name,
    district: b.district,
    submarket: b.submarket, // 🔥 新增：映射 submarket 字段
    sort_order: b.sort_order ?? 0,
    built_year: b.completion_year?.toString() || null,
    grade: b.grade,
    leed: b.leed_certification,
    lng: b.location_lng,
    lat: b.location_lat,
    owner: b.owner,
    landlord: b.owner, // 兼容旧字段名
    property_management: b.property_management,
    // total_area 优先从 building_metrics 获取，无历史数据时回退到 buildings.leasable_area
    total_area: b.leasable_area ?? null,
    owner_user: null, // 已废弃
    net_effective_rent: null,
    vacancy_rate: null,
    vacancy_area: null,
  })) as unknown as BuildingRow[];

  console.log("🚨 [getBuildings] 映射完成，返回", result.length, "条记录");
  if (result.length > 0) {
    console.log("🚨 [getBuildings] 第一条记录示例:", result[0]);
  }
  return result;
}

/**
 * 获取楼宇指标（用于图表/报表/季度填报参考）。
 *
 * 默认读取 `building_metrics` 表/视图。
 */
export async function getBuildingMetrics(params?: {
  buildingId?: string;
  /** 若你的指标表有时间字段，可用它筛选 */
  asOf?: string;
  select?: string;
}): Promise<BuildingMetricsRow[]> {
  const select =
    params?.select ??
    "building_id,net_effective_rent,vacancy_rate,vacancy_area,total_area,prev_net_effective_rent,prev_vacancy_rate,prev_vacancy_area,as_of";

  let q = supabase.from("building_metrics").select(select);
  if (params?.buildingId) q = q.eq("building_id", params.buildingId);
  if (params?.asOf) q = q.eq("as_of", params.asOf);

  const { data, error } = await q;
  assertNoError(error as any, "getBuildingMetrics 查询失败");
  if (!data) return [];
  return data as unknown as BuildingMetricsRow[];
}

/**
 * 🌟 新增：获取楼宇及其关联的季度指标数据（用于 BI 看板）
 *
 * 此函数执行联合查询，返回包含 building_metrics 嵌套数据的楼宇列表
 *
 * ✅ 修复（2026-04-27）：
 * - 移除季度限制，返回所有可用数据（前端自行筛选）
 * - 使用 left join 而非 inner join，避免丢失没有 metrics 的楼宇
 * - 添加详细的错误日志和降级处理
 *
 * @returns 包含 building_metrics 数组的楼宇数据
 */
export async function getBuildingsWithMetrics(): Promise<any[]> {
  console.log(`📊 [getBuildingsWithMetrics] 开始查询楼宇数据...`);
  console.log(
    `📊 [getBuildingsWithMetrics] 当前时间: ${new Date().toISOString()}`,
  );

  try {
    // 检查用户登录状态
    const {
      data: { session },
    } = await supabase.auth.getSession();
    console.log(
      `📊 [getBuildingsWithMetrics] Session 状态: ${session ? "已登录" : "未登录"}`,
    );
    if (session) {
      console.log(`📊 [getBuildingsWithMetrics] 用户: ${session.user?.email}`);
    }

    const { data, error } = await supabase
      .from("buildings")
      .select(
        `
        id,
        name,
        district,
        submarket,
        grade,
        city,
        location_lng,
        location_lat,
        completion_year,
        leed_certification,
        owner,
        property_management,
        building_metrics (
          id,
          building_id,
          total_area,
          asking_rent,
          management_fee,
          face_rent,
          rent_free_period,
          net_effective_rent,
          vacancy_rate,
          vacant_area,
          record_year,
          record_quarter
        )
      `,
      )
      .order("record_year", {
        foreignTable: "building_metrics",
        ascending: false,
      })
      .order("record_quarter", {
        foreignTable: "building_metrics",
        ascending: false,
      })
      .eq("is_active", true)
      .eq("tracking_scope", "tracked");

    if (error) {
      console.error("❌ [getBuildingsWithMetrics] 查询失败:", error);
      console.error("   错误详情:", {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });
      throw new Error(`数据库查询失败: ${error.message}`);
    }

    if (!data) {
      console.warn("⚠️ [getBuildingsWithMetrics] 返回空数据");
      return [];
    }

    console.log(
      `✅ [getBuildingsWithMetrics] 查询成功，返回 ${data.length} 个楼宇`,
    );

    // 统计有 metrics 数据的楼宇数量
    const buildingsWithMetrics = data.filter(
      (b) => b.building_metrics && b.building_metrics.length > 0,
    );
    console.log(
      `📊 [getBuildingsWithMetrics] 其中 ${buildingsWithMetrics.length} 个楼宇有指标数据`,
    );

    if (buildingsWithMetrics.length === 0) {
      console.warn(
        "⚠️ [getBuildingsWithMetrics] 警告：所有楼宇都没有 metrics 数据",
      );
      console.warn("   可能原因：");
      console.warn("   1. building_metrics 表为空");
      console.warn("   2. RLS 策略阻止了 building_metrics 的访问");
      console.warn("   3. 外键关联配置错误");
    } else if (data.length > 0) {
      console.log(
        `📊 [getBuildingsWithMetrics] 数据样本:`,
        JSON.stringify(data[0], null, 2),
      );
    }

    // 🌟 如果 submarket 为空，使用 district 作为后备
    return data.map((building) => ({
      ...building,
      submarket: building.submarket || building.district || "其他",
    }));
  } catch (err: any) {
    console.error("❌ [getBuildingsWithMetrics] 异常:", err);
    console.error("   异常类型:", err?.constructor?.name);
    console.error("   异常堆栈:", err?.stack);
    throw err;
  }
}

// ─── 通知公告 ──────────────────────────────────────────────────────────────

export interface NoticeRow {
  id: string;
  content: string;
  is_active: boolean;
  updated_at: string;
  updated_by: string;
}

/**
 * 获取当前生效的最新一条公告（兼容旧调用）。
 */
export async function getLatestNotice(): Promise<NoticeRow | null> {
  const rows = await getAllActiveNotices();
  return rows[0] ?? null;
}

/**
 * 获取所有生效公告（最多3条），按发布时间升序排列（最早的在上）。
 */
export async function getAllActiveNotices(): Promise<NoticeRow[]> {
  const { data, error } = await supabase
    .from("notices")
    .select("*")
    .eq("is_active", true)
    .order("updated_at", { ascending: true })
    .limit(3);

  if (error) {
    console.warn("getAllActiveNotices 查询失败（静默降级）:", error.message);
    return [];
  }
  return (data ?? []) as NoticeRow[];
}

// ─── 会话管理和 API 拦截器 ──────────────────────────────────────────────────

/**
 * 处理会话失效：清除令牌并重定向到登录页
 */
function handleSessionInvalid(errorMessage: string): void {
  // 清除 Supabase 认证令牌
  supabase.auth.signOut().catch((err) => {
    console.error("清除令牌失败:", err);
  });

  // 显示提示消息
  if (typeof window !== "undefined") {
    alert(errorMessage);
    // 重定向到登录页
    window.location.href = "/login";
  }
}

/**
 * 创建带有响应拦截器的 fetch 包装器
 * 用于拦截 401 错误并处理会话失效
 */
export function createApiClient() {
  return {
    async fetch(url: string, options?: RequestInit): Promise<Response> {
      try {
        // 获取当前 session token
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const token = session?.access_token;

        const response = await fetch(url, {
          ...options,
          headers: withImpersonationHeaders({
            ...options?.headers,
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          }),
        });

        // 拦截 401 响应
        if (response.status === 401) {
          try {
            const data = await response.clone().json();

            // 检查是否为会话失效错误
            if (
              data.code === "SESSION_INVALID" ||
              data.error?.includes("其他设备登录")
            ) {
              handleSessionInvalid("该账号已在其他设备登录，请重新登录");
              throw new Error("SESSION_INVALID");
            } else if (
              data.code === "INVALID_TOKEN" ||
              data.code === "TOKEN_EXPIRED"
            ) {
              handleSessionInvalid("登录已过期，请重新登录");
              throw new Error("TOKEN_EXPIRED");
            }
          } catch (jsonError) {
            // JSON 解析失败，显示通用提示
            if (
              jsonError instanceof Error &&
              jsonError.message !== "SESSION_INVALID" &&
              jsonError.message !== "TOKEN_EXPIRED"
            ) {
              console.error("解析 401 响应失败:", jsonError);
            }
          }
        }

        return response;
      } catch (error) {
        // 网络错误：显示通用提示，不清除令牌
        if (error instanceof TypeError && error.message.includes("fetch")) {
          console.error("网络连接失败:", error);
          throw new Error("网络连接失败，请检查网络设置");
        }
        throw error;
      }
    },
  };
}

/**
 * 全局 API 客户端实例
 */
export const apiClient = createApiClient();

