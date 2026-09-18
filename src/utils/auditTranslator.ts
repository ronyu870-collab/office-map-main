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

// ─── 翻译引擎 ────────────────────────────────────────────────────────────────

/**
 * 将 action_type + details payload 翻译为一句人类可读的中文描述。
 */
export function parseAuditLog(action: string, payload: Record<string, any> = {}): string {
  const p = payload ?? {};

  switch (action) {
    // 搜索 / 查询
    case "SEARCH":
      return `在「${p.module ?? "未知模块"}」板块搜索了关键词："${p.keyword ?? p.query ?? ""}"`;
    case "LOOKUP_LEASE_COMPANY_HISTORY":
      return `查询了企业历史成交：${p.company ?? '未提供企业名称'}${p.match_count !== undefined ? `（匹配 ${p.match_count} 条）` : ''}`;
    case "FILTER":
      return `在「${p.module ?? "未知模块"}」板块应用了筛选条件`;

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
    case "EXPORT_REPORT":
      return `导出了报告：「${p.reportName ?? p.report_name ?? "未命名报告"}」`;

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
      return p.module ? `进入了「${p.module}」板块` : "进入了系统板块";
    case "VIEW_BUILDING":
      return `查看了楼宇详情：「${p.buildingName ?? p.buildingId ?? "未知楼宇"}」`;
    case "EXPORT_MAP_DATA":
      return "导出了地图数据";
    case "VIEW_BI_CHART": {
      const tabName = p.tab === 'submarket' ? '子市场分析' : p.tab === 'pe' ? '私募板块' : p.tab === 'lease' ? '租赁成交分析' : p.tab ?? '';
      return `查看了商业分析图表：「${tabName}」`;
    }
    case "OPEN_LEASE_FORM":
      return p.mode === 'edit' ? `打开了租赁成交编辑表单` : `打开了租赁成交填报表单`;
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

    case "SUBMIT_QUARTERLY_DATA":
      return `提交了季度数据${p.buildingCount ? `（${p.buildingCount} 栋楼宇）` : ""}${p.year && p.quarter ? ` - ${p.year} Q${p.quarter}` : ""}`;
    case "SUBMIT_LEASE_TRANSACTION":
      return `提交了租赁成交记录${p.company ? `：「${p.company}」` : ""}${p.area ? ` ${p.area}㎡` : ""}`;
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
    case "EXPORT_DATA":
      return `导出了${p.exportType ?? '数据'}${p.recordCount ? `（${p.recordCount} 条）` : ''}`;
    case "PAGE_VIEW":
      return `浏览了页面：${p.page ?? ''}`;
    case "CHANGE_PASSWORD":
      return p.success === false ? "修改密码失败" : "修改了登录密码";
    case "LOGIN_FAILED":
      return `登录失败${p.reason ? `：${p.reason}` : ""}${p.name ? `（${p.name}）` : p.email ? `（${p.email}）` : ""}`;

    case "OSS_CREATE_FOLDER":
      return `创建了云盘文件夹：「${p.folderName ?? p.path ?? ""}」`;
    case "OSS_UPLOAD":
      return `上传了文件到云盘：「${p.fileName ?? p.path ?? ""}」`;
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

    // 系统
    case "CHANGE_SETTINGS":
      return `修改了系统设置${p.key ? `：${p.key}` : ""}`;

    // 数据操作（管理后台）
    case "ADMIN_DATA_OPERATION":
      return `数据操作：${p.operation ?? ''} ${p.table_label ?? p.table ?? ''}`;

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
  // 导航 → 靛蓝
  ENTER_MODULE: { variant: "blue",    label: "进入板块", className: "bg-indigo-50 text-indigo-700 ring-indigo-100" },

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

  // 写入 / 更新 → 橙色
  UPDATE_NOTICE:  { variant: "orange", label: "公告",   className: "bg-orange-50 text-orange-700 ring-orange-100" },
  DELETE_NOTICE:  { variant: "orange", label: "删除公告", className: "bg-orange-50 text-orange-700 ring-orange-100" },
  UPDATE_PROJECT: { variant: "orange", label: "更新",   className: "bg-orange-50 text-orange-700 ring-orange-100" },
  CREATE_PROJECT: { variant: "orange", label: "新建",   className: "bg-orange-50 text-orange-700 ring-orange-100" },
  DELETE_PROJECT: { variant: "red",    label: "删除",   className: "bg-red-50 text-red-700 ring-red-100" },
  IMPORT_DATA:    { variant: "orange", label: "导入",   className: "bg-orange-50 text-orange-700 ring-orange-100" },
  CHANGE_SETTINGS:{ variant: "orange", label: "设置",   className: "bg-orange-50 text-orange-700 ring-orange-100" },
  CHANGELOG_CREATE:{ variant: "green", label: "新增日志", className: "bg-green-50 text-green-700 ring-green-100" },
  CHANGELOG_UPDATE:{ variant: "orange", label: "更新日志", className: "bg-orange-50 text-orange-700 ring-orange-100" },
  CHANGELOG_DELETE:{ variant: "red",   label: "删除日志", className: "bg-red-50 text-red-700 ring-red-100" },

  // 导出 → 紫色
  EXPORT_CHART:  { variant: "purple", label: "导出图表", className: "bg-purple-50 text-purple-700 ring-purple-100" },
  EXPORT_TABLE:  { variant: "purple", label: "导出表格", className: "bg-purple-50 text-purple-700 ring-purple-100" },
  EXPORT_REPORT: { variant: "purple", label: "导出报告", className: "bg-purple-50 text-purple-700 ring-purple-100" },

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
  OSS_DELETE: { variant: "red", label: "删除文件", className: "bg-red-50 text-red-700 ring-red-100" },
  OSS_BATCH_DELETE: { variant: "red", label: "批量删除", className: "bg-red-50 text-red-700 ring-red-100" },
  OSS_MOVE: { variant: "orange", label: "移动文件", className: "bg-orange-50 text-orange-700 ring-orange-100" },
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
