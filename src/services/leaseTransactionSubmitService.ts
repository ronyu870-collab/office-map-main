/**
 * 租赁成交数据填报服务
 * @module services/leaseTransactionSubmitService
 * @description 提供租赁成交数据的填报、查询和进度追踪功能
 */

import { logAction } from "@/src/utils/audit";
import { withImpersonationHeaders } from "@/src/services/impersonationHeaders";

import { supabase } from "./supabaseClient";
import type {
  LeaseTransaction,
  DuplicateCheckResult,
  WeeklyProgress,
  SubmissionResult,
} from "../types/lease-transaction";
import {
  cleanNumericValue,
  cleanDistrict,
  cleanBuildingName,
} from "../utils/dataCleaners";
import { distance } from "fastest-levenshtein";

const MAX_LEASE_RENT_PER_SQM_MONTH = 1000;

function validateLeaseRentRange(
  value: number | null,
  label: "表面租金" | "有效租金",
): SubmissionResult | null {
  if (value !== null && value > MAX_LEASE_RENT_PER_SQM_MONTH) {
    return {
      success: false,
      error: `${label}不得超过 1000 元/㎡/月，请核对金额或单位后修改。`,
    };
  }

  return null;
}

function validateEffectiveRentNotAboveFaceRent(
  faceRent: number | null,
  effectiveRent: number | null,
): SubmissionResult | null {
  if (faceRent !== null && effectiveRent !== null && effectiveRent > faceRent) {
    return {
      success: false,
      error: "有效租金不能高于表面租金，请核对填写内容后修改。",
    };
  }

  return null;
}

/**
 * 计算字符串相似度（0-1，1 表示完全相同）
 * @param str1 字符串 1
 * @param str2 字符串 2
 * @returns 相似度（0-1）
 */
function calculateSimilarity(str1: string, str2: string): number {
  const maxLen = Math.max(str1.length, str2.length);
  if (maxLen === 0) return 1;
  const dist = distance(str1, str2);
  return 1 - dist / maxLen;
}

/**
 * 统一错误处理函数
 * @param error 原始错误对象
 * @param operation 操作名称，用于错误消息上下文
 * @throws Error 带有描述性消息的错误
 */
function handleError(error: unknown, operation: string): never {
  // Supabase 错误处理
  if (error && typeof error === "object" && "code" in error) {
    const supabaseError = error as { code: string; message?: string };
    switch (supabaseError.code) {
      case "PGRST301":
        throw new Error(`${operation}: 数据库连接超时，请稍后重试`);
      case "42501":
        throw new Error(`${operation}: 权限不足，请联系管理员`);
      case "23505":
        throw new Error(`${operation}: 记录已存在，请检查是否重复提交`);
      default:
        throw new Error(
          `${operation}: ${supabaseError.message || "数据库操作失败"}`,
        );
    }
  }

  // 网络错误处理
  if (error instanceof TypeError && error.message.includes("fetch")) {
    throw new Error(`${operation}: 网络连接失败，请检查网络设置`);
  }

  // 通用错误处理
  const message = error instanceof Error ? error.message : "未知错误";
  throw new Error(`${operation}: ${message}`);
}

/**
 * 检测重复成交记录（已废弃，使用 checkFuzzyDuplicate 代替）
 * @deprecated 使用 checkFuzzyDuplicate 代替
 */
export async function checkDuplicate(
  company: string,
  building: string,
  quarter: string,
): Promise<DuplicateCheckResult> {
  console.warn("⚠️ checkDuplicate 已废弃，请使用 checkFuzzyDuplicate");
  return checkFuzzyDuplicate(company, building, 0, quarter);
}

/**
 * 模糊检测重复成交记录（使用简单查询，不依赖 RPC）
 * @param company 企业名称
 * @param building 楼宇名称
 * @param area 成交面积（㎡）
 * @param quarter 季度（Q1-Q4）
 * @param excludeId 可选：排除的记录 ID（用于编辑模式，避免"自己撞自己"）
 * @param year 可选：成交年份。主填报流程会传入，用于避免跨年度误判重复。
 * @returns 重复检测结果，包含是否存在重复及重复记录列表
 */
