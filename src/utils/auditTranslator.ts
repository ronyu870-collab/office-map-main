/**
 * auditTranslator.ts
 * 将底层审计日志的 action_type + details 翻译为人类可读的中文句子，
 * 并为不同操作类别分配视觉 Badge 样式。
 */

export type BadgeVariant = "blue" | "orange" | "green" | "red" | "purple" | "zinc";

export interface BadgeStyle {
  variant: BadgeVariant;
  label: string;
  /** Tailwind classes for the badge pill */
  className: string;
}

const MODULE_LABELS: Record<string, string> = {
  home: '首页',
  map: '楼宇地图',
  compare: '楼宇对比',
  update: '季度填报',
  'lease-submission': '租赁成交',
  oss: '研究资料库',
  admin: '管理后台',
  bi: '商业分析',
  intelligence: '业务智能',
  settings: '修改密码',
  login: '登录页',
};

function moduleLabel(value: unknown): string {
  const key = typeof value === 'string' ? value.trim() : '';
  return MODULE_LABELS[key] || key || '未知模块';
}

function pageLabel(value: unknown): string {
  const page = typeof value === 'string' ? value.trim() : '';
  if (!page || page === '/') return '首页';
  const moduleKey = page.split('/').filter(Boolean)[0] || 'home';
  return MODULE_LABELS[moduleKey] || page;
}

function periodLabel(year: unknown, quarter: unknown): string {
  if (!year && !quarter) return '';
  const q = quarter == null ? '' : String(quarter).toUpperCase().startsWith('Q') ? String(quarter).toUpperCase() : `Q${quarter}`;
  return [year, q].filter(Boolean).join(' ');
}

function exportDataLabel(payload: Record<string, any>): string {
  if (payload.table_label) return String(payload.table_label);
  const byType: Record<string, string> = {
    quarterly_submission_session: '季度填报单次提交',
    quarterly_submissions: '季度填报汇总',
    future_supply_submissions: '未来供应数据',
    admin_table: payload.table ? String(payload.table) : '后台数据',
  };
  const type = String(payload.export_type ?? payload.exportType ?? '');
  return byType[type] || String(payload.dataset ?? payload.export_type ?? payload.exportType ?? '数据');
}

// ─── 翻译引擎 ────────────────────────────────────────────────────────────────

/**
 * 将 action_type + details payload 翻译为一句人类可读的中文描述。
 */
