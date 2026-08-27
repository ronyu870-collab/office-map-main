'use client';

import * as React from 'react';

// ═══════════════════════════════════════════════════════════════════════════
// 类型
// ═══════════════════════════════════════════════════════════════════════════

interface FieldDoc {
  name: string;
  label: string;
  type: string;
  desc: string;
  who?: string;
  note?: string;
}

interface TableDoc {
  name: string;
  label: string;
  desc: string;
  fields: FieldDoc[];
  rules?: string[];
}

interface GroupDoc {
  id: string;
  title: string;
  desc: string;
  tables: TableDoc[];
}

// ═══════════════════════════════════════════════════════════════════════════
// 全量数据定义 — 28张表、297个字段
// ═══════════════════════════════════════════════════════════════════════════

const GROUPS: GroupDoc[] = [
  // ─────────────────────────────────────────────────────────────────────
  // 1. 楼宇数据
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'building',
    title: '楼宇数据',
    desc: '楼宇基础信息、季度经营指标、历史数据和显示配置。是整个系统的核心数据。',
    tables: [
      {
        name: 'buildings',
        label: '楼宇基础信息',
        desc: '所有楼宇的"身份证"。地图弹窗、季度填报、数据分析都从这里读取楼宇的基本属性。',
        rules: [
          '经纬度为空或is_active=false的楼宇不会在地图上显示',
          'P(超甲级)在Excel导出时合并到A(甲级)组，不单独分组',
          'leasable_area会在新楼宇首次填报时自动带入"总面积"字段',
          '修改楼宇名称会同步更新所有关联的历史数据展示',
        ],
        fields: [
          { name: 'id', label: '楼宇ID', type: 'UUID', desc: '系统自动生成的唯一标识，不可修改', who: '系统自动' },
          { name: 'name', label: '项目名称', type: '文本', desc: '楼宇名称，如"国贸中心"', who: '管理员' },
          { name: 'submarket', label: '子市场', type: '文本', desc: '所属商圈，如CBD、金融街、中关村', who: '管理员' },
          { name: 'grade', label: '楼宇等级', type: '文本', desc: 'P=超甲级、A=甲级、B=乙级、BP=产业园', who: '管理员', note: '导出时P合并到A组' },
          { name: 'city', label: '城市', type: '文本', desc: '所在城市', who: '管理员' },
          { name: 'district', label: '行政区', type: '文本', desc: '所属行政区，如朝阳区、海淀区', who: '管理员' },
          { name: 'location_lng', label: '经度', type: '浮点数', desc: '楼宇位置经度坐标', who: '管理员', note: '为空则地图不显示' },
          { name: 'location_lat', label: '纬度', type: '浮点数', desc: '楼宇位置纬度坐标', who: '管理员', note: '为空则地图不显示' },
          { name: 'completion_year', label: '竣工年份', type: '文本', desc: '楼宇建成/预计入市年份，可含季度如2026Q3', who: '管理员' },
          { name: 'leed_certification', label: 'LEED认证', type: '文本', desc: '绿色建筑认证信息', who: '管理员' },
          { name: 'owner', label: '业主', type: '文本', desc: '产权方/业主名称', who: '管理员' },
          { name: 'property_management', label: '物业公司', type: '文本', desc: '物业管理公司', who: '管理员' },
          { name: 'contact_phone', label: '联系电话', type: '文本', desc: '联系方式', who: '管理员' },
          { name: 'leasable_area', label: '可租赁面积', type: '数值', desc: '总可租赁面积(平方米)', who: '管理员', note: '新楼宇首次填报时自动带入总面积' },
          { name: 'is_active', label: '是否启用', type: '布尔', desc: '控制楼宇是否可见', who: '管理员', note: '停用后地图不显示但历史数据保留' },
          { name: 'former_names', label: '曾用名', type: 'JSONB数组', desc: '曾用名列表，如["旧名1","旧名2"]，用于历史数据匹配', who: '管理员' },
          { name: 'notes', label: '备注', type: '文本', desc: '补充信息', who: '管理员' },
          { name: 'sort_order', label: '排序序号', type: '整数', desc: '控制显示顺序，越小越靠前', who: '管理员' },
        ],
      },
      {
        name: 'building_metrics',
        label: '季度指标数据',
        desc: '楼宇的季度经营指标快照。每次填报完成后自动保存一份，用于趋势分析和历史对比。',
        rules: [
          '此表数据由系统自动从quarterly_submissions同步，不直接编辑',
          '用于地图弹窗中显示最新一期的经营数据',
          '新楼宇首次填报时，从此表获取最新一期的total_area作为参考',
        ],
        fields: [
          { name: 'id', label: '记录ID', type: '大整数', desc: '自增主键', who: '系统自动' },
          { name: 'building_id', label: '所属楼宇', type: 'UUID', desc: '关联buildings.id', who: '系统自动' },
          { name: 'total_area', label: '总面积', type: '浮点数', desc: '楼宇总建筑面积(平方米)', who: '系统同步' },
          { name: 'asking_rent', label: '报价租金', type: '浮点数', desc: '业主报价租金(元/平米/天)', who: '系统同步' },
          { name: 'management_fee', label: '物业费', type: '浮点数', desc: '物业管理费(元/平米/月)', who: '系统同步' },
          { name: 'face_rent', label: '表面租金', type: '浮点数', desc: '实际或参考表面租金', who: '系统同步' },
          { name: 'rent_free_period', label: '免租期', type: '浮点数', desc: '免租期(月)', who: '系统同步' },
          { name: 'net_effective_rent', label: '净有效租金', type: '浮点数', desc: '扣除免租期后的有效租金', who: '系统同步' },
          { name: 'vacancy_rate', label: '空置率', type: '浮点数', desc: '空置面积/总面积', who: '系统同步' },
          { name: 'vacant_area', label: '空置面积', type: '浮点数', desc: '当前空置面积(平方米)', who: '系统同步' },
          { name: 'record_year', label: '数据年份', type: '大整数', desc: '数据所属年份', who: '系统同步' },
          { name: 'record_quarter', label: '数据季度', type: '大整数', desc: '数据所属季度(1-4)', who: '系统同步' },
          { name: 'created_at', label: '创建时间', type: '时间戳', desc: '记录创建时间', who: '系统自动' },
        ],
      },
      {
        name: 'building_display_overrides',
        label: '楼宇显示覆盖',
        desc: '特殊楼宇的显示配置。可以覆盖地图弹窗中显示的子市场或等级标签。',
        fields: [
          { name: 'id', label: '覆盖ID', type: 'UUID', desc: '系统自动生成', who: '系统自动' },
          { name: 'building_id', label: '所属楼宇', type: 'UUID', desc: '关联buildings.id', who: '管理员' },
          { name: 'field_name', label: '覆盖字段', type: '文本', desc: '要覆盖的字段：submarket或grade', who: '管理员' },
          { name: 'display_label', label: '显示标签', type: '文本', desc: '替换后的显示标签', who: '管理员' },
          { name: 'display_value', label: '显示值', type: '文本', desc: '替换后的显示值', who: '管理员' },
          { name: 'created_at', label: '创建时间', type: '时间戳', desc: '创建时间', who: '系统自动' },
          { name: 'updated_at', label: '更新时间', type: '时间戳', desc: '最后更新时间', who: '系统自动' },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  // 2. 填报管理
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'submission',
    title: '填报管理',
    desc: '季度数据填报、填报记录和草稿管理。负责人每季度填写楼宇经营数据。',
    tables: [
      {
        name: 'quarterly_submissions',
        label: '季度填报数据',
        desc: '核心数据表。负责人每季度填报的楼宇经营数据，是分析报表和地图弹窗的数据来源。',
        rules: [
          '空置率自动计算：vacancy_rate = vacant_area / total_area',
          '同一楼宇同一季度重复提交会覆盖已有记录，不创建新记录',
          '新楼宇首次填报时，total_area从buildings.leasable_area自动带入',
          '地图弹窗中的租金和空置率来自最近一次填报',
          '填报完成后数据同步到building_metrics表',
        ],
        fields: [
          { name: 'id', label: '填报ID', type: 'UUID', desc: '系统自动生成', who: '系统自动' },
          { name: 'building_id', label: '填报楼宇', type: 'UUID', desc: '关联buildings.id', who: '系统自动' },
          { name: 'user_id', label: '填报用户', type: 'UUID', desc: '关联auth.users.id', who: '系统自动' },
          { name: 'user_name', label: '填报人', type: '文本', desc: '填报人中文姓名(冗余)', who: '系统自动' },
          { name: 'record_year', label: '填报年份', type: '整数', desc: '数据年份如2026', who: '系统自动' },
          { name: 'record_quarter', label: '填报季度', type: '整数', desc: '数据季度(1-4)', who: '系统自动' },
          { name: 'total_area', label: '总面积', type: '数值', desc: '总建筑面积(平方米)', who: '负责人', note: '新楼宇从leasable_area带入' },
          { name: 'vacant_area', label: '空置面积', type: '数值', desc: '当前空置面积(平方米)', who: '负责人' },
          { name: 'vacancy_rate', label: '空置率', type: '数值', desc: '系统自动计算=空置面积/总面积', who: '系统自动' },
          { name: 'asking_rent', label: '报价租金', type: '数值', desc: '业主报价(元/平米/天)', who: '负责人' },
          { name: 'management_fee', label: '物业费', type: '数值', desc: '物业费(元/平米/月)', who: '负责人' },
          { name: 'face_rent', label: '表面租金', type: '数值', desc: '表面租金', who: '负责人' },
          { name: 'rent_free_period', label: '免租期', type: '数值', desc: '免租期(月)', who: '负责人' },
          { name: 'net_effective_rent', label: '净有效租金', type: '数值', desc: '扣除免租期后的有效租金', who: '负责人' },
          { name: 'owner', label: '业主', type: '文本', desc: '本季度业主信息', who: '负责人' },
          { name: 'property_management', label: '物业公司', type: '文本', desc: '本季度物业公司', who: '负责人' },
          { name: 'notes', label: '备注', type: '文本', desc: '本季度特殊情况', who: '负责人' },
          { name: 'created_at', label: '提交时间', type: '时间戳', desc: '首次提交时间', who: '系统自动' },
          { name: 'updated_at', label: '更新时间', type: '时间戳', desc: '最后修改时间', who: '系统自动' },
        ],
      },
      {
        name: 'quarterly_updates',
        label: '填报记录',
        desc: '记录每次填报操作的元数据。每提交一次填报就会生成一条记录。',
        fields: [
          { name: 'id', label: '记录ID', type: '大整数', desc: '自增主键', who: '系统自动' },
          { name: 'user_name', label: '用户姓名', type: '文本', desc: '提交人姓名', who: '系统自动' },
          { name: 'tab', label: '填报标签', type: '文本', desc: '填报的分类标签', who: '系统自动' },
          { name: 'project_name', label: '项目名称', type: '文本', desc: '填报的楼宇名称', who: '系统自动' },
          { name: 'payload', label: '提交数据', type: 'JSON', desc: '提交的完整数据快照', who: '系统自动' },
          { name: 'created_at', label: '提交时间', type: '时间戳', desc: '提交时间', who: '系统自动' },
        ],
      },
      {
        name: 'update_drafts',
        label: '草稿管理',
        desc: '填报过程中的自动保存草稿。用户未提交的填报数据会定期保存到这里。',
        fields: [
          { name: 'id', label: '草稿ID', type: '大整数', desc: '自增主键', who: '系统自动' },
          { name: 'user_name', label: '用户姓名', type: '文本', desc: '草稿所属用户', who: '系统自动' },
          { name: 'tab', label: '填报标签', type: '文本', desc: '填报分类', who: '系统自动' },
          { name: 'draft_data', label: '草稿数据', type: 'JSON', desc: '自动保存的草稿内容', who: '系统自动' },
          { name: 'updated_at', label: '保存时间', type: '时间戳', desc: '最后自动保存时间', who: '系统自动' },
        ],
      },
      {
        name: 'building_assignments',
        label: '任务分配',
        desc: '决定"谁负责填报哪些楼宇"。一个楼宇同时只能分配给一个负责人。',
        rules: [
          '一个楼宇只能分配给一个负责人，重复分配覆盖之前的',
          '没有分配关系的楼宇不会出现在任何人的填报列表中',
          '删除分配不影响已填报的历史数据',
        ],
        fields: [
          { name: 'id', label: '分配ID', type: 'UUID', desc: '系统自动生成', who: '系统自动' },
          { name: 'building_id', label: '分配楼宇', type: 'UUID', desc: '关联buildings.id', who: '管理员' },
          { name: 'project_name', label: '项目名称', type: '文本', desc: '冗余存储的楼宇名称', who: '系统自动' },
          { name: 'user_id', label: '负责用户', type: '文本', desc: '关联user_roles.user_id', who: '管理员' },
          { name: 'user_name', label: '负责人姓名', type: '文本', desc: '冗余存储的姓名', who: '系统自动' },
          { name: 'created_at', label: '分配时间', type: '时间戳', desc: '创建时间', who: '系统自动' },
          { name: 'grade', label: '楼宇等级', type: '文本', desc: '冗余存储的等级', who: '系统自动' },
          { name: 'submarket', label: '子市场', type: '文本', desc: '冗余存储的子市场', who: '系统自动' },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  // 3. 未来供应
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'future',
    title: '未来供应',
    desc: '即将入市的新楼宇项目。与现有楼宇独立管理，项目正式入市后需在楼宇基础信息中新建。',
    tables: [
      {
        name: 'future_supplies',
        label: '未来供应项目',
        desc: '即将入市的楼宇项目主表。',
        rules: [
          '与buildings表完全独立，不会出现在地图上',
          '项目正式入市后需在buildings中新建对应楼宇',
        ],
        fields: [
          { name: 'id', label: '供应ID', type: 'UUID', desc: '系统自动生成', who: '系统自动' },
          { name: 'name', label: '项目名称', type: '文本', desc: '项目名称', who: '管理员' },
          { name: 'owner', label: '业主', type: '文本', desc: '业主/开发商', who: '管理员' },
          { name: 'district', label: '行政区', type: '文本', desc: '所在行政区', who: '管理员' },
          { name: 'submarket', label: '子市场', type: '文本', desc: '所属商圈', who: '管理员' },
          { name: 'grade', label: '楼宇等级', type: '文本', desc: '预期等级P/A/B/BP', who: '管理员' },
          { name: 'launch_year', label: '入市年份', type: '文本', desc: '预计入市年份', who: '管理员' },
          { name: 'launch_quarter', label: '入市季度', type: '文本', desc: '预计入市季度(1-4)', who: '管理员' },
          { name: 'total_area', label: '总面积', type: '数值', desc: '总建筑面积(平方米)', who: '管理员' },
          { name: 'notes', label: '备注', type: '文本', desc: '补充信息', who: '管理员' },
          { name: 'location_lng', label: '经度', type: '数值', desc: '位置经度', who: '管理员' },
          { name: 'location_lat', label: '纬度', type: '数值', desc: '位置纬度', who: '管理员' },
          { name: 'created_at', label: '创建时间', type: '时间戳', desc: '创建时间', who: '系统自动' },
          { name: 'type', label: '物业类型', type: '文本', desc: '写字楼或产业园', who: '管理员' },
        ],
      },
      {
        name: 'future_supply_assignments',
        label: '未来供应分配',
        desc: '把未来供应项目分配给负责人，由负责人定期更新进展。',
        fields: [
          { name: 'id', label: '分配ID', type: 'UUID', desc: '系统自动生成', who: '系统自动' },
          { name: 'future_supply_id', label: '分配供应', type: 'UUID', desc: '关联future_supplies.id', who: '管理员' },
          { name: 'user_id', label: '负责用户', type: 'UUID', desc: '关联user_roles.user_id', who: '管理员' },
          { name: 'user_name', label: '负责人姓名', type: '文本', desc: '冗余存储', who: '系统自动' },
          { name: 'record_year', label: '年份', type: '整数', desc: '分配年份', who: '系统自动' },
          { name: 'record_quarter', label: '季度', type: '整数', desc: '分配季度', who: '系统自动' },
          { name: 'created_at', label: '分配时间', type: '时间戳', desc: '创建时间', who: '系统自动' },
        ],
      },
      {
        name: 'future_supply_submissions',
        label: '未来供应填报',
        desc: '负责人填报的未来供应项目进展数据。',
        fields: [
          { name: 'id', label: '填报ID', type: 'UUID', desc: '系统自动生成', who: '系统自动' },
          { name: 'future_supply_id', label: '填报供应', type: 'UUID', desc: '关联future_supplies.id', who: '系统自动' },
          { name: 'user_id', label: '填报用户', type: 'UUID', desc: '关联auth.users.id', who: '系统自动' },
          { name: 'user_name', label: '填报人', type: '文本', desc: '填报人姓名', who: '系统自动' },
          { name: 'record_year', label: '填报年份', type: '整数', desc: '数据年份', who: '系统自动' },
          { name: 'record_quarter', label: '填报季度', type: '整数', desc: '数据季度(1-4)', who: '系统自动' },
          { name: 'total_area', label: '总面积', type: '数值', desc: '总面积(平方米)', who: '负责人' },
          { name: 'vacant_area', label: '空置面积', type: '数值', desc: '空置面积(平方米)', who: '负责人' },
          { name: 'vacancy_rate', label: '空置率', type: '数值', desc: '自动计算', who: '系统自动' },
          { name: 'asking_rent', label: '报价租金', type: '数值', desc: '报价租金', who: '负责人' },
          { name: 'management_fee', label: '物业费', type: '数值', desc: '物业费', who: '负责人' },
          { name: 'face_rent', label: '表面租金', type: '数值', desc: '表面租金', who: '负责人' },
          { name: 'rent_free_period', label: '免租期', type: '数值', desc: '免租期(月)', who: '负责人' },
          { name: 'net_effective_rent', label: '净有效租金', type: '数值', desc: '净有效租金', who: '负责人' },
          { name: 'owner', label: '业主', type: '文本', desc: '业主', who: '负责人' },
          { name: 'property_management', label: '物业公司', type: '文本', desc: '物业公司', who: '负责人' },
          { name: 'notes', label: '备注', type: '文本', desc: '备注', who: '负责人' },
          { name: 'created_at', label: '提交时间', type: '时间戳', desc: '提交时间', who: '系统自动' },
          { name: 'updated_at', label: '更新时间', type: '时间戳', desc: '最后更新', who: '系统自动' },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  // 4. 租赁成交
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'transaction',
    title: '租赁成交',
    desc: '市场上的租赁成交记录。用于分析市场动态和成交趋势。',
    tables: [
      {
        name: 'lease_transactions',
        label: '租赁成交',
        desc: '市场上的租赁成交记录。由经纪人或管理员录入。',
        rules: [
          'new_building是文本字段，与buildings表没有数据库级关联',
          '成交数据与季度填报数据独立，不会互相影响',
          'data_source区分数据来源：broker_submission=经纪人提交',
        ],
        fields: [
          { name: 'id', label: '成交ID', type: 'UUID', desc: '系统自动生成', who: '系统自动' },
          { name: 'company', label: '企业名称', type: '文本', desc: '承租企业名称', who: '经纪人/管理员' },
          { name: 'suspected_company_fullname', label: '疑似全称', type: '文本', desc: '系统匹配的企业全称', who: '系统自动' },
          { name: 'enterprise_type', label: '企业类型', type: '文本', desc: '企业性质分类', who: '经纪人/管理员' },
          { name: 'industry', label: '行业', type: '文本', desc: '承租企业行业', who: '经纪人/管理员' },
          { name: 'sub_industry', label: '子行业', type: '文本', desc: '细分行业', who: '经纪人/管理员' },
          { name: 'demand_type', label: '需求类型', type: '文本', desc: '新租/续租/扩租/缩租', who: '经纪人/管理员' },
          { name: 'new_building', label: '新址楼宇', type: '文本', desc: '搬入的楼宇名称(文本)', who: '经纪人/管理员', note: '文本字段非数据库关联' },
          { name: 'sub_market', label: '子市场', type: '文本', desc: '成交楼宇子市场', who: '经纪人/管理员' },
          { name: 'district', label: '行政区', type: '文本', desc: '行政区', who: '经纪人/管理员' },
          { name: 'building_grade', label: '楼宇等级', type: '文本', desc: '成交楼宇等级', who: '经纪人/管理员' },
          { name: 'floor_info', label: '楼层信息', type: '文本', desc: '租赁楼层', who: '经纪人/管理员' },
          { name: 'old_address', label: '原址', type: '文本', desc: '搬迁前地址', who: '经纪人/管理员' },
          { name: 'old_sub_market', label: '原子市场', type: '文本', desc: '搬迁前子市场', who: '经纪人/管理员' },
          { name: 'old_building_grade', label: '原楼宇等级', type: '文本', desc: '搬迁前等级', who: '经纪人/管理员' },
          { name: 'area_sqm', label: '租赁面积', type: '数值', desc: '面积(平方米)', who: '经纪人/管理员' },
          { name: 'face_rent', label: '表面租金', type: '数值', desc: '合同表面租金', who: '经纪人/管理员' },
          { name: 'lease_term_months', label: '租期(月)', type: '数值', desc: '合同租期', who: '经纪人/管理员' },
          { name: 'fit_out_months', label: '装修期(月)', type: '数值', desc: '装修免租期', who: '经纪人/管理员' },
          { name: 'rent_free_months', label: '免租期(月)', type: '数值', desc: '免租期', who: '经纪人/管理员' },
          { name: 'effective_rent', label: '有效租金', type: '数值', desc: '扣除优惠后实际租金', who: '经纪人/管理员' },
          { name: 'transaction_date', label: '成交日期', type: '日期', desc: '成交日期', who: '经纪人/管理员' },
          { name: 'transaction_year', label: '成交年份', type: '整数', desc: '成交年份(冗余)', who: '系统自动' },
          { name: 'transaction_quarter', label: '成交季度', type: '文本', desc: '成交季度(冗余)', who: '系统自动' },
          { name: 'remarks', label: '备注', type: '文本', desc: '备注', who: '经纪人/管理员' },
          { name: 'data_source', label: '数据来源', type: '文本', desc: 'broker_submission或管理员录入', who: '系统自动' },
          { name: 'submitter_id', label: '提交人ID', type: '文本', desc: '提交人ID', who: '系统自动' },
          { name: 'submitter_name', label: '提交人', type: '文本', desc: '提交人姓名', who: '系统自动' },
          { name: 'created_at', label: '创建时间', type: '时间戳', desc: '创建时间', who: '系统自动' },
          { name: 'updated_at', label: '更新时间', type: '时间戳', desc: '最后更新', who: '系统自动' },
          { name: 'is_face_rent_estimated', label: '表面租金是否估算', type: '布尔', desc: 'true=估算值', who: '系统自动' },
          { name: 'is_effective_rent_estimated', label: '有效租金是否估算', type: '布尔', desc: 'true=估算值', who: '系统自动' },
          { name: 'relocation_area_change', label: '搬迁面积变化', type: '文本', desc: '搬迁前后面积变化', who: '经纪人/管理员' },
          { name: 'floor', label: '楼层', type: '文本', desc: '具体楼层', who: '经纪人/管理员' },
          { name: 'original_submitter_id', label: '原提交人ID', type: '文本', desc: '原始提交人ID', who: '系统自动' },
          { name: 'original_submitter_name', label: '原提交人', type: '文本', desc: '原始提交人姓名', who: '系统自动' },
          { name: 'old_district', label: '原行政区', type: '文本', desc: '搬迁前行政区', who: '经纪人/管理员' },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  // 5. 企业与行业
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'company',
    title: '企业与行业',
    desc: '企业基础数据、别名映射、融资事件、私募成交、天眼查详情和行业分类。',
    tables: [
      {
        name: 'companies',
        label: '企业数据',
        desc: '企业基础核心数据池。以统一社会信用代码为主键。',
        fields: [
          { name: 'uscc', label: '统一社会信用代码', type: '文本', desc: '企业唯一标识(主键)', who: '管理员' },
          { name: 'company_full', label: '企业全称', type: '文本', desc: '完整企业名称', who: '管理员' },
          { name: 'company_short', label: '企业简称', type: '文本', desc: '常用简称', who: '管理员' },
          { name: 'district', label: '行政区', type: '文本', desc: '所在行政区', who: '管理员' },
          { name: 'industry_tags', label: '行业标签', type: '数组', desc: '行业标签数组', who: '管理员' },
          { name: 'insured_staff', label: '参保人数', type: '整数', desc: '社保参保人数', who: '管理员' },
          { name: 'est_area_min', label: '预估面积(最小)', type: '整数', desc: '预估使用面积下限', who: '系统计算' },
          { name: 'est_area_max', label: '预估面积(最大)', type: '整数', desc: '预估使用面积上限', who: '系统计算' },
          { name: 'status', label: '企业状态', type: '文本', desc: '存续/注销/吊销等', who: '管理员' },
          { name: 'phone', label: '联系电话', type: '文本', desc: '联系电话', who: '管理员' },
          { name: 'address', label: '企业地址', type: '文本', desc: '注册/经营地址', who: '管理员' },
          { name: 'created_at', label: '创建时间', type: '时间戳', desc: '创建时间', who: '系统自动' },
          { name: 'updated_at', label: '更新时间', type: '时间戳', desc: '最后更新', who: '系统自动' },
        ],
      },
      {
        name: 'company_aliases',
        label: '企业别名',
        desc: '企业名称别名映射，用于清洗成交数据中的不规范公司名称。',
        fields: [
          { name: 'alias_name', label: '企业别名', type: '文本', desc: '别名(主键)', who: '管理员' },
          { name: 'uscc', label: '统一社会信用代码', type: '文本', desc: '关联companies.uscc', who: '管理员' },
          { name: 'created_at', label: '创建时间', type: '时间戳', desc: '创建时间', who: '系统自动' },
        ],
      },
      {
        name: 'financing_events',
        label: '融资事件',
        desc: '企业的私募融资历史记录。',
        fields: [
          { name: 'id', label: '事件ID', type: 'UUID', desc: '系统自动生成', who: '系统自动' },
          { name: 'uscc', label: '统一社会信用代码', type: '文本', desc: '关联companies.uscc', who: '管理员' },
          { name: 'financing_date', label: '融资日期', type: '日期', desc: '融资发生日期', who: '管理员' },
          { name: 'round', label: '融资轮次', type: '文本', desc: '天使轮/A轮/B轮等', who: '管理员' },
          { name: 'amount_rmb_my', label: '融资金额(百万元)', type: '数值', desc: '金额(百万元)', who: '管理员' },
          { name: 'investors', label: '投资方', type: '文本', desc: '投资机构', who: '管理员' },
          { name: 'post_money_valuation', label: '投后估值', type: '数值', desc: '投后估值', who: '管理员' },
          { name: 'created_at', label: '创建时间', type: '时间戳', desc: '创建时间', who: '系统自动' },
        ],
      },
      {
        name: 'tianyancha_company_details',
        label: '天眼查企业详情',
        desc: '从天眼查导入的企业详细工商信息。',
        fields: [
          { name: 'id', label: '详情ID', type: 'UUID', desc: '系统自动生成', who: '系统自动' },
          { name: 'original_import_name', label: '原始导入名称', type: '文本', desc: '导入时的原始名称(唯一)', who: '系统自动' },
          { name: 'matched_company_name', label: '匹配企业名称', type: '文本', desc: '匹配到的企业名称', who: '系统自动' },
          { name: 'registration_status', label: '登记状态', type: '文本', desc: '存续/注销等', who: '天眼查' },
          { name: 'unified_social_credit_code', label: '统一社会信用代码', type: '文本', desc: '企业唯一标识', who: '天眼查' },
          { name: 'legal_representative', label: '法定代表人', type: '文本', desc: '法人姓名', who: '天眼查' },
          { name: 'establishment_date', label: '成立日期', type: '文本', desc: '企业成立日期', who: '天眼查' },
          { name: 'approval_date', label: '核准日期', type: '文本', desc: '核准日期', who: '天眼查' },
          { name: 'registered_capital', label: '注册资本', type: '文本', desc: '注册资本', who: '天眼查' },
          { name: 'paid_in_capital', label: '实缴资本', type: '文本', desc: '实缴资本', who: '天眼查' },
          { name: 'phone', label: '联系电话', type: '文本', desc: '联系电话', who: '天眼查' },
          { name: 'additional_phones', label: '其他电话', type: '文本', desc: '其他联系电话', who: '天眼查' },
          { name: 'email', label: '邮箱', type: '文本', desc: '企业邮箱', who: '天眼查' },
          { name: 'additional_emails', label: '其他邮箱', type: '文本', desc: '其他邮箱', who: '天眼查' },
          { name: 'province', label: '省份', type: '文本', desc: '所在省份', who: '天眼查' },
          { name: 'city', label: '城市', type: '文本', desc: '所在城市', who: '天眼查' },
          { name: 'district_region', label: '区/县', type: '文本', desc: '所在区县', who: '天眼查' },
          { name: 'company_address', label: '企业地址', type: '文本', desc: '注册地址', who: '天眼查' },
          { name: 'mailing_address', label: '通讯地址', type: '文本', desc: '通讯地址', who: '天眼查' },
          { name: 'registration_authority', label: '登记机关', type: '文本', desc: '工商登记机关', who: '天眼查' },
          { name: 'company_type', label: '企业类型', type: '文本', desc: '有限责任/股份有限等', who: '天眼查' },
          { name: 'taxpayer_qualification', label: '纳税人资质', type: '文本', desc: '一般纳税人/小规模等', who: '天眼查' },
          { name: 'taxpayer_id', label: '纳税人识别号', type: '文本', desc: '税务识别号', who: '天眼查' },
          { name: 'registration_number', label: '注册号', type: '文本', desc: '工商注册号', who: '天眼查' },
          { name: 'organization_code', label: '组织机构代码', type: '文本', desc: '组织机构代码', who: '天眼查' },
          { name: 'business_term', label: '营业期限', type: '文本', desc: '营业期限', who: '天眼查' },
          { name: 'industry_category_level1', label: '行业分类(一级)', type: '文本', desc: '一级行业', who: '天眼查' },
          { name: 'industry_category_level2', label: '行业分类(二级)', type: '文本', desc: '二级行业', who: '天眼查' },
          { name: 'industry_category_level3', label: '行业分类(三级)', type: '文本', desc: '三级行业', who: '天眼查' },
          { name: 'industry_category_level4', label: '行业分类(四级)', type: '文本', desc: '四级行业', who: '天眼查' },
          { name: 'former_names', label: '曾用名', type: '文本', desc: '企业曾用名', who: '天眼查' },
          { name: 'english_name', label: '英文名称', type: '文本', desc: '英文名', who: '天眼查' },
          { name: 'company_size', label: '企业规模', type: '文本', desc: '大型/中型/小型/微型', who: '天眼查' },
          { name: 'business_scope', label: '经营范围', type: '文本', desc: '工商登记的经营范围', who: '天眼查' },
          { name: 'company_profile', label: '企业简介', type: '文本', desc: '企业简介', who: '天眼查' },
          { name: 'website', label: '企业网站', type: '文本', desc: '官方网站', who: '天眼查' },
          { name: 'latest_annual_report_year', label: '最新年报年份', type: '文本', desc: '最近一次年报年份', who: '天眼查' },
          { name: 'insured_employees_count', label: '参保人数', type: '文本', desc: '参保人数', who: '天眼查' },
          { name: 'insured_employees_report_year', label: '参保人数年报年份', type: '文本', desc: '参保数据年份', who: '天眼查' },
          { name: 'created_at', label: '创建时间', type: '时间戳', desc: '导入时间', who: '系统自动' },
          { name: 'updated_at', label: '更新时间', type: '时间戳', desc: '最后更新', who: '系统自动' },
        ],
      },
      {
        name: 'industry_classification',
        label: '行业分类',
        desc: '行业分类标准表。',
        fields: [
          { name: 'id', label: '分类ID', type: 'UUID', desc: '系统自动生成', who: '系统自动' },
          { name: 'industry_level1', label: '一级行业', type: '文本', desc: '一级行业名称', who: '管理员' },
          { name: 'sub_industry', label: '子行业', type: '文本', desc: '二级行业名称', who: '管理员' },
          { name: 'created_at', label: '创建时间', type: '时间戳', desc: '创建时间', who: '系统自动' },
        ],
      },
      {
        name: 'private_equity_transactions',
        label: '私募成交',
        desc: '私募股权融资成交记录。与企业融资事件(financing_events)互补，记录更详细的成交信息。',
        fields: [
          { name: 'id', label: '成交ID', type: 'UUID', desc: '系统自动生成', who: '系统自动' },
          { name: 'financing_date', label: '融资日期', type: '日期', desc: '融资发生日期', who: '管理员' },
          { name: 'company_name', label: '企业名称', type: '文本', desc: '融资企业', who: '管理员' },
          { name: 'industry', label: '行业', type: '文本', desc: '企业行业', who: '管理员' },
          { name: 'business_detail', label: '业务详情', type: '文本', desc: '业务描述', who: '管理员' },
          { name: 'funding_round', label: '融资轮次', type: '文本', desc: '天使轮/A轮/B轮等', who: '管理员' },
          { name: 'amount_text', label: '融资金额', type: '文本', desc: '融资金额文本', who: '管理员' },
          { name: 'investors', label: '投资方', type: '文本', desc: '投资机构', who: '管理员' },
          { name: 'district', label: '行政区', type: '文本', desc: '所在行政区', who: '管理员' },
          { name: 'building_name', label: '楼宇名称', type: '文本', desc: '所在楼宇(文本)', who: '管理员' },
          { name: 'sub_market', label: '子市场', type: '文本', desc: '所在子市场', who: '管理员' },
          { name: 'remarks', label: '备注', type: '文本', desc: '备注', who: '管理员' },
          { name: 'created_at', label: '创建时间', type: '时间戳', desc: '创建时间', who: '系统自动' },
          { name: 'updated_at', label: '更新时间', type: '时间戳', desc: '最后更新', who: '系统自动' },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  // 6. 用户管理
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'user',
    title: '用户管理',
    desc: '系统用户账号管理。控制谁能登录、角色权限。',
    tables: [
      {
        name: 'user_roles',
        label: '用户列表',
        desc: '系统中的所有用户账号。',
        rules: [
          'admin角色可进后台，user角色只能填报',
          '同一账号同时只能在一个设备登录',
        ],
        fields: [
          { name: 'user_id', label: '用户ID', type: 'UUID', desc: '关联auth.users.id(主键)', who: '系统自动' },
          { name: 'role', label: '角色', type: '文本', desc: 'admin=管理员 / editor=编辑用户 / user=查看用户', who: '管理员' },
          { name: 'created_at', label: '创建时间', type: '时间戳', desc: '创建时间', who: '系统自动' },
          { name: 'phone', label: '手机号', type: '文本', desc: '手机号', who: '管理员' },
          { name: 'seq_no', label: '序号', type: '整数', desc: '排序序号', who: '管理员' },
          { name: 'chinese_name', label: '中文姓名', type: '文本', desc: '中文姓名', who: '管理员' },
          { name: 'full_name', label: '全名', type: '文本', desc: '完整姓名', who: '管理员' },
          { name: 'gender', label: '性别', type: '文本', desc: '性别', who: '管理员' },
          { name: 'title', label: '职位', type: '文本', desc: '公司职位', who: '管理员' },
          { name: 'email', label: '邮箱', type: '文本', desc: '登录邮箱(唯一)', who: '管理员' },
          { name: 'internal_number', label: '内部分机号', type: '文本', desc: '分机号', who: '管理员' },
          { name: 'session_id', label: '会话ID', type: 'UUID', desc: '当前会话标识(单设备登录)', who: '系统自动' },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  // 7. 系统管理
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'system',
    title: '系统管理',
    desc: '管理员工具：问题反馈、备忘录、公告、通知、更新日志、审计日志、系统设置。',
    tables: [
      {
        name: 'admin_issues',
        label: '问题反馈',
        desc: '管理员内部的问题反馈和需求记录。',
        fields: [
          { name: 'id', label: '问题ID', type: 'UUID', desc: '系统自动生成', who: '系统自动' },
          { name: 'title', label: '标题', type: '文本', desc: '问题标题', who: '管理员' },
          { name: 'description', label: '问题描述', type: '文本', desc: '详细描述', who: '管理员' },
          { name: 'status', label: '处理状态', type: '文本', desc: 'open/in_progress/resolved/wontfix/duplicate', who: '管理员' },
          { name: 'priority', label: '优先级', type: '文本', desc: 'high/medium/low', who: '管理员' },
          { name: 'images', label: '截图', type: '数组', desc: '截图URL数组', who: '管理员' },
          { name: 'created_at', label: '创建时间', type: '时间戳', desc: '创建时间', who: '系统自动' },
          { name: 'created_by', label: '创建人', type: '文本', desc: '创建人邮箱', who: '系统自动' },
          { name: 'resolved_at', label: '解决时间', type: '时间戳', desc: '标记为已解决的时间', who: '系统自动' },
          { name: 'category', label: '问题分类', type: '文本', desc: 'bug/feature/data/other', who: '管理员' },
          { name: 'module', label: '所属模块', type: '文本', desc: '涉及的系统模块', who: '管理员' },
          { name: 'resolved_by', label: '解决人', type: '文本', desc: '解决问题的人', who: '系统自动' },
          { name: 'reopened_at', label: '重新打开时间', type: '时间戳', desc: '重新打开的时间', who: '系统自动' },
        ],
      },
      {
        name: 'admin_issue_comments',
        label: '问题评论',
        desc: '问题反馈下的评论和讨论。',
        fields: [
          { name: 'id', label: '评论ID', type: 'UUID', desc: '系统自动生成', who: '系统自动' },
          { name: 'issue_id', label: '所属问题', type: 'UUID', desc: '关联admin_issues.id', who: '系统自动' },
          { name: 'content', label: '评论内容', type: '文本', desc: '评论文字', who: '管理员' },
          { name: 'images', label: '评论截图', type: '数组', desc: '截图URL数组', who: '管理员' },
          { name: 'created_by', label: '评论人', type: '文本', desc: '评论人邮箱', who: '系统自动' },
          { name: 'is_admin', label: '是否管理员', type: '布尔', desc: '评论人是否管理员', who: '系统自动' },
          { name: 'created_at', label: '评论时间', type: '时间戳', desc: '评论时间', who: '系统自动' },
        ],
      },
      {
        name: 'messages',
        label: '消息',
        desc: '用户消息记录。',
        fields: [
          { name: 'id', label: '消息ID', type: '大整数', desc: '自增主键', who: '系统自动' },
          { name: 'user_email', label: '用户邮箱', type: '文本', desc: '接收用户邮箱', who: '系统自动' },
          { name: 'user_name', label: '用户姓名', type: '文本', desc: '用户姓名', who: '系统自动' },
          { name: 'content', label: '消息内容', type: '文本', desc: '消息文字', who: '系统自动' },
          { name: 'created_at', label: '发送时间', type: '时间戳', desc: '发送时间', who: '系统自动' },
        ],
      },
      {
        name: 'notices',
        label: '通知',
        desc: '系统通知配置。',
        fields: [
          { name: 'id', label: '通知ID', type: 'UUID', desc: '系统自动生成', who: '系统自动' },
          { name: 'content', label: '通知内容', type: '文本', desc: '通知文字', who: '管理员' },
          { name: 'is_active', label: '是否启用', type: '布尔', desc: '控制是否显示', who: '管理员' },
          { name: 'updated_at', label: '更新时间', type: '时间戳', desc: '最后更新', who: '系统自动' },
          { name: 'updated_by', label: '更新人', type: '文本', desc: '更新人邮箱', who: '系统自动' },
        ],
      },
      {
        name: 'changelog',
        label: '更新日志',
        desc: '系统版本更新记录。',
        fields: [
          { name: 'id', label: '日志ID', type: 'UUID', desc: '系统自动生成', who: '系统自动' },
          { name: 'title', label: '更新标题', type: '文本', desc: '更新标题', who: '管理员' },
          { name: 'description', label: '更新描述', type: '文本', desc: '详细描述', who: '管理员' },
          { name: 'status', label: '状态', type: '文本', desc: 'planned/in_progress/released', who: '管理员' },
          { name: 'category', label: '分类', type: '文本', desc: 'feature/improvement/fix', who: '管理员' },
          { name: 'version', label: '版本号', type: '文本', desc: '版本号如v2.1', who: '管理员' },
          { name: 'released_at', label: '发布日期', type: '日期', desc: '发布日期', who: '管理员' },
          { name: 'sort_order', label: '排序序号', type: '整数', desc: '显示顺序', who: '管理员' },
          { name: 'created_at', label: '创建时间', type: '时间戳', desc: '创建时间', who: '系统自动' },
          { name: 'updated_at', label: '更新时间', type: '时间戳', desc: '最后更新', who: '系统自动' },
          { name: 'module', label: '所属模块', type: '文本', desc: 'map/database/lease/bi/cloud/admin/general', who: '管理员' },
          { name: 'code', label: '编号', type: '文本', desc: '唯一编号如CL-001', who: '管理员' },
        ],
      },
      {
        name: 'audit_logs',
        label: '审计日志',
        desc: '系统操作审计记录。记录所有用户的操作行为。',
        fields: [
          { name: 'id', label: '日志ID', type: '大整数', desc: '自增主键', who: '系统自动' },
          { name: 'user_id', label: '操作用户', type: '文本', desc: '操作人标识', who: '系统自动' },
          { name: 'action_type', label: '操作类型', type: '文本', desc: '操作类型', who: '系统自动' },
          { name: 'details', label: '操作详情', type: 'JSON', desc: '操作详细信息', who: '系统自动' },
          { name: 'created_at', label: '操作时间', type: '时间戳', desc: '操作时间', who: '系统自动' },
        ],
      },
      {
        name: 'app_settings',
        label: '系统设置',
        desc: '系统级配置项。键值对存储。',
        fields: [
          { name: 'key', label: '设置键', type: '文本', desc: '配置项名称(主键)', who: '管理员' },
          { name: 'value', label: '设置值', type: '文本', desc: '配置值', who: '管理员' },
          { name: 'updated_at', label: '更新时间', type: '时间戳', desc: '最后更新', who: '系统自动' },
        ],
      },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// 组件
// ═══════════════════════════════════════════════════════════════════════════

export default function SchemaMap() {
  const [activeGroup, setActiveGroup] = React.useState(GROUPS[0].id);
  const [activeTable, setActiveTable] = React.useState(GROUPS[0].tables[0].name);
  const [search, setSearch] = React.useState('');
  const [expandedField, setExpandedField] = React.useState<string | null>(null);

  const group = GROUPS.find((g) => g.id === activeGroup) ?? GROUPS[0];
  const table = group.tables.find((t) => t.name === activeTable) ?? group.tables[0];

  // 搜索
  const filteredGroups = React.useMemo(() => {
    if (!search.trim()) return GROUPS;
    const q = search.toLowerCase();
    return GROUPS.map((g) => ({
      ...g,
      tables: g.tables.filter((t) => {
        if (t.name.toLowerCase().includes(q) || t.label.includes(q) || t.desc.includes(q)) return true;
        return t.fields.some((f) => f.name.toLowerCase().includes(q) || f.label.includes(q) || f.desc.includes(q));
      }),
    })).filter((g) => g.tables.length > 0);
  }, [search]);

  // 统计
  const totalTables = GROUPS.reduce((s, g) => s + g.tables.length, 0);
  const totalFields = GROUPS.reduce((s, g) => s + g.tables.reduce((s2, t) => s2 + t.fields.length, 0), 0);

  return (
    <div className="flex h-full overflow-hidden bg-white">
      {/* 左侧：导航 */}
      <div className="w-64 shrink-0 border-r border-zinc-200 flex flex-col">
        <div className="px-4 py-3 border-b border-zinc-100">
          <h2 className="text-sm font-semibold text-zinc-700">数据字典</h2>
          <p className="text-[11px] text-zinc-400 mt-0.5">{totalTables} 张表 / {totalFields} 个字段</p>
          <input
            type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索表名或字段..."
            className="w-full mt-2 px-3 py-1.5 text-sm border border-zinc-200 rounded-md focus:outline-none focus:border-blue-400"
          />
        </div>
        <div className="flex-1 overflow-auto py-1 px-2">
          {filteredGroups.map((g) => (
            <div key={g.id} className="mb-1">
              <div className={`px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer transition-colors ${
                activeGroup === g.id ? 'text-blue-700 bg-blue-50' : 'text-zinc-500 hover:bg-zinc-50'
              }`} onClick={() => { setActiveGroup(g.id); setActiveTable(g.tables[0].name); setExpandedField(null); }}>
                {g.title}
                <span className="ml-1 font-normal text-zinc-400">({g.tables.length})</span>
              </div>
              {activeGroup === g.id && (
                <div className="ml-2 mt-0.5 space-y-0.5">
                  {g.tables.map((t) => (
                    <button key={t.name} onClick={() => { setActiveTable(t.name); setExpandedField(null); }}
                      className={`w-full text-left px-3 py-1.5 text-xs rounded-md transition-colors ${
                        activeTable === t.name ? 'bg-blue-100 text-blue-700 font-medium' : 'text-zinc-600 hover:bg-zinc-50'
                      }`}>
                      {t.label}
                      <span className="ml-1 text-zinc-400">{t.fields.length}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 右侧：表详情 */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-4xl mx-auto px-8 py-6">
          <div className="mb-1 text-xs text-zinc-400 font-mono">{table.name}</div>
          <h1 className="text-lg font-bold text-zinc-800">{table.label}</h1>
          <p className="text-sm text-zinc-500 mt-1 mb-5">{table.desc}</p>

          {/* 规则 */}
          {table.rules && table.rules.length > 0 && (
            <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="text-xs font-semibold text-amber-700 mb-2">业务规则</div>
              <ul className="space-y-1">
                {table.rules.map((r, i) => (
                  <li key={i} className="text-sm text-amber-800 flex items-start gap-2">
                    <span className="text-amber-400 shrink-0">{i + 1}.</span><span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 字段表 */}
          <div className="border border-zinc-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-zinc-50 border-b border-zinc-200 text-left">
                  <th className="py-2.5 px-4 font-semibold text-zinc-600 w-44">字段名</th>
                  <th className="py-2.5 px-4 font-semibold text-zinc-600 w-32">中文名</th>
                  <th className="py-2.5 px-4 font-semibold text-zinc-600 w-20">类型</th>
                  <th className="py-2.5 px-4 font-semibold text-zinc-600">说明</th>
                </tr>
              </thead>
              <tbody>
                {table.fields.map((f) => {
                  const key = `${table.name}.${f.name}`;
                  const isOpen = expandedField === key;
                  return (
                    <React.Fragment key={f.name}>
                      <tr className="border-b border-zinc-50 cursor-pointer hover:bg-zinc-50/50 transition-colors"
                        onClick={() => setExpandedField(isOpen ? null : key)}>
                        <td className="py-2 px-4 font-mono text-xs text-zinc-700">{f.name}</td>
                        <td className="py-2 px-4 text-zinc-800 font-medium">{f.label}</td>
                        <td className="py-2 px-4 text-zinc-500 text-xs">{f.type}</td>
                        <td className="py-2 px-4 text-zinc-500">
                          <div className="flex items-center justify-between">
                            <span>{f.desc}</span>
                            <svg className={`w-3 h-3 text-zinc-300 shrink-0 ml-2 transition-transform ${isOpen ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                          </div>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-zinc-50/50">
                          <td colSpan={4} className="px-4 py-3">
                            <div className="flex flex-wrap gap-x-8 gap-y-1 text-xs">
                              {f.who && <div><span className="text-zinc-400">填写方：</span><span className="text-zinc-600">{f.who}</span></div>}
                              {f.note && <div><span className="text-zinc-400">备注：</span><span className="text-zinc-600">{f.note}</span></div>}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