export async function checkFuzzyDuplicate(
  company: string,
  building: string,
  area: number,
  quarter: string,
  excludeId?: string,
  year?: number,
): Promise<DuplicateCheckResult> {
  // 参数验证
  if (!company || !company.trim()) {
    console.error("❌ [检测] 参数错误: 企业名称为空");
    return { hasDuplicate: false, duplicates: [] };
  }
  if (!building || !building.trim()) {
    console.error("❌ [检测] 参数错误: 楼宇名称为空");
    return { hasDuplicate: false, duplicates: [] };
  }
  if (area === undefined || area === null || area <= 0) {
    console.error("❌ [检测] 参数错误: 成交面积无效", area);
    return { hasDuplicate: false, duplicates: [] };
  }
  if (!quarter || !quarter.trim()) {
    console.error("❌ [检测] 参数错误: 季度为空");
    return { hasDuplicate: false, duplicates: [] };
  }
  if (year !== undefined && (!Number.isInteger(year) || year <= 0)) {
    console.error("❌ [检测] 参数错误: 成交年份无效", year);
    return { hasDuplicate: false, duplicates: [] };
  }

  try {
    console.log("🔍 [检测] 开始检测重复记录（使用简单查询）");
    console.log("   - 企业:", company.trim());
    console.log("   - 楼宇:", building.trim());
    console.log("   - 面积:", area);
    console.log("   - 年份:", year ?? "未限定");
    console.log("   - 季度:", quarter.trim());
    console.log("   - 排除ID:", excludeId || "无");

    // 🔥 使用简单的 Supabase 查询，不依赖 RPC 函数
    // 匹配规则：
    // 1. 楼宇名称完全匹配
    // 2. 企业名称包含匹配（使用 ilike）
    // 3. 面积双向 ±50% 范围（见下方前端过滤逻辑）
    // 4. 成交年份和季度匹配（主填报流程传入年份；旧调用保持向后兼容）

    // 🔥 修复：使用更宽松的面积范围查询，然后在前端进行双向匹配
    // 原因：数据库查询只能做单向范围过滤，双向匹配需要在前端实现
    // 策略：查询时使用最小可能范围（输入面积的 33.3% 到 300%），确保不遗漏任何可能匹配的记录
    // 例如：输入 250，历史记录 500
    //   - 单向匹配：250 的 ±50% = 125-375（不包含 500 ❌）
    //   - 双向匹配：500 的 ±50% = 250-750（包含 250 ✅）
    //   - 因此查询范围需要扩大到能覆盖所有可能的双向匹配
    const areaMin = area * 0.333; // 输入面积的 1/3（确保能匹配到"历史记录是输入面积 1.5 倍"的情况）
    const areaMax = area * 3.0; // 输入面积的 3 倍（确保能匹配到"历史记录是输入面积 0.5 倍"的情况）

    let query = supabase
      .from("lease_transactions")
      .select(
        "id, company, new_building, area_sqm, transaction_year, transaction_quarter, transaction_date, submitter_name, submitter_id, created_at",
      )
      .eq("new_building", building.trim())
      .eq("transaction_quarter", quarter.trim());

    if (year !== undefined) {
      query = query.eq("transaction_year", year);
    }

    query = query
      .gte("area_sqm", areaMin)
      .lte("area_sqm", areaMax)
      .not("area_sqm", "is", null)
      .order("created_at", { ascending: false })
      .limit(50);

    // 🔥 编辑模式：排除当前记录
    if (excludeId) {
      query = query.neq("id", excludeId);
    }

    const { data, error } = await query;

    if (error) {
      console.error("❌ [检测] 查询失败:", error);
      console.warn("⚠️ [检测] 检测失败，但不阻止提交");
      return {
        hasDuplicate: false,
        duplicates: [],
      };
    }

    console.log("✅ [检测] 查询返回:", data ? `${data.length} 条` : "null");

    // 🔥 在前端进行双向过滤：面积匹配 + 企业名称匹配
    const companyLower = company.trim().toLowerCase();
    const SIMILARITY_THRESHOLD = 0.5; // 相似度阈值 50%

    const filteredData = (data || []).filter((row) => {
      // ========== 步骤 1：面积双向匹配 ==========
      const rowArea = row.area_sqm;
      if (!rowArea || rowArea <= 0) return false;

      // 双向匹配逻辑：
      // 条件 A：新输入的面积在历史记录的 ±50% 范围内
      const rowAreaMin = rowArea * 0.5;
      const rowAreaMax = rowArea * 1.5;
      const isInputInHistoryRange = area >= rowAreaMin && area <= rowAreaMax;

      // 条件 B：历史记录的面积在新输入的 ±50% 范围内
      const inputAreaMin = area * 0.5;
      const inputAreaMax = area * 1.5;
      const isHistoryInInputRange =
        rowArea >= inputAreaMin && rowArea <= inputAreaMax;

      // 满足任一条件即匹配
      const areaMatches = isInputInHistoryRange || isHistoryInInputRange;

      if (!areaMatches) return false;

      // ========== 步骤 2：企业名称双向匹配 ==========
      const rowCompanyLower = (row.company || "").toLowerCase();

      // 策略 1：双向包含匹配
      const hasInclusion =
        rowCompanyLower.includes(companyLower) ||
        companyLower.includes(rowCompanyLower);

      // 策略 2：双向相似度匹配（防止手误）
      const similarity = calculateSimilarity(companyLower, rowCompanyLower);
      const isSimilar = similarity >= SIMILARITY_THRESHOLD;

      const companyMatches = hasInclusion || isSimilar;

      // 🔥 调试日志：记录匹配详情
      if (companyMatches) {
        console.log("🔍 [撞车匹配]");
        console.log("   - 楼宇:", building.trim());
        console.log("   - 年份:", row.transaction_year);
        console.log("   - 季度:", quarter.trim());
        console.log("   - 面积匹配:");
        console.log("     • 用户输入:", area, "㎡");
        console.log("     • 历史记录:", rowArea, "㎡");
        console.log(
          "     • 输入在历史范围内 [",
          rowAreaMin.toFixed(0),
          "-",
          rowAreaMax.toFixed(0),
          "]:",
          isInputInHistoryRange ? "✅ 是" : "❌ 否",
        );
        console.log(
          "     • 历史在输入范围内 [",
          inputAreaMin.toFixed(0),
          "-",
          inputAreaMax.toFixed(0),
          "]:",
          isHistoryInInputRange ? "✅ 是" : "❌ 否",
        );
        console.log("   - 企业名称匹配:");
        console.log("     • 用户输入:", companyLower);
        console.log("     • 历史记录:", rowCompanyLower);
        console.log("     • 包含匹配:", hasInclusion ? "✅ 是" : "❌ 否");
        console.log(
          "     • 相似度:",
          (similarity * 100).toFixed(1) + "%",
          isSimilar ? "✅ 达到阈值" : "❌ 未达到阈值",
        );
        console.log(
          "     • 匹配策略:",
          hasInclusion ? "包含匹配" : "相似度匹配",
        );
      }

      return companyMatches;
    });

    console.log("🔍 [检测] 双向过滤后:", filteredData.length, "条");

    const duplicates: LeaseTransaction[] = filteredData.map((row) => ({
      id: row.id,
      company: row.company,
      new_building: row.new_building,
      transaction_year: row.transaction_year ?? year ?? 0,
      transaction_quarter: row.transaction_quarter,
      transaction_date: row.transaction_date,
      area_sqm: row.area_sqm,
      submitter_name: row.submitter_name,
      submitter_id: row.submitter_id,
      created_at: row.created_at,
      // 其他字段设为默认值
      suspected_company_fullname: null,
      enterprise_type: null,
      industry: null,
      sub_industry: null,
      demand_type: null,
      sub_market: null,
      district: null,
      building_grade: null,
      old_address: null,
      old_sub_market: null,
      old_building_grade: null,
      face_rent: null,
      lease_term_months: null,
      fit_out_months: null,
      rent_free_months: null,
      effective_rent: null,
      remarks: null,
    }));

    console.log(
      "🔍 [检测] 最终结果:",
      duplicates.length > 0 ? `发现 ${duplicates.length} 条相似记录` : "无重复",
    );

    return {
      hasDuplicate: duplicates.length > 0,
      duplicates,
    };
  } catch (error) {
    console.error("❌ [检测] 发生异常:", error);
    console.warn("⚠️ [检测] 检测异常，但不阻止提交");
    return {
      hasDuplicate: false,
      duplicates: [],
    };
  }
}