export function parseAuditLog(action: string, payload: Record<string, any> = {}): string {
  const p = payload ?? {};

  switch (action) {
    case "PROJECT_MATERIAL_LIBRARY_IMPORT":
      return `处理了历史资料提取批次${p.planned_rows != null ? `（${p.planned_rows} 份来源）` : ""}`;
    case "PROJECT_MATERIAL_PAGE_IMPORT":
      return `保存并核验了资料逐页证据${p.planned_rows != null ? `（${p.planned_rows} 页）` : ""}`;
    case "BROCHURE_ASSOCIATION_CORRECTION":
      return `纠正了楼书归属并同步溯源${p.provenance_rows != null ? `（${p.provenance_rows} 条）` : ""}`;
    case "SALES_MATERIAL_ACCESS":
      return "查看了项目资料";
    case "BUILDING_PHOTO_ACCESS":
      return "查看了楼宇图片";
    case "BUILDING_PHOTO_IMPORT":
      return `导入了楼宇图片${p.photo_count != null ? `（${p.photo_count} 张）` : ''}`;
    case "SALES_MATERIAL_IMPORT": {
      const parts = [
        p.material_count != null ? `${p.material_count} 份资料` : p.material_id ? '1 份资料' : '',
        (p.commission_policy_count ?? p.policy_count) != null ? `${p.commission_policy_count ?? p.policy_count} 条佣金政策` : '',
        (p.parameter_and_note_count ?? p.row_count) != null ? `${p.parameter_and_note_count ?? p.row_count} 条参数与说明` : '',
      ].filter(Boolean);
      return `导入了项目资料${parts.length ? `（${parts.join('、')}）` : ''}`;
    }
    // 搜索 / 查询
    case "SEARCH":
      return `在「${moduleLabel(p.module)}」搜索了关键词："${p.keyword ?? p.query ?? ""}"`;
    case "LOOKUP_LEASE_COMPANY_HISTORY":
      return `查询了企业历史成交：${p.company ?? '未提供企业名称'}${p.match_count !== undefined ? `（匹配 ${p.match_count} 条）` : ''}`;
    case "FILTER":
      return `在「${moduleLabel(p.module)}」应用了筛选条件`;

    // 认证
    case "LOGIN":
      return "登录了系统";
    case "LOGOUT":
      return "退出了系统";

    // 导出
    case "EXPORT_CHART":
      return `导出了「${p.chartName ?? p.chart_name ?? "图表"}」`;
    case "EXPORT_TABLE":
      return `导出了「${p.tableName ?? p.table_name ?? "数据表"}」`;
    case "EXPORT_REPORT": {
      const reportName = p.reportName ?? p.report_name ?? "未命名报告";
      const verb = p.export_method === 'browser_print_pdf' ? '发起打印 / 导出报告' : '导出了报告';
      return `${verb}：「${reportName}」${p.candidate_count !== undefined ? `（${p.candidate_count} 个候选项目）` : ''}`;
    }

    // 公告
    case "UPDATE_NOTICE":
      return `发布 / 更新了系统公告${p.title ? `：「${p.title}」` : ""}`;
    case "DELETE_NOTICE":
      return `删除了系统公告${p.title ? `：「${p.title}」` : ""}`;

    // 项目 / 楼盘
    case "VIEW_PROJECT":
      return `查看了项目：「${p.projectName ?? p.project_name ?? p.name ?? "未知项目"}」`;
    case "UPDATE_PROJECT":
      return `更新了项目数据：「${p.projectName ?? p.project_name ?? p.name ?? "未知项目"}」`;
    case "CREATE_PROJECT":
      return `新建了项目：「${p.projectName ?? p.project_name ?? p.name ?? "未知项目"}」`;
    case "DELETE_PROJECT":
      return `删除了项目：「${p.projectName ?? p.project_name ?? p.name ?? "未知项目"}」`;

    // 数据库 / 文件
    case "UPLOAD_FILE":
      return `上传了文件：「${p.fileName ?? p.file_name ?? "未知文件"}」`;
    case "DELETE_FILE":
      return `删除了文件：「${p.fileName ?? p.file_name ?? "未知文件"}」`;
    case "IMPORT_DATA":
      return `导入了数据${p.source ? `（来源：${p.source}）` : ""}`;

    // 用户管理
    case "CREATE_USER":
      return `创建了用户：${p.name ?? p.email ?? p.userId ?? ""}`;
    case "UPDATE_USER":
      return `更新了用户信息：${p.name ?? p.email ?? p.userId ?? ""}`;
    case "DELETE_USER":
      return `删除了用户：${p.name ?? p.email ?? p.userId ?? ""}`;

    // 地图
    case "ENTER_MODULE":
      return p.module ? `进入了「${moduleLabel(p.module)}」` : "进入了系统板块";
    case "ACCESS_DENIED":
      return `尝试访问无权限板块：「${p.module ?? "未知模块"}」`;
    case "VIEW_BUILDING":
      return `查看了楼宇详情：「${p.buildingName ?? p.building_name ?? p.buildingId ?? p.building_id ?? "未知楼宇"}」`;
    case "EXPORT_MAP_DATA":
      return `导出了地图数据${p.file_name ? ` · ${p.file_name}` : ''}`;
    case "VIEW_BI_CHART": {
      const tabName = p.tab === 'submarket' ? '子市场分析' : p.tab === 'pe' ? '私募板块' : p.tab === 'lease' ? '租赁成交分析' : p.tab ?? '';
      return `查看了商业分析图表：「${tabName}」`;
    }
    case "OPEN_LEASE_FORM":
      return p.mode === 'edit' ? `打开了租赁成交编辑表单` : `打开了租赁成交填报表单`;
    case "VIEW_USER_SUBMISSION":
      return `查看了${p.subject_user_name ? `「${p.subject_user_name}」` : '某用户'}的季度填报${periodLabel(p.year, p.quarter) ? ` · ${periodLabel(p.year, p.quarter)}` : ''}`;
    case "CHANGELOG_CREATE":
      return `新增了更新日志：「${p.title ?? ""}」${p.code ? `(${p.code})` : ""}`;
    case "CHANGELOG_UPDATE":
      return `更新了更新日志：「${p.title ?? ""}」${p.code ? `(${p.code})` : ""}`;
    case "CHANGELOG_DELETE":
      return `删除了更新日志：「${p.title ?? ""}」${p.code ? `(${p.code})` : ""}`;
    case "POST_MESSAGE": {
      const preview = p.content ? `："${String(p.content).slice(0, 30)}${p.content.length > 30 ? "…" : ""}"` : "";
      return `在市场交流区发布了新消息${preview}`;
    }

    case "SUBMIT_QUARTERLY_DATA": {
      const count = p.buildingCount ?? p.building_count ?? p.count;
      const period = periodLabel(p.year, p.quarter);
      const category = p.tab ? ` · ${p.tab}` : '';
      return `提交了季度数据${period ? ` · ${period}` : ''}${category}${count !== undefined ? `（${count} 条）` : ""}`;
    }
    case "SUBMIT_LEASE_TRANSACTION": {
      const object = [p.company, p.building].filter(Boolean).join(' · ');
      const period = periodLabel(p.year, p.quarter);
      return `提交了租赁成交${object ? `：「${object}」` : ''}${p.area ? ` · ${p.area}㎡` : ''}${period ? ` · ${period}` : ''}`;
    }
    case "DATA_INSERT":
      return `新增了${p.table ?? '数据'}记录${p.recordName ? `：「${p.recordName}」` : ''}`;
    case "DATA_UPDATE":
      return `更新了${p.table ?? '数据'}记录${p.recordName ? `：「${p.recordName}」` : ''}`;
    case "DATA_DELETE":
      return `删除了${p.table ?? '数据'}记录${p.recordName ? `：「${p.recordName}」` : ''}`;
    case "METRICS_UPDATE":
      return `更新了楼宇指标：${p.buildingName ?? p.buildingId ?? ''}`;
    case "METRICS_INSERT":
      return `新增了楼宇指标：${p.buildingName ?? p.buildingId ?? ''}`;
    case "SUBMIT_DATA":
      return `提交了 ${p.year ?? ''} Q${p.quarter ?? ''} 季度数据${p.buildingCount ? `（${p.buildingCount} 栋）` : ''}`;
    case "SUBMIT_LEASE":
      return "提交了租赁成交记录";
    case "EXPORT_DATA": {
      const label = exportDataLabel(p);
      const count = p.record_count ?? p.recordCount ?? p.count;
      const filename = p.file_name ?? p.filename;
      if (p.export_type === 'upload_template') {
        return `下载了「${label}」导入模板${filename ? ` · ${filename}` : ''}`;
      }
      return `导出了「${label}」${count !== undefined ? `（${count} 条）` : ''}${filename ? ` · ${filename}` : ''}`;
    }
    case "EXPORT_LEASE_TRANSACTIONS": {
      const count = p.record_count ?? p.count;
      return `导出了租赁成交数据${count !== undefined ? `（${count} 条）` : ''}${p.file_name ? ` · ${p.file_name}` : ''}`;
    }
    case "EXPORT_BACKUP":
      return `下载了系统数据备份${p.table_count ? `（${p.table_count} 张表）` : ''}${p.file_name ? ` · ${p.file_name}` : ''}`;
    case "PAGE_VIEW":
      return `浏览了「${pageLabel(p.page)}」页面`;
    case "CHANGE_PASSWORD":
      return p.success === false ? "修改密码失败" : "修改了登录密码";
    case "LOGIN_FAILED":
      return `登录失败${p.reason ? `：${p.reason}` : ""}${p.name ? `（${p.name}）` : p.email ? `（${p.email}）` : ""}`;

    case "OSS_CREATE_FOLDER":
      return `创建了云盘文件夹：「${p.folderName ?? p.path ?? ""}」`;
    case "OSS_UPLOAD":
      return `上传了文件到云盘：「${p.fileName ?? p.file_name ?? p.path ?? ""}」`;
    case "OSS_FILE_ACCESS": {
      const name = p.display_name ?? p.file_name ?? p.fileName ?? "未知文件";
      if (p.access_method === 'download') return `下载了研究资料：「${name}」`;
      if (p.access_method === 'preview') return `预览了研究资料：「${name}」`;
      return `访问了研究资料：「${name}」`;
    }
    case "OSS_DELETE":
      return `删除了云盘文件：「${p.fileName ?? p.path ?? ""}」`;
    case "OSS_BATCH_DELETE":
      return `批量删除了 ${p.count ?? "?"} 个云盘文件`;
    case "OSS_MOVE":
      return `移动了云盘文件：「${p.fileName ?? ""}」→「${p.targetPath ?? ""}」`;

    case "MAP_FILTER": {
      const parts: string[] = [];
      // filter 字段是 JSON.stringify 后的字符串，需要解析
      let d: Record<string, any> = {};
      try { d = typeof p.filter === 'string' ? JSON.parse(p.filter) : (p.filter ?? p); } catch { d = p; }
      if (d.districts?.length) parts.push(`区域: ${d.districts.length}个`);
      if (d.submarkets?.length) parts.push(`子市场: ${d.submarkets.length}个`);
      if (d.projectTypes?.length) parts.push(`类型: ${d.projectTypes.join('、')}`);
      if (d.leeds?.length && !d.leeds.includes('NULL')) parts.push(`LEED: ${d.leeds.join('、')}`);
      if (d.subwayLine) parts.push(`地铁线: ${d.subwayLine}`);
      if (d.subwayStation) parts.push(`地铁站: ${d.subwayStation}`);
      if (d.showFutureSupply) parts.push('显示未来供应');
      if (d.numericFilters?.length) parts.push(`${d.numericFilters.length}项数值筛选`);
      return parts.length > 0 ? `地图筛选 — ${parts.join('；')}` : '清除了地图筛选条件';
    }

    // AI / 反馈 / 权限
    case "AI_REQUIREMENT_PARSE":
      return `使用 AI 解析了客户需求${p.model ? `（${p.model}）` : ''}`;
    case "AI_RECOMMENDATION":
      return `生成了 AI 楼宇推荐${p.candidate_count !== undefined ? `（候选 ${p.candidate_count} 个${p.returned_count !== undefined ? `，返回 ${p.returned_count} 个` : ''}）` : ''}`;
    case "SUBMIT_FEEDBACK":
    case "FEEDBACK_SUBMITTED":
      return `提交了问题反馈${p.category ? `（${p.category}）` : ''}`;
    case "FEEDBACK_USER_REPLIED":
      return "回复了问题反馈";
    case "FEEDBACK_ADMIN_CREATED":
      return `管理员创建了问题反馈${p.category ? `（${p.category}）` : ''}`;
    case "FEEDBACK_ADMIN_REPLIED":
      return `管理员回复了问题反馈${p.next_status ? `，状态：${p.next_status}` : ''}`;
    case "FEEDBACK_STATUS_CHANGED":
      return `更新了问题反馈状态${p.old_status || p.new_status ? `：${p.old_status ?? '—'} → ${p.new_status ?? '—'}` : p.status ? `：${p.status}` : p.next_status ? `：${p.next_status}` : ''}`;
    case "UPDATE_LEASE_TEAM_ACCESS": {
      const next = p.enabled_after ?? p.enabled;
      const affected = p.affected_editor_count;
      return `修改了租赁成交团队访问权限${next !== undefined ? `：${next ? '开启' : '关闭'}` : ''}${affected !== undefined ? `（影响 ${affected} 名 Editor）` : ''}`;
    }

    // 系统
    case "CHANGE_SETTINGS":
      return `修改了系统设置${p.key ? `：${p.key}` : ""}`;
    case "CONFIG_CHANGE":
      return p.config_area === 'quarterly_submission_period'
        ? `修改了季度填报周期：${periodLabel(p.year, p.quarter) || '未指定'}`
        : `修改了系统配置${p.config_name ? `：${p.config_name}` : ''}`;

    // 数据操作（管理后台）
    case "ADMIN_DATA_OPERATION": {
      const operationLabels: Record<string, string> = {
        INSERT: '新增',
        UPDATE: '更新',
        DELETE: '删除',
        BULK_INSERT: '批量新增',
        BULK_UPSERT: '批量导入 / 更新',
        EXPORT_EXCEL: '导出 Excel',
      };
      const operation = operationLabels[String(p.operation ?? '')] ?? String(p.operation ?? '操作');
      const target = p.table_label ?? p.table ?? '后台数据';
      const count = p.count ?? p.record_count;
      return `${operation}了「${target}」${count !== undefined ? `（${count} 条）` : ''}`;
    }

    // 转移填报
    case "TRANSFER_SUBMISSION":
      return `转移了填报记录${p.targetUser ? `给 ${p.targetUser}` : ''}${p.count ? `（${p.count} 条）` : ''}`;

    // 模拟用户
    case "IMPERSONATE_START":
    case "impersonate_start":
      return `开始模拟用户：${p.target_email ?? p.target_user_id ?? ''}`;

    case "IMPERSONATE_END":
    case "impersonate_end":
      return `结束模拟用户：${p.target_email ?? p.target_user_id ?? ''}`;

    // 楼宇指标编辑
    case "BUILDING_METRICS_UPDATE":
      return `更新了楼宇指标：${p.building_name ?? p.building_id ?? ''}`;

    case "BUILDING_METRICS_INSERT":
      return `新增了楼宇指标：${p.building_name ?? p.building_id ?? ''}`;

    // 数据库触发器
    case "DB_INSERT":
      return `数据库新增：${p.table ?? ''} 记录`;

    case "DB_UPDATE":
      return `数据库更新：${p.table ?? ''} 记录${p.changed_fields && typeof p.changed_fields === 'object' ? `（${Object.keys(p.changed_fields).length} 项字段）` : ''}`;

    case "LEASE_TRANSACTION_UPDATE":
      return `更新了租赁成交记录${p.change_count ? `（${p.change_count} 项字段）` : ''}`;

    case "DB_DELETE":
      return `数据库删除：${p.table ?? ''} 记录`;

    // 通知相关
    case "NOTIFICATION_RULE_CREATE":
      return `创建了通知规则：${p.rule_name ?? ''}`;

    case "NOTIFICATION_RULE_UPDATE":
      return `更新了通知规则：${p.rule_name ?? ''}`;

    case "NOTIFICATION_SEND":
      return `发送了通知：${p.title ?? ''}`;

    default:
      // 新增操作类型尚未配置中文文案时，不将内部代码暴露给管理员界面。
      return "执行了一项系统操作";
  }
}

