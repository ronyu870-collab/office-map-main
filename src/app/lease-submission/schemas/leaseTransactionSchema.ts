import { z } from 'zod';
import { cleanDistrict } from '@/src/utils/dataCleaners';

/**
 * 通用 preprocess：将空字符串/null/undefined/NaN 统一转为 undefined
 * 用于所有非必填数值字段，彻底避免 NaN 校验错误
 */
const preprocessOptionalNumber = (val: unknown) => {
  if (val === '' || val === null || val === undefined) return undefined;
  if (typeof val === 'number' && isNaN(val)) return undefined;
  return val;
};

/**
 * 通用 preprocess：必填数值字段，将 NaN 转为 undefined（让 .number() 报错提示）
 */
const preprocessRequiredNumber = (val: unknown) => {
  if (typeof val === 'number' && isNaN(val)) return undefined;
  return val;
};

/**
 * 租赁成交表单 Zod Schema
 */
export const leaseTransactionSchema = z.object({
  // ==========================================
  // 核心必填区
  // ==========================================
  company: z
    .string()
    .min(1, '企业名称不能为空')
    .max(200, '企业名称不能超过200字符'),

  new_building: z
    .string()
    .min(1, '新租楼宇不能为空')
    .max(200, '楼宇名称不能超过200字符'),

  floor_info: z
    .string()
    .min(1, '请填写楼座（或勾选未知）')
    .max(50, '楼座不能超过50字符'),

  floor: z
    .string()
    .min(1, '请填写楼层（或勾选未知）')
    .max(20, '楼层不能超过20字符'),

  transaction_date: z
    .string()
    .nullable()
    .optional(),

  transaction_year: z.preprocess(
    preprocessRequiredNumber,
    z.number({ error: '请选择成交年份' })
      .int('成交年份必须为整数')
      .min(2000, '成交年份不能早于2000年')
      .max(2050, '成交年份不能晚于2050年')
  ),

  // 下拉框只存 Q1-Q4，年份独立存储在 transaction_year 列
  transaction_quarter: z
    .string()
    .min(1, '请选择成交季度')
    .regex(/^Q[1-4]$/, '成交季度格式错误'),

  area_sqm: z.preprocess(
    preprocessRequiredNumber,
    z.number({ error: '租赁面积必须为数字' })
      .positive('面积必须大于0')
      .max(1000000, '面积不能超过100万平方米')
  ),

  effective_rent: z.preprocess(
    preprocessRequiredNumber,
    z.number({ error: '有效租金必须为数字' })
      .nonnegative('有效租金不能为负数')
      .max(1000, '有效租金不得超过 1000 元/㎡/月，请核对金额或单位后修改。')
  ),

  is_effective_rent_estimated: z
    .boolean()
    .default(false)
    .optional(),

  // ==========================================
  // 企业信息
  // ==========================================
  suspected_company_fullname: z
    .string()
    .max(300, '企业全称不能超过300字符')
    .nullable()
    .optional(),

  enterprise_type: z.enum(
    ['央国企', '外企', '民企', '其他'],
    { error: '请选择有效的企业类型' }
  ),

  industry: z
    .string()
    .min(1, '请选择所属行业'),

  sub_industry: z
    .string()
    .min(1, '请选择所属子行业'),

  demand_type: z.enum(['新租', '搬迁', '扩租', '续租', '未知'], {
    error: '请选择有效的类型',
  }),

  relocation_area_change: z
    .enum(['缩减面积', '扩大面积', '面积不变', '未知', ''])
    .nullable()
    .optional(),

  is_manual_building: z
    .boolean()
    .default(false)
    .optional(),

  // ==========================================
  // 楼宇信息 (选填)
  // ==========================================
  sub_market: z
    .string()
    .max(100, '子市场名称不能超过100字符')
    .nullable()
    .optional(),

  // 🔥 修复：transform 必须放在 nullable/optional 之前，否则 undefined 会传入 cleanDistrict
  district: z
    .string()
    .max(100, '区域名称不能超过100字符')
    .nullable()
    .optional()
    .transform((val) => (val ? cleanDistrict(val) : val)),

  building_grade: z
    .enum(['甲级', '乙级', '产业园', '其他', ''])
    .nullable()
    .optional(),

  // ==========================================
  // 原址信息 (选填 - 搬迁场景)
  // ==========================================
  old_address: z
    .string()
    .max(300, '原地址不能超过300字符')
    .nullable()
    .optional(),

  old_sub_market: z
    .string()
    .max(100, '原子市场名称不能超过100字符')
    .nullable()
    .optional(),

  old_district: z
    .string()
    .max(100, '原址区域名称不能超过100字符')
    .nullable()
    .optional()
    .transform((val) => (val ? cleanDistrict(val) : val)),

  old_building_grade: z
    .enum(['甲级', '乙级', '产业园', '其他', '未知', ''])
    .nullable()
    .optional(),

  is_manual_old_building: z
    .boolean()
    .default(false)
    .optional(),

  // ==========================================
  // 成交细节
  // ==========================================
  // 🔥 face_rent 是必填字段（在表单中标记了 required），但允许为 0
  face_rent: z.preprocess(
    preprocessRequiredNumber,
    z.number({ error: '表面租金必须为数字' })
      .nonnegative('表面租金不能为负数')
      .max(1000, '表面租金不得超过 1000 元/㎡/月，请核对金额或单位后修改。')
  ),

  is_face_rent_estimated: z
    .boolean()
    .default(false)
    .optional(),

  lease_term_months: z
    .preprocess(
      preprocessOptionalNumber,
      z.union([
        z.number()
          .int('租期必须为整数')
          .positive('租期必须大于0')
          .max(600, '租期不能超过600个月'),
        z.undefined()
      ])
    )
    .optional(),

  fit_out_months: z
    .preprocess(
      preprocessOptionalNumber,
      z.union([
        z.number()
          .int('装修期必须为整数')
          .nonnegative('装修期不能为负数')
          .max(60, '装修期不能超过60个月'),
        z.undefined()
      ])
    )
    .optional(),

  rent_free_months: z
    .preprocess(
      preprocessOptionalNumber,
      z.union([
        z.number()
          .int('免租期必须为整数')
          .nonnegative('免租期不能为负数')
          .max(60, '免租期不能超过60个月'),
        z.undefined()
      ])
    )
    .optional(),

  // ==========================================
  // 备注信息 (选填)
  // ==========================================
  remarks: z
    .string()
    .max(1000, '备注不能超过1000字符')
    .nullable()
    .optional(),

}).superRefine((data, ctx) => {
  // 动态必填：搬迁时原址子市场、原楼宇、原址区域、原址楼宇等级和面积变化必填
  if (data.demand_type === '搬迁') {
    if (!data.old_sub_market || data.old_sub_market.trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '需求类型为"搬迁"时，原址子市场不能为空',
        path: ['old_sub_market'],
      });
    }
    if (!data.old_address || data.old_address.trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '需求类型为"搬迁"时，原址楼宇不能为空',
        path: ['old_address'],
      });
    }
    if (!data.old_district || data.old_district.trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '需求类型为"搬迁"时，原址区域不能为空',
        path: ['old_district'],
      });
    }
    if (!data.old_building_grade) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '需求类型为"搬迁"时，原址楼宇等级不能为空',
        path: ['old_building_grade'],
      });
    }
    if (!data.relocation_area_change) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '需求类型为"搬迁"时，搬迁面积变化不能为空',
        path: ['relocation_area_change'],
      });
    }
  }

  // 动态必填：交易楼宇信息必填字段
  if (!data.sub_market || data.sub_market.trim() === '') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: '子市场不能为空',
      path: ['sub_market'],
    });
  }
  if (!data.district || data.district.trim() === '') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: '区域不能为空',
      path: ['district'],
    });
  }
  if (!data.building_grade) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: '楼宇等级不能为空',
      path: ['building_grade'],
    });
  }
});