/**
 * 提交租赁成交记录
 * @param transaction 成交记录数据
 * @returns 提交结果，包含成功状态、插入的数据或错误信息
 * @throws Error 当发生未预期的错误时
 * @example
 * const result = await submitTransaction({
 *   company: '测试公司',
 *   new_building: '测试楼宇',
 *   transaction_year: 2024,
 *   transaction_quarter: '2024Q1',
 *   submitter_id: 'user-123',
 *   submitter_name: '测试用户',
 * });
 */
export async function submitTransaction(
  transaction: LeaseTransaction,
): Promise<SubmissionResult> {
  try {
    // ========== 必填字段验证 ==========
    const requiredFields: (keyof LeaseTransaction)[] = [
      "company",
      "new_building",
      "transaction_year",
      "transaction_quarter",
      "submitter_id",
      "submitter_name",
    ];

    for (const field of requiredFields) {
      const value = transaction[field];
      if (value === undefined || value === null || value === "") {
        return {
          success: false,
          error: `缺少必填字段: ${field}`,
        };
      }
    }

    // ========== 数据清洗 ==========
    // 清洗数值字段（移除单位符号）
    const cleanedAreaSqm = cleanNumericValue(transaction.area_sqm);
    const cleanedFaceRent = cleanNumericValue(transaction.face_rent);
    const cleanedLeaseTermMonths = cleanNumericValue(
      transaction.lease_term_months,
    );
    const cleanedFitOutMonths = cleanNumericValue(transaction.fit_out_months);
    const cleanedRentFreeMonths = cleanNumericValue(
      transaction.rent_free_months,
    );
    const cleanedEffectiveRent = cleanNumericValue(transaction.effective_rent);

    // 清洗行政区字段（移除"北京市"前缀）
    const cleanedDistrict = cleanDistrict(transaction.district);

    // 清洗楼宇名称
    const cleanedBuildingName = cleanBuildingName(transaction.new_building);
    if (!cleanedBuildingName) {
      return {
        success: false,
        error: "楼宇名称无效",
      };
    }

    // ========== 数值字段验证 ==========
    const numericFields: Array<{
      key: keyof LeaseTransaction;
      value: number | null;
      label: string;
    }> = [
      { key: "area_sqm", value: cleanedAreaSqm, label: "成交面积" },
      { key: "face_rent", value: cleanedFaceRent, label: "面价" },
      {
        key: "lease_term_months",
        value: cleanedLeaseTermMonths,
        label: "租期",
      },
      { key: "fit_out_months", value: cleanedFitOutMonths, label: "装修期" },
      {
        key: "rent_free_months",
        value: cleanedRentFreeMonths,
        label: "免租期",
      },
      { key: "effective_rent", value: cleanedEffectiveRent, label: "有效租金" },
    ];

    for (const field of numericFields) {
      const originalValue = transaction[field.key];
      if (
        originalValue !== undefined &&
        originalValue !== null &&
        originalValue !== ""
      ) {
        if (field.value === null) {
          return {
            success: false,
            error: `${field.label}格式错误，请输入有效数字（不要包含单位符号）`,
          };
        }
        // 边界校验
        if (field.value < 0) {
          return {
            success: false,
            error: `${field.label}不能为负数`,
          };
        }
      }
    }

    const faceRentRangeError = validateLeaseRentRange(cleanedFaceRent, "表面租金");
    if (faceRentRangeError) return faceRentRangeError;

    const effectiveRentRangeError = validateLeaseRentRange(cleanedEffectiveRent, "有效租金");
    if (effectiveRentRangeError) return effectiveRentRangeError;

    const rentRelationshipError = validateEffectiveRentNotAboveFaceRent(
      cleanedFaceRent,
      cleanedEffectiveRent,
    );
    if (rentRelationshipError) return rentRelationshipError;

    // ========== 季度格式校验 ==========
    const quarter = transaction.transaction_quarter;
    // 标准化：如果是完整格式（2024Q1），提取 Q1-Q4 部分
    let normalizedQuarter = quarter;
    if (quarter && quarter.match(/^\d{4}(Q[1-4])$/)) {
      normalizedQuarter = quarter.substring(4);
    }
    if (normalizedQuarter && !normalizedQuarter.match(/^Q[1-4]$/)) {
      return {
        success: false,
        error: "成交季度格式错误，请使用 Q1-Q4 格式",
      };
    }

    // ========== 可租赁面积验证（CL-019） ==========
    if (
      !transaction.is_manual_building &&
      cleanedBuildingName &&
      cleanedAreaSqm &&
      cleanedAreaSqm > 0
    ) {
      const { data: buildingRow } = await supabase
        .from("buildings")
        .select("leasable_area")
        .ilike("name", cleanedBuildingName)
        .eq("is_active", true)
        .eq("tracking_scope", "tracked")
        .limit(1)
        .maybeSingle();

      if (buildingRow?.leasable_area && buildingRow.leasable_area > 0) {
        if (cleanedAreaSqm > buildingRow.leasable_area) {
          return {
            success: false,
            error: `租赁面积 ${cleanedAreaSqm} ㎡ 超过该楼宇的可租赁面积 ${buildingRow.leasable_area} ㎡`,
          };
        }
      }
    }

    // ========== 插入数据库 ==========
    const { data, error } = await supabase
      .from("lease_transactions")
      .insert({
        company: transaction.company,
        suspected_company_fullname:
          transaction.suspected_company_fullname || null,
        enterprise_type: transaction.enterprise_type || null,
        industry: transaction.industry || null,
        sub_industry: transaction.sub_industry || null,
        demand_type: transaction.demand_type || null,
        relocation_area_change: transaction.relocation_area_change || null,
        new_building: cleanedBuildingName,
        floor_info: transaction.floor_info || null,
        floor: transaction.floor || null,
        sub_market: transaction.sub_market || null,
        district: cleanedDistrict,
        building_grade: transaction.building_grade || null,
        old_address: transaction.old_address || null,
        old_district: transaction.old_district || null,
        old_sub_market: transaction.old_sub_market || null,
        old_building_grade: transaction.old_building_grade || null,
        area_sqm: cleanedAreaSqm,
        face_rent: cleanedFaceRent,
        lease_term_months: cleanedLeaseTermMonths,
        fit_out_months: cleanedFitOutMonths,
        rent_free_months: cleanedRentFreeMonths,
        effective_rent: cleanedEffectiveRent,
        transaction_date: null, // 🔥 设为 null
        transaction_year: transaction.transaction_year,
        transaction_quarter: normalizedQuarter,
        remarks: transaction.remarks || null,
        submitter_id: transaction.submitter_id,
        submitter_name: transaction.submitter_name,
        original_submitter_id: transaction.submitter_id,
        original_submitter_name: transaction.submitter_name,
      })
      .select()
      .single();

    if (error) {
      // 🔥 移除唯一索引冲突检测（已从数据库移除约束）
      return {
        success: false,
        error: `数据库插入失败: ${error.message}`,
      };
    }

    logAction(transaction.submitter_id || '', 'SUBMIT_LEASE_TRANSACTION', {
      company: transaction.company,
      building: cleanedBuildingName,
      year: transaction.transaction_year,
      quarter: transaction.transaction_quarter,
    });

    return {
      success: true,
      data: data as LeaseTransaction,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return {
      success: false,
      error: `提交成交记录时发生错误: ${message}`,
    };
  }
}

/**
 * 获取当前用户的提交历史
 * @param userId 用户 ID
 * @returns 提交记录列表，按创建时间倒序排列
 * @throws Error 当用户 ID 缺失或数据库查询失败时
 * @example
 * const submissions = await getMySubmissions('user-123');
 * console.log(`共有 ${submissions.length} 条提交记录`);
 */
export async function getMySubmissions(
  userId: string,
): Promise<LeaseTransaction[]> {
  // 参数验证
  if (!userId || !userId.trim()) {
    throw new Error("用户 ID 为必填参数");
  }
  try {
    const { data, error } = await supabase
      .from("lease_transactions")
      .select("*")
      .eq("submitter_id", userId.trim())
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      handleError(error, "查询提交历史失败");
    }

    return (data || []) as LeaseTransaction[];
  } catch (error) {
    // 如果已经被 handleError 处理过，直接抛出
    if (error instanceof Error) {
      throw error;
    }
    handleError(error, "获取提交历史时发生错误");
  }
}