// ─── Badge 样式映射 ───────────────────────────────────────────────────────────

const BADGE_MAP: Record<string, BadgeStyle> = {
  PROJECT_MATERIAL_LIBRARY_IMPORT: { variant: "orange", label: "资料归档", className: "bg-orange-50 text-orange-700 ring-orange-100" },
  PROJECT_MATERIAL_PAGE_IMPORT: { variant: "blue", label: "保存证据", className: "bg-blue-50 text-blue-700 ring-blue-100" },
  BROCHURE_ASSOCIATION_CORRECTION: { variant: "orange", label: "楼书纠正", className: "bg-orange-50 text-orange-700 ring-orange-100" },
  SALES_MATERIAL_ACCESS: { variant: "blue", label: "查看资料", className: "bg-blue-50 text-blue-700 ring-blue-100" },
  SALES_MATERIAL_IMPORT: { variant: "orange", label: "资料导入", className: "bg-orange-50 text-orange-700 ring-orange-100" },
  BUILDING_PHOTO_ACCESS: { variant: "blue", label: "查看图片", className: "bg-blue-50 text-blue-700 ring-blue-100" },
  BUILDING_PHOTO_IMPORT: { variant: "orange", label: "图片导入", className: "bg-orange-50 text-orange-700 ring-orange-100" },
  // 导航 → 靛蓝
  ENTER_MODULE: { variant: "blue",    label: "进入板块", className: "bg-indigo-50 text-indigo-700 ring-indigo-100" },
  ACCESS_DENIED: { variant: "red", label: "拒绝访问", className: "bg-red-50 text-red-700 ring-red-100" },

  // 内容创建 → 翠绿
  POST_MESSAGE: { variant: "green",   label: "发布消息", className: "bg-emerald-50 text-emerald-700 ring-emerald-100" },

  // 查询 / 浏览 → 蓝色
  SEARCH:       { variant: "blue",   label: "搜索",   className: "bg-blue-50 text-blue-700 ring-blue-100" },
  LOOKUP_LEASE_COMPANY_HISTORY: { variant: "blue", label: "查询成交", className: "bg-blue-50 text-blue-700 ring-blue-100" },
  FILTER:       { variant: "blue",   label: "筛选",   className: "bg-blue-50 text-blue-700 ring-blue-100" },
  VIEW_PROJECT: { variant: "blue",   label: "查看",   className: "bg-blue-50 text-blue-700 ring-blue-100" },
  VIEW_BUILDING:{ variant: "blue",   label: "查看楼宇", className: "bg-blue-50 text-blue-700 ring-blue-100" },
  MAP_FILTER:   { variant: "blue",   label: "地图筛选", className: "bg-blue-50 text-blue-700 ring-blue-100" },
  PAGE_VIEW:    { variant: "zinc",   label: "页面访问", className: "bg-zinc-100 text-zinc-700 ring-zinc-200" },
  EXPORT_MAP_DATA:{ variant: "purple", label: "导出地图", className: "bg-purple-50 text-purple-700 ring-purple-100" },
  VIEW_BI_CHART:{ variant: "blue",   label: "查看图表", className: "bg-blue-50 text-blue-700 ring-blue-100" },
  OPEN_LEASE_FORM:{ variant: "orange", label: "租赁填报", className: "bg-orange-50 text-orange-700 ring-orange-100" },
  VIEW_USER_SUBMISSION:{ variant: "blue", label: "查看填报", className: "bg-blue-50 text-blue-700 ring-blue-100" },

  // 写入 / 更新 → 橙色
  UPDATE_NOTICE:  { variant: "orange", label: "公告",   className: "bg-orange-50 text-orange-700 ring-orange-100" },
  DELETE_NOTICE:  { variant: "orange", label: "删除公告", className: "bg-orange-50 text-orange-700 ring-orange-100" },
  UPDATE_PROJECT: { variant: "orange", label: "更新",   className: "bg-orange-50 text-orange-700 ring-orange-100" },
  CREATE_PROJECT: { variant: "orange", label: "新建",   className: "bg-orange-50 text-orange-700 ring-orange-100" },
  DELETE_PROJECT: { variant: "red",    label: "删除",   className: "bg-red-50 text-red-700 ring-red-100" },
  IMPORT_DATA:    { variant: "orange", label: "导入",   className: "bg-orange-50 text-orange-700 ring-orange-100" },
  CHANGE_SETTINGS:{ variant: "orange", label: "设置",   className: "bg-orange-50 text-orange-700 ring-orange-100" },
  CONFIG_CHANGE:{ variant: "orange", label: "配置变更", className: "bg-orange-50 text-orange-700 ring-orange-100" },
  CHANGELOG_CREATE:{ variant: "green", label: "新增日志", className: "bg-green-50 text-green-700 ring-green-100" },
  CHANGELOG_UPDATE:{ variant: "orange", label: "更新日志", className: "bg-orange-50 text-orange-700 ring-orange-100" },
  CHANGELOG_DELETE:{ variant: "red",   label: "删除日志", className: "bg-red-50 text-red-700 ring-red-100" },

  // 导出 → 紫色
  EXPORT_CHART:  { variant: "purple", label: "导出图表", className: "bg-purple-50 text-purple-700 ring-purple-100" },
  EXPORT_TABLE:  { variant: "purple", label: "导出表格", className: "bg-purple-50 text-purple-700 ring-purple-100" },
  EXPORT_REPORT: { variant: "purple", label: "导出报告", className: "bg-purple-50 text-purple-700 ring-purple-100" },
  EXPORT_LEASE_TRANSACTIONS: { variant: "purple", label: "导出成交", className: "bg-purple-50 text-purple-700 ring-purple-100" },
  EXPORT_BACKUP: { variant: "red", label: "数据备份", className: "bg-red-50 text-red-700 ring-red-100" },

  // 文件 → 锌灰
  UPLOAD_FILE: { variant: "zinc", label: "上传", className: "bg-zinc-100 text-zinc-700 ring-zinc-200" },
  DELETE_FILE: { variant: "red",  label: "删除文件", className: "bg-red-50 text-red-700 ring-red-100" },

  // 用户管理 → 红色（高风险）
  CREATE_USER: { variant: "green", label: "新建用户", className: "bg-green-50 text-green-700 ring-green-100" },
  UPDATE_USER: { variant: "orange", label: "更新用户", className: "bg-orange-50 text-orange-700 ring-orange-100" },
  DELETE_USER: { variant: "red",   label: "删除用户", className: "bg-red-50 text-red-700 ring-red-100" },

  // 认证 / 安全 → 绿色
  LOGIN:  { variant: "green", label: "登录", className: "bg-green-50 text-green-700 ring-green-100" },
  LOGOUT: { variant: "green", label: "登出", className: "bg-green-50 text-green-700 ring-green-100" },
  LOGIN_FAILED: { variant: "red", label: "登录失败", className: "bg-red-50 text-red-700 ring-red-100" },
  CHANGE_PASSWORD: { variant: "orange", label: "修改密码", className: "bg-orange-50 text-orange-700 ring-orange-100" },

  // 提交操作 → 绿色
  SUBMIT_QUARTERLY_DATA: { variant: "green", label: "提交数据", className: "bg-green-50 text-green-700 ring-green-100" },
  SUBMIT_LEASE_TRANSACTION: { variant: "green", label: "提交成交", className: "bg-green-50 text-green-700 ring-green-100" },
  DATA_INSERT: { variant: "green", label: "新增数据", className: "bg-emerald-50 text-emerald-700 ring-emerald-100" },
  DATA_UPDATE: { variant: "orange", label: "更新数据", className: "bg-orange-50 text-orange-700 ring-orange-100" },
  DATA_DELETE: { variant: "red", label: "删除数据", className: "bg-red-50 text-red-700 ring-red-100" },
  METRICS_UPDATE: { variant: "orange", label: "更新指标", className: "bg-orange-50 text-orange-700 ring-orange-100" },
  METRICS_INSERT: { variant: "green", label: "新增指标", className: "bg-emerald-50 text-emerald-700 ring-emerald-100" },
  SUBMIT_DATA: { variant: "green", label: "提交数据", className: "bg-emerald-50 text-emerald-700 ring-emerald-100" },
  SUBMIT_LEASE: { variant: "green", label: "提交成交", className: "bg-emerald-50 text-emerald-700 ring-emerald-100" },
  EXPORT_DATA: { variant: "purple", label: "导出数据", className: "bg-purple-50 text-purple-700 ring-purple-100" },

  // 数据操作 → 橙色
  ADMIN_DATA_OPERATION: { variant: "orange", label: "数据操作", className: "bg-orange-50 text-orange-700 ring-orange-100" },

  // 转移 → 靛蓝
  TRANSFER_SUBMISSION: { variant: "blue", label: "转移填报", className: "bg-indigo-50 text-indigo-700 ring-indigo-100" },

  // 模拟用户 → 紫色
  IMPERSONATE_START: { variant: "purple", label: "模拟开始", className: "bg-purple-50 text-purple-700 ring-purple-100" },
  impersonate_start: { variant: "purple", label: "模拟开始", className: "bg-purple-50 text-purple-700 ring-purple-100" },
  IMPERSONATE_END: { variant: "purple", label: "模拟结束", className: "bg-purple-50 text-purple-700 ring-purple-100" },
  impersonate_end: { variant: "purple", label: "模拟结束", className: "bg-purple-50 text-purple-700 ring-purple-100" },

  // 楼宇指标 → 橙色
  BUILDING_METRICS_UPDATE: { variant: "orange", label: "更新指标", className: "bg-orange-50 text-orange-700 ring-orange-100" },
  BUILDING_METRICS_INSERT: { variant: "green", label: "新增指标", className: "bg-green-50 text-green-700 ring-green-100" },

  // 数据库触发器 → 蓝色
  DB_INSERT: { variant: "green", label: "DB新增", className: "bg-emerald-50 text-emerald-700 ring-emerald-100" },
  DB_UPDATE: { variant: "blue", label: "DB更新", className: "bg-blue-50 text-blue-700 ring-blue-100" },
  LEASE_TRANSACTION_UPDATE: { variant: "blue", label: "成交变更", className: "bg-blue-50 text-blue-700 ring-blue-100" },
  DB_DELETE: { variant: "red", label: "DB删除", className: "bg-red-50 text-red-700 ring-red-100" },

  // 通知 → 蓝色
  NOTIFICATION_RULE_CREATE: { variant: "blue", label: "创建规则", className: "bg-blue-50 text-blue-700 ring-blue-100" },
  NOTIFICATION_RULE_UPDATE: { variant: "blue", label: "更新规则", className: "bg-blue-50 text-blue-700 ring-blue-100" },
  NOTIFICATION_SEND: { variant: "purple", label: "发送通知", className: "bg-purple-50 text-purple-700 ring-purple-100" },

  // 云盘操作 → 蓝色
  OSS_CREATE_FOLDER: { variant: "blue", label: "创建文件夹", className: "bg-blue-50 text-blue-700 ring-blue-100" },
  OSS_UPLOAD: { variant: "green", label: "上传文件", className: "bg-green-50 text-green-700 ring-green-100" },
  OSS_FILE_ACCESS: { variant: "purple", label: "资料访问", className: "bg-purple-50 text-purple-700 ring-purple-100" },
  OSS_DELETE: { variant: "red", label: "删除文件", className: "bg-red-50 text-red-700 ring-red-100" },
  OSS_BATCH_DELETE: { variant: "red", label: "批量删除", className: "bg-red-50 text-red-700 ring-red-100" },
  OSS_MOVE: { variant: "orange", label: "移动文件", className: "bg-orange-50 text-orange-700 ring-orange-100" },

  // AI / 反馈 / 权限
  AI_REQUIREMENT_PARSE: { variant: "blue", label: "AI解析", className: "bg-blue-50 text-blue-700 ring-blue-100" },
  AI_RECOMMENDATION: { variant: "blue", label: "AI推荐", className: "bg-blue-50 text-blue-700 ring-blue-100" },
  SUBMIT_FEEDBACK: { variant: "green", label: "提交反馈", className: "bg-green-50 text-green-700 ring-green-100" },
  FEEDBACK_SUBMITTED: { variant: "green", label: "提交反馈", className: "bg-green-50 text-green-700 ring-green-100" },
  FEEDBACK_USER_REPLIED: { variant: "blue", label: "回复反馈", className: "bg-blue-50 text-blue-700 ring-blue-100" },
  FEEDBACK_ADMIN_CREATED: { variant: "green", label: "创建反馈", className: "bg-green-50 text-green-700 ring-green-100" },
  FEEDBACK_ADMIN_REPLIED: { variant: "blue", label: "回复反馈", className: "bg-blue-50 text-blue-700 ring-blue-100" },
  FEEDBACK_STATUS_CHANGED: { variant: "orange", label: "反馈状态", className: "bg-orange-50 text-orange-700 ring-orange-100" },
  UPDATE_LEASE_TEAM_ACCESS: { variant: "orange", label: "权限设置", className: "bg-orange-50 text-orange-700 ring-orange-100" },
};

const FALLBACK_BADGE: BadgeStyle = {
  variant: "zinc",
  label: "系统操作",
  className: "bg-zinc-100 text-zinc-600 ring-zinc-200",
};

/**
 * 根据 action_type 返回对应的 Badge 样式配置。
 */
export function getLogBadgeStyle(action: string): BadgeStyle {
  return BADGE_MAP[action] ?? FALLBACK_BADGE;
}