/**
 * 表单数据类型（从 Schema 推导）
 */
export type LeaseTransactionFormData = z.infer<typeof leaseTransactionSchema>;

/**
 * 字段配置类型
 */
export interface FormFieldConfig {
  name: keyof LeaseTransactionFormData;
  label: string;
  type: 'text' | 'number' | 'date' | 'select' | 'textarea';
  placeholder?: string;
  options?: string[];
  section: 'core' | 'advanced';
  gridCols?: 1 | 2 | 3;
}

export const INDUSTRY_OPTIONS = [
  '能源化工', '航空航天', '制造业', '消费品', '批发零售',
  '物流运输', '专业服务', '汽车及零部件', '酒店/餐饮/休闲娱乐',
  '教育培训', '广告媒体/娱乐出版', '医疗健康', '金融',
  '房地产/建筑工程', '政府及公用事业', '互联网软件与服务',
  '互联网硬件技术与设备', '军事工程', '农林牧渔',
] as const;

export const CORE_FIELDS: FormFieldConfig[] = [
  { name: 'company', label: '企业名称', type: 'text', placeholder: '请输入企业名称', section: 'core', gridCols: 2 },
  { name: 'industry', label: '所属行业', type: 'select', options: ['', ...INDUSTRY_OPTIONS], section: 'core', gridCols: 1 },
  { name: 'new_building', label: '新租楼宇', type: 'text', placeholder: '请输入楼宇名称', section: 'core', gridCols: 2 },
  { name: 'transaction_year', label: '成交年份', type: 'number', placeholder: '如：2024', section: 'core', gridCols: 1 },
  { name: 'transaction_quarter', label: '成交季度', type: 'text', placeholder: '如：2024Q1', section: 'core', gridCols: 1 },
  { name: 'area_sqm', label: '租赁面积 (㎡)', type: 'number', placeholder: '如：500', section: 'core', gridCols: 1 },
  { name: 'face_rent', label: '面价 (元/㎡/月)', type: 'number', placeholder: '如：8.5', section: 'core', gridCols: 1 },
  { name: 'effective_rent', label: '有效租金 (元/㎡/月)', type: 'number', placeholder: '如：7.5', section: 'core', gridCols: 1 },
];