/**
 * 获取团队的提交历史（仅限 Editor 和 Admin）
 * @param userRole 用户角色
 * @returns 所有提交记录列表（仅包含 2026-04-23 之后的数据），按创建时间倒序排列
 * @throws Error 当权限不足或数据库查询失败时
 * @example
 * const submissions = await getAllSubmissions('executive');
 * console.log(`系统共有 ${submissions.length} 条提交记录`);
 */
export async function getLeaseTeamAccess(): Promise<boolean> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('未登录，无法读取团队成交权限');

  const response = await fetch('/api/lease-submission/team-submissions?access=1', {
    headers: withImpersonationHeaders({ Authorization: `Bearer ${token}` }),
    cache: 'no-store',
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || '读取团队成交权限失败');
  return body.canViewTeamSubmissions === true;
}

export async function getAllSubmissions(
  userRole: string,
): Promise<LeaseTransaction[]> {
  // 参数验证
  if (!userRole || !userRole.trim()) {
    throw new Error("用户角色为必填参数");
  }
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      throw new Error("未登录，无法获取团队提交记录");
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25_000);
    let response: Response;
    try {
      response = await fetch("/api/lease-submission/team-submissions", {
        headers: withImpersonationHeaders({ Authorization: `Bearer ${token}` }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error("团队成交数据请求超时，请稍后重试");
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error || "查询所有提交记录失败");
    }

    return (body.submissions || []) as LeaseTransaction[];
  } catch (error) {
    // 如果已经被 handleError 处理过，直接抛出
    if (error instanceof Error) {
      throw error;
    }
    handleError(error, "获取所有提交记录时发生错误");
  }
}

