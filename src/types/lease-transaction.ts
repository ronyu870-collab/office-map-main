/**
 * 租赁成交填报类型定义
 * @module types/lease-transaction
 * @description 定义租赁成交数据填报相关的 TypeScript 接口和类型
 */

/**
 * 租赁成交填报数据接口
 * @description 用于填报的租赁成交记录结构
 */
export interface LeaseTransaction {
  // ========== 主键 ==========
  /**
   * 主键 ID
   * @description 提交时由数据库生成
   */
  id?: string;

  // ========== 企业信息 ==========
  /**
   * 企业名称
   * @description 必填字段
   */
  company: string;

  /**
   * 疑似企业全称
   * @description 可选字段，用于记录企业的完整名称
   */
  suspected_company_fullname?: string | null;

  /**
   * 企业类型
   * @description 可选字段，如：国企、外企、民企等
   */
  enterprise_type?: string | null;

  /**
   * 所属行业
   * @description 可选字段，企业所属的行业分类
   */
  industry?: string | null;

  /**
   * 所属子行业
   * @description 可选字段，企业所属的子行业分类
   */
  sub_industry?: string | null;

  /**
   * 需求类型
   * @description 可选字段，如：新租、扩租、搬迁、续租
   */
  demand_type?: string | null;

  /**
   * 搬迁面积变化
   * @description 可选字段，仅当需求类型为"搬迁"时填写
   */
  relocation_area_change?: string | null;

  /**
   * 手动填写楼宇模式
   * @description 可选字段，当楼宇库中找不到对应楼宇时，允许手动填写
   */
  is_manual_building?: boolean;

  // ========== 楼宇信息 ==========
  /**
   * 新楼宇名称
   * @description 必填字段，成交的楼宇名称
   */
  new_building: string;

  /**
   * 楼座
   * @description 可选字段，如：A座、B座、塔1
   */
  floor_info?: string | null;

  /**
   * 楼层
   * @description 可选字段，如：15
   */
  floor?: string | null;

  /**
   * 子市场
   * @description 可选字段，楼宇所在的子市场区域
   */
  sub_market?: string | null;

  /**
   * 区域
   * @description 可选字段，楼宇所在的行政区域
   */
  district?: string | null;

  /**
   * 楼宇等级
   * @description 可选字段，如：甲级、乙级等
   */
  building_grade?: string | null;

  // ========== 原址信息 ==========
  /**
   * 原地址
   * @description 可选字段，企业搬迁前的地址
   */
  old_address?: string | null;

  /**
   * 原子市场
   * @description 可选字段，企业搬迁前所在的子市场
   */
  old_sub_market?: string | null;

  /**
   * 原址区域
   * @description 可选字段，企业搬迁前所在的行政区域
   */
  old_district?: string | null;

  /**
   * 原楼宇等级
   * @description 可选字段，企业搬迁前所在楼宇的等级
   */
  old_building_grade?: string | null;

  /**
   * 手动填写原址楼宇模式
   * @description 可选字段，当楼宇库中找不到对应原址楼宇时，允许手动填写
   */
  is_manual_old_building?: boolean;

  // ========== 成交信息 ==========
  /**
   * 成交面积（平方米）
   * @description 可空字段，租赁成交的面积
   */
  area_sqm?: number | null;

  /**
   * 面价（元/㎡/月）
   * @description 可空字段，租赁的面价租金
   */
  face_rent?: number | null;

  /**
   * 表面租金是否为预估值
   * @description 可选字段，标记表面租金是否为预估，默认为 false（否）
   */
  is_face_rent_estimated?: boolean;

  /**
   * 租期（月）
   * @description 可空字段，租赁合同的期限
   */
  lease_term_months?: number | null;

  /**
   * 装修期（月）
   * @description 可空字段，租赁的装修免租期
   */
  fit_out_months?: number | null;

  /**
   * 免租期（月）
   * @description 可空字段，租赁的免租期
   */
  rent_free_months?: number | null;

  /**
   * 有效租金（元/㎡/月）
   * @description 可空字段，计算后的有效租金
   */
  effective_rent?: number | null;