export const ADVANCED_FIELDS: FormFieldConfig[] = [
  { name: 'suspected_company_fullname', label: '疑似企业全称', type: 'text', placeholder: '可选', section: 'advanced', gridCols: 2 },
  { name: 'enterprise_type', label: '企业类型', type: 'select', options: ['', '央国企', '外企', '民企'], section: 'advanced', gridCols: 1 },
  { name: 'sub_industry', label: '所属子行业', type: 'text', placeholder: '可选', section: 'advanced', gridCols: 1 },
  { name: 'demand_type', label: '需求类型', type: 'select', options: ['', '新租', '扩租', '搬迁', '续租', '未知'], section: 'advanced', gridCols: 1 },
  { name: 'sub_market', label: '子市场', type: 'text', placeholder: '如：CBD、金融街', section: 'advanced', gridCols: 1 },
  { name: 'district', label: '区域', type: 'text', placeholder: '如：朝阳区', section: 'advanced', gridCols: 1 },
  { name: 'building_grade', label: '楼宇等级', type: 'select', options: ['', '甲级', '乙级', '产业园', '其他'], section: 'advanced', gridCols: 1 },
  { name: 'old_address', label: '原楼宇', type: 'text', placeholder: '搬迁前地址', section: 'advanced', gridCols: 2 },
  { name: 'old_sub_market', label: '原子市场', type: 'text', placeholder: '可选', section: 'advanced', gridCols: 1 },
  { name: 'old_building_grade', label: '原楼宇等级', type: 'select', options: ['', '甲级', '乙级', '产业园', '其他', '未知'], section: 'advanced', gridCols: 1 },
  { name: 'relocation_area_change', label: '搬迁面积变化', type: 'select', options: ['', '缩减面积', '扩大面积', '面积不变', '未知'], section: 'advanced', gridCols: 1 },
  { name: 'lease_term_months', label: '租期 (月)', type: 'number', placeholder: '如：36', section: 'advanced', gridCols: 1 },
  { name: 'fit_out_months', label: '装修期 (月)', type: 'number', placeholder: '如：2', section: 'advanced', gridCols: 1 },
  { name: 'rent_free_months', label: '免租期 (月)', type: 'number', placeholder: '如：1', section: 'advanced', gridCols: 1 },
  { name: 'remarks', label: '备注', type: 'textarea', placeholder: '如：交叉代理行、楼宇交易变化、客户相关变化等', section: 'advanced', gridCols: 2 },
];