/**
 * 获取所有业务员列表（不包括 admin 和 executive）
 * @returns 业务员列表，包含 user_id 和姓名
 * @throws Error 当数据库查询失败时
 * @example
 * const brokers = await getAllBrokers();
 * console.log(`共有 ${brokers.length} 位业务员`);
 */
export async function getAllBrokers(): Promise<
  Array<{ user_id: string; name: string }>
> {
  try {
    // 获取当前用户的 access_token
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;

    if (!token) {
      throw new Error("未登录，无法获取业务员列表");
    }

    // 通过 API route 查询（使用 service_role key 绕过 RLS）
    const res = await fetch("/api/brokers", {
      headers: withImpersonationHeaders({ Authorization: `Bearer ${token}` }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "查询业务员列表失败");
    }

    const { brokers } = await res.json();
    return brokers || [];
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    handleError(error, "获取业务员列表时发生错误");
  }
}

/**
 * 更新租赁成交记录
 * @param id 记录 ID
 * @param transaction 更新的数据
 * @param userId 当前用户 ID（用于权限校验）
 * @returns 更新结果，包含成功状态、更新后的数据或错误信息
 * @throws Error 当发生未预期的错误时
 * @example
 * const result = await updateTransaction('record-id', {
 *   company: '更新后的公司名',
 *   area_sqm: 1000,
 * }, 'user-123');
 */
export async function updateTransaction(
  id: string,
  transaction: Partial<LeaseTransaction>,
  userId: string,
  expectedUpdatedAt?: string,
): Promise<SubmissionResult> {
  console.log("🚀🚀🚀 [DEBUG] updateTransaction 函数被调用了！");
  console.log("   - ID:", id);
  console.log("   - userId:", userId);
  console.log("   - transaction:", transaction);

  try {
    // ========== 参数验证 ==========
    if (!id || !id.trim()) {
      console.error("❌ [参数验证] 记录 ID 为空");
      return {
        success: false,
        error: "记录 ID 不能为空",
      };
    }

    if (!userId || !userId.trim()) {
      console.error("❌ [参数验证] 用户 ID 为空");
      return {
        success: false,
        error: "用户 ID 不能为空",
      };
    }

    // 🔥 新增：确保 Supabase 客户端有 Session
    console.log("🔍 [Session 检查] 开始检查用户登录状态");
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError) {
      console.error("❌ [Session 检查] 获取 Session 失败:", sessionError);
      return {
        success: false,
        error: "获取用户登录状态失败，请重新登录后再试",
      };
    }

    if (!session) {
      console.error("❌ [Session 检查] Session 为空，用户未登录");
      return {
        success: false,
        error: "用户未登录，请重新登录后再试",
      };
    }

    console.log("✅ [Session 检查] 用户已登录");
    console.log("   - Session 用户 ID:", session.user.id);
    console.log("   - 传入的 userId:", userId);

    // 🔥 验证：传入的 userId 是否与 Session 中的用户 ID 一致
    if (session.user.id !== userId) {
      console.error("❌ [Session 检查] 用户 ID 不匹配");
      console.error("   - Session 用户 ID:", session.user.id);
      console.error("   - 传入的 userId:", userId);
      return {
        success: false,
        error: "用户身份验证失败，请重新登录",
      };
    }

    // ========== 权限校验 ==========
    // 查询用户角色（Admin 可编辑所有记录）
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId.trim())
      .single();

    const isAdmin = roleRow?.role === "admin";

    const { data: existing, error: fetchError } = await supabase
      .from("lease_transactions")
      .select("submitter_id, face_rent, effective_rent, new_building, updated_at")
      .eq("id", id.trim())
      .single();

    if (fetchError) {
      return {
        success: false,
        error: `查询记录失败: ${fetchError.message}`,
      };
    }

    if (!existing) {
      return {
        success: false,
        error: "记录不存在",
      };
    }

    if (!isAdmin && existing.submitter_id !== userId.trim()) {
      return {
        success: false,
        error: "无权编辑此记录",
      };
    }

    if (expectedUpdatedAt && existing.updated_at && existing.updated_at !== expectedUpdatedAt) {
      return {
        success: false,
        error: "该记录已被其他人修改，请返回列表刷新后重新编辑，避免覆盖最新数据。",
      };
    }

    // ========== 数据清洗 ==========
    const cleanedData: Record<string, any> = {};

    // 清洗数值字段
    if (transaction.area_sqm !== undefined) {
      const cleaned = cleanNumericValue(transaction.area_sqm);
      if (cleaned === null && transaction.area_sqm !== null) {
        return { success: false, error: "成交面积格式错误" };
      }
      cleanedData.area_sqm = cleaned;
    }

    if (transaction.face_rent !== undefined) {
      const cleaned = cleanNumericValue(transaction.face_rent);
      if (cleaned === null && transaction.face_rent !== null) {
        return { success: false, error: "面价格式错误" };
      }
      cleanedData.face_rent = cleaned;
    }

    if (transaction.effective_rent !== undefined) {
      const cleaned = cleanNumericValue(transaction.effective_rent);
      if (cleaned === null && transaction.effective_rent !== null) {
        return { success: false, error: "有效租金格式错误" };
      }
      cleanedData.effective_rent = cleaned;
    }

    const faceRentRangeError = validateLeaseRentRange(
      cleanedData.face_rent ?? null,
      "表面租金",
    );
    if (faceRentRangeError) return faceRentRangeError;

    const effectiveRentRangeError = validateLeaseRentRange(
      cleanedData.effective_rent ?? null,
      "有效租金",
    );
    if (effectiveRentRangeError) return effectiveRentRangeError;

    const nextFaceRent = transaction.face_rent !== undefined
      ? cleanedData.face_rent
      : existing.face_rent;
    const nextEffectiveRent = transaction.effective_rent !== undefined
      ? cleanedData.effective_rent
      : existing.effective_rent;
    const rentRelationshipError = validateEffectiveRentNotAboveFaceRent(
      nextFaceRent,
      nextEffectiveRent,
    );
    if (rentRelationshipError) return rentRelationshipError;

    if (transaction.lease_term_months !== undefined) {
      const cleaned = cleanNumericValue(transaction.lease_term_months);
      cleanedData.lease_term_months = cleaned;
    }

    if (transaction.fit_out_months !== undefined) {
      const cleaned = cleanNumericValue(transaction.fit_out_months);
      cleanedData.fit_out_months = cleaned;
    }

    if (transaction.rent_free_months !== undefined) {
      const cleaned = cleanNumericValue(transaction.rent_free_months);
      cleanedData.rent_free_months = cleaned;
    }

    // 清洗行政区字段
    if (transaction.district !== undefined) {
      cleanedData.district = cleanDistrict(transaction.district);
    }

    // 清洗楼宇名称
    if (transaction.new_building !== undefined) {
      const cleaned = cleanBuildingName(transaction.new_building);
      if (!cleaned) {
        return { success: false, error: "楼宇名称无效" };
      }
      cleanedData.new_building = cleaned;
    }

    // 其他字段直接复制
    const simpleFields = [
      "company",
      "suspected_company_fullname",
      "enterprise_type",
      "industry",
      "sub_industry",
      "demand_type",
      "relocation_area_change",
      "sub_market",
      "building_grade",
      "floor_info",
      "floor",
      "old_address",
      "old_district",
      "old_sub_market",
      "old_building_grade",
      "transaction_date",
      "transaction_year",
      "transaction_quarter",
      "is_face_rent_estimated",
      "is_effective_rent_estimated",
      "remarks",
    ];

    for (const field of simpleFields) {
      if (transaction[field as keyof LeaseTransaction] !== undefined) {
        cleanedData[field] =
          transaction[field as keyof LeaseTransaction] ?? null;
      }
    }

    // ========== 季度格式标准化 ==========
    if (cleanedData.transaction_quarter) {
      const q = cleanedData.transaction_quarter;
      if (q.match(/^\d{4}(Q[1-4])$/)) {
        cleanedData.transaction_quarter = q.substring(4);
      }
      if (!cleanedData.transaction_quarter.match(/^Q[1-4]$/)) {
        return { success: false, error: "成交季度格式错误，请使用 Q1-Q4 格式" };
      }
    }

    // ========== 可租赁面积验证（CL-019） ==========
    if (cleanedData.new_building || cleanedData.area_sqm) {
      const buildingToCheck = cleanedData.new_building || existing.new_building;
      const areaToCheck = cleanedData.area_sqm;

      if (
        buildingToCheck &&
        areaToCheck &&
        areaToCheck > 0 &&
        transaction.is_manual_building !== true
      ) {
        const { data: buildingRow } = await supabase
          .from("buildings")
          .select("leasable_area")
          .ilike("name", buildingToCheck)
          .eq("is_active", true)
          .eq("tracking_scope", "tracked")
          .limit(1)
          .maybeSingle();

        if (buildingRow?.leasable_area && buildingRow.leasable_area > 0) {
          if (areaToCheck > buildingRow.leasable_area) {
            return {
              success: false,
              error: `租赁面积 ${areaToCheck} ㎡ 超过该楼宇的可租赁面积 ${buildingRow.leasable_area} ㎡`,
            };
          }
        }
      }
    }

    // ========== 执行更新 ==========
    console.log("🔍 [更新记录] 开始更新");
    console.log("   - ID:", id.trim());
    console.log("   - ID 类型:", typeof id);
    console.log("   - 用户 ID:", userId.trim());
    console.log("   - 更新数据:", JSON.stringify(cleanedData, null, 2));

    let updateQuery = supabase
      .from("lease_transactions")
      .update(cleanedData)
      .eq("id", id.trim());

    if (expectedUpdatedAt) {
      updateQuery = updateQuery.eq("updated_at", expectedUpdatedAt);
    }

    const { data, error } = await updateQuery.select();

    console.log("🔍 [更新结果]");
    console.log("   - error:", error);
    console.log("   - data:", data);
    console.log("   - data 类型:", typeof data);
    console.log("   - data 长度:", data ? data.length : "null");

    if (error) {
      console.error("❌ [更新失败] Supabase 错误:", error);
      return {
        success: false,
        error: `数据库更新失败: ${error.message}`,
      };
    }

    // 🔥 修复：检查返回的数据
    if (!data || data.length === 0) {
      console.error("❌ [更新失败] 返回数据为空");
      console.error("   - 可能原因 1: ID 不存在");
      console.error("   - 可能原因 2: RLS 策略阻止了更新");
      console.error("   - 可能原因 3: 记录在编辑期间已被其他用户更新");
      return {
        success: false,
        error: expectedUpdatedAt
          ? "该记录已被其他人修改，请返回列表刷新后重新编辑，避免覆盖最新数据。"
          : "更新失败：未找到匹配的记录",
      };
    }

    if (data.length > 1) {
      console.warn("⚠️ [警告] 更新了多条记录:", data.length);
    }

    console.log("✅ [更新成功] 返回数据:", data[0]);

    return {
      success: true,
      data: data[0] as LeaseTransaction,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return {
      success: false,
      error: `更新成交记录时发生错误: ${message}`,
    };
  }
}

