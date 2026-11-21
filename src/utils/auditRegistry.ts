/** Shared event semantics. Classification never grants authority to a browser event. */
export const AUDIT_SCHEMA_VERSION = 3;
export type AuditTier = 'A' | 'B' | 'C';
export type AuditDelivery = 'transaction' | 'server-durable' | 'managed-best-effort' | 'client-batch' | 'suppressed';
export interface AuditDefinition { tier: AuditTier; label: string; delivery: AuditDelivery }
const critical = (label: string, delivery: AuditDelivery = 'server-durable'): AuditDefinition => ({ tier: 'A', label, delivery });
const ordinary = (label: string): AuditDefinition => ({ tier: 'B', label, delivery: 'client-batch' });
export const AUDIT_EVENT_REGISTRY: Readonly<Record<string, AuditDefinition>> = {
  DB_INSERT: critical('新增业务数据', 'transaction'), DB_UPDATE: critical('修改业务数据', 'transaction'), DB_DELETE: critical('删除业务数据', 'transaction'),
  ADMIN_FIELD_CHANGE: critical('关键业务字段变更', 'transaction'),
  QUARTERLY_RECORD_INSERT: critical('新增季度记录', 'transaction'), QUARTERLY_RECORD_UPDATE: critical('修正季度记录', 'transaction'), QUARTERLY_RECORD_DELETE: critical('删除季度记录', 'transaction'),
  BUILDING_INSERT: critical('新增楼宇', 'transaction'), BUILDING_UPDATE: critical('修改楼宇', 'transaction'), BUILDING_DELETE: critical('删除楼宇', 'transaction'),
  METRICS_INSERT: critical('新增季度指标', 'transaction'), METRICS_UPDATE: critical('修改季度指标', 'transaction'), METRICS_DELETE: critical('删除季度指标', 'transaction'),
  LEASE_TRANSACTION_INSERT: critical('新增成交', 'transaction'), LEASE_TRANSACTION_DELETE: critical('删除成交', 'transaction'),
  USER_PERMISSION_CHANGE: critical('修改用户权限', 'transaction'), EXPORT_LEASE_TRANSACTIONS: critical('导出成交'),
  BUILDING_PHOTO_IMPORT: critical('导入楼宇图片'), SALES_MATERIAL_IMPORT: critical('导入项目资料'), SALES_MATERIAL_DOWNLOAD: critical('下载项目原件'),
  PROJECT_MATERIAL_LIBRARY_IMPORT: critical('归档原始资料'), PROJECT_MATERIAL_PAGE_IMPORT: critical('保存资料页证据'),
  EXPORT_DATA: critical('导出业务数据'), EXPORT_REPORT: ordinary('导出业务报告'), EXPORT_TEMPLATE: ordinary('下载空白模板'), EXPORT_MAP_DATA: critical('导出地图数据'), EXPORT_BUILDING_COMPARISON: critical('导出楼宇对比'),
  CHANGELOG_DELETE: critical('删除更新记录'), DELETE_NOTICE: critical('删除公告'),
  OSS_CREATE_FOLDER: critical('创建资料目录'), OSS_FILE_DOWNLOAD: critical('下载研究资料'),
  CREATE_USER: critical('创建账号'), UPDATE_USER: critical('修改账号权限'), DELETE_USER: critical('删除账号'),
  CHANGE_PASSWORD: critical('修改账号安全设置'), CONFIG_CHANGE: critical('修改配置'),
  IMPERSONATE_START: critical('开始身份模拟'), IMPERSONATE_END: critical('结束身份模拟'),
  DATA_DELETE: critical('删除业务数据'), DELETE_PROJECT: critical('删除楼宇'),
  IMPORT_DATA: critical('批量导入'), ADMIN_DATA_OPERATION: critical('后台数据操作'),
  SUBMIT_QUARTERLY_DATA: critical('提交季度数据', 'transaction'), SUBMIT_DATA: critical('提交季度数据', 'transaction'),
  SUBMIT_LEASE_TRANSACTION: critical('新增成交'), LEASE_TRANSACTION_UPDATE: critical('修改成交', 'transaction'),
  LEASE_EXPIRY_REVIEW_SAVE: critical('保存租约核实', 'transaction'),
  OSS_UPLOAD: critical('上传资料'), OSS_DELETE: critical('删除资料'), OSS_BATCH_DELETE: critical('批量删除资料'),
  OSS_MOVE: critical('移动资料'), EXPORT_BACKUP: critical('导出备份'),
  AUDIT_EXPORT: critical('导出业务审计', 'transaction'), AUDIT_ACCESS_CHANGE: critical('修改审计资格', 'transaction'),
  AI_AUDIT_EXPORT: critical('导出 AI 审计', 'transaction'),
  AI_REQUIREMENT_PARSE: {tier:'B',label:'解析选址需求摘要',delivery:'managed-best-effort'}, AI_RECOMMENDATION: {tier:'B',label:'生成选址推荐摘要',delivery:'managed-best-effort'},
  VIEW_BUILDING: ordinary('查看楼宇'), PAGE_VIEW: ordinary('浏览页面'), ENTER_MODULE: ordinary('进入模块'),
  SEARCH: ordinary('完成搜索'), FILTER: ordinary('完成筛选'), MAP_FILTER: ordinary('完成地图筛选'),
  BUILDING_PHOTO_ACCESS: { tier: 'B', label: '访问楼宇图片', delivery: 'managed-best-effort' },
  SALES_MATERIAL_ACCESS: { tier: 'B', label: '访问项目资料', delivery: 'managed-best-effort' },
  OSS_FILE_ACCESS: { tier: 'B', label: '访问研究资料', delivery: 'managed-best-effort' },
  CLIENT_MUTATION_OBSERVED: ordinary('客户端观察到写请求响应'),
  ...Object.fromEntries(['MAP_MOVE', 'MAP_ZOOM', 'HOVER', 'SCROLL', 'INPUT_CHANGE', 'POINTER_MOVE'].map(action =>
    [action, { tier: 'C', label: '高频交互', delivery: 'suppressed' } as AuditDefinition])),
};
export function auditDefinition(action: string): AuditDefinition {
  const name = action.trim().toUpperCase();
  return AUDIT_EVENT_REGISTRY[name] ?? (/DELETE|PERMISSION|GRANT|REVOKE|IMPORT|PASSWORD|BACKUP|CONFIG|ROLE|EXPORT/.test(name)
    ? critical(name) : ordinary(name));
}
export function auditOutcome(event: { request_source?: string; error_message?: string; details?: Record<string, unknown> }): string {
  const details = event.details || {};
  if (event.request_source === 'frontend') return '客户端报告';
  if (details.business_outcome === 'partial' || details.outcome === 'partial') return '部分完成';
  if (details.business_outcome === 'denied' || details.outcome === 'denied' || details.blocked === true) return '拒绝';
  if (event.error_message || details.business_outcome === 'failed' || details.success === false || ['failed', 'failure', 'error'].includes(String(details.outcome))) return '失败';
  if (['success', 'succeeded'].includes(String(details.outcome)) || event.request_source === 'database_trigger') return '已确认';
  return '已记录';
}