  /**
   * 有效租金是否为预估值
   * @description 可选字段，标记有效租金是否为预估，默认为 false（否）
   */
  is_effective_rent_estimated?: boolean;

  // ========== 时间信息 ==========
  /**
   * 成交日期
   * @description 可选字段，格式：YYYY-MM-DD（已废弃，使用 transaction_year 和 transaction_quarter）
   */
  transaction_date?: string | null;

  /**
   * 成交年份
   * @description 必填字段，如：2024
   */
  transaction_year: number;

  /**
   * 成交季度
   * @description 必填字段，格式：YYYYQN，如：2024Q1
   */
  transaction_quarter: string;

  // ========== 备注信息 ==========
  /**
   * 备注
   * @description 可选字段，补充说明信息
   */
  remarks?: string | null;

  // ========== 提交者信息 ==========
  /**
   * 提交者 ID
   * @description 必填字段，提交记录的用户 ID
   */
  submitter_id: string;

  /**
   * 提交者姓名
   * @description 必填字段，提交记录的用户姓名
   */
  submitter_name: string;

  /**
   * 提交者账号是否仍处于启用状态
   * @description 团队视图使用；仅标记账号状态，不隐藏历史提交者姓名
   */
  submitter_active?: boolean;

  /**
   * 原始提交者 ID
   * @description 首次提交时写入，赠与操作不会修改此字段
   */
  original_submitter_id?: string | null;

  /**
   * 原始提交者姓名
   * @description 首次提交时写入，赠与操作不会修改此字段
   */
  original_submitter_name?: string | null;

  // ========== 系统字段 ==========
  /**
   * 创建时间
   * @description 提交时由数据库自动生成
   */
  created_at?: string;

  /**
   * 最近更新时间
   * @description 数据库在每次更新时自动刷新，用于并发编辑保护
   */
  updated_at?: string;
}

/**
 * 重复检测结果接口
 * @description 用于返回重复检测的结果
 */
export interface DuplicateCheckResult {
  /**
   * 是否存在重复
   */
  hasDuplicate: boolean;

  /**
   * 重复的记录列表
   * @description 匹配到的潜在重复记录
   */
  duplicates: LeaseTransaction[];
}

/**
 * 周进度接口
 * @description 用于展示用户的周提交进度
 */
export interface WeeklyProgress {
  /**
   * 本周已提交数量
   */
  submittedCount: number;

  /**
   * 周目标数量
   * @description 固定为 2
   */
  targetCount: number;

  /**
   * 完成百分比
   * @description 0-100 的整数值
   */
  percentage: number;
}

/**
 * 提交结果接口
 * @description 用于返回提交操作的结果
 */
export interface SubmissionResult {
  /**
   * 是否成功
   */
  success: boolean;

  /**
   * 插入的记录
   * @description 成功时返回插入的完整记录
   */
  data?: LeaseTransaction;

  /**
   * 错误信息
   * @description 失败时返回的错误描述
   */
  error?: string;
}

/**
 * 填报错误类型枚举
 * @description 定义所有可能的错误类型
 */
export enum SubmissionErrorType {
  /**
   * 验证错误
   * @description 数据验证失败，如必填字段缺失、格式错误等
   */
  VALIDATION_ERROR = 'VALIDATION_ERROR',

  /**
   * 重复错误
   * @description 检测到重复记录
   */
  DUPLICATE_ERROR = 'DUPLICATE_ERROR',

  /**
   * 数据库错误
   * @description 数据库操作失败
   */
  DATABASE_ERROR = 'DATABASE_ERROR',

  /**
   * 网络错误
   * @description 网络连接失败
   */
  NETWORK_ERROR = 'NETWORK_ERROR',

  /**
   * 未知错误
   * @description 其他未预期的错误
   */
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * 填报错误接口
 * @description 用于返回详细的错误信息
 */
export interface SubmissionError {
  /**
   * 错误类型
   */
  type: SubmissionErrorType;

  /**
   * 错误消息
   * @description 人类可读的错误描述
   */
  message: string;

  /**
   * 相关字段
   * @description 可选，指出导致错误的字段名
   */
  field?: string;

  /**
   * 详细信息
   * @description 可选，额外的错误详情
   */
  details?: unknown;
}