/**
 * 获取当前用户的周进度
 * @param userId 用户 ID
 * @returns 周进度数据，包含已提交数量、目标数量和完成百分比
 * @throws Error 当用户 ID 缺失或数据库查询失败时
 * @example
 * const progress = await getWeeklyProgress('user-123');
 * console.log(`本周进度: ${progress.percentage}%`);
 */
export async function getWeeklyProgress(
  userId: string,
): Promise<WeeklyProgress> {
  // 参数验证
  if (!userId || !userId.trim()) {
    throw new Error("用户 ID 为必填参数");
  }
  try {
    // ========== 计算本周起止时间（周一至周日） ==========
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 (周日) 到 6 (周六)

    // 计算本周一（周一为一周的开始）
    // 如果今天是周日(0)，则周一在 6 天前；否则周一距离今天 (1 - dayOfWeek) 天
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() + mondayOffset);
    weekStart.setHours(0, 0, 0, 0);

    // 计算本周日（周日为一周的结束）
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    // ========== 查询本周提交数 ==========
    const { count, error } = await supabase
      .from("lease_transactions")
      .select("*", { count: "exact", head: true })
      .eq("submitter_id", userId.trim())
      .gte("created_at", weekStart.toISOString())
      .lte("created_at", weekEnd.toISOString());

    if (error) {
      handleError(error, "查询周进度失败");
    }

    const submittedCount = count || 0;
    const targetCount = 2;
    const percentage = Math.min(
      100,
      Math.round((submittedCount / targetCount) * 100),
    );

    return {
      submittedCount,
      targetCount,
      percentage,
    };
  } catch (error) {
    // 如果已经被 handleError 处理过，直接抛出
    if (error instanceof Error) {
      throw error;
    }
    handleError(error, "获取周进度时发生错误");
  }
}
