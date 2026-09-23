/** 统一审计日志采集层。实际发送由 utils/audit 的异步持久化队列完成。 */
import { clearAuditSessionContext, ensureAuditSessionContext, logAuditEvent } from '../utils/audit';

export const ACTION_TYPES = {
  LOGIN: 'LOGIN', LOGOUT: 'LOGOUT', LOGIN_FAILED: 'LOGIN_FAILED', CHANGE_PASSWORD: 'CHANGE_PASSWORD', DELETE_USER: 'DELETE_USER',
  DATA_INSERT: 'DATA_INSERT', DATA_UPDATE: 'DATA_UPDATE', DATA_DELETE: 'DATA_DELETE', METRICS_UPDATE: 'METRICS_UPDATE', METRICS_INSERT: 'METRICS_INSERT',
  SUBMIT_DATA: 'SUBMIT_DATA', SUBMIT_LEASE: 'SUBMIT_LEASE', EXPORT_DATA: 'EXPORT_DATA', CONFIG_CHANGE: 'CONFIG_CHANGE', CREATE_USER: 'CREATE_USER', UPDATE_USER: 'UPDATE_USER',
  VIEW_BUILDING: 'VIEW_BUILDING', VIEW_CHART: 'VIEW_CHART', SEARCH: 'SEARCH', FILTER: 'FILTER', MAP_FILTER: 'MAP_FILTER',
  PAGE_VIEW: 'PAGE_VIEW', ENTER_MODULE: 'ENTER_MODULE',
} as const;

export type ActionType = typeof ACTION_TYPES[keyof typeof ACTION_TYPES];

const ACTION_LEVELS: Record<string, 'P0' | 'P1' | 'P2' | 'P3'> = {
  LOGIN: 'P0', LOGOUT: 'P0', LOGIN_FAILED: 'P0', CHANGE_PASSWORD: 'P0', DELETE_USER: 'P0',
  DATA_INSERT: 'P1', DATA_UPDATE: 'P1', DATA_DELETE: 'P1', METRICS_UPDATE: 'P1', METRICS_INSERT: 'P1', SUBMIT_DATA: 'P1', SUBMIT_LEASE: 'P1', EXPORT_DATA: 'P1', CONFIG_CHANGE: 'P1', CREATE_USER: 'P1', UPDATE_USER: 'P1',
  VIEW_BUILDING: 'P2', VIEW_CHART: 'P2', SEARCH: 'P2', FILTER: 'P2', MAP_FILTER: 'P2',
  PAGE_VIEW: 'P3', ENTER_MODULE: 'P3',
};

let currentUserId: string | null = null;

export function setCurrentUser(userId: string, _email?: string) {
  // Account switches must invalidate the old in-memory audit origin synchronously.
  // The async refresh below then binds future events to the new Auth session.
  if (currentUserId !== userId) clearAuditSessionContext();
  currentUserId = userId;
  void ensureAuditSessionContext(userId).catch(() => { /* audit context is best-effort */ });
}
export function clearCurrentUser() {
  currentUserId = null;
  clearAuditSessionContext();
}

function getContext() {
  if (typeof window === 'undefined') return {};
  return {
    page_url: window.location.pathname,
    user_agent: navigator.userAgent?.slice(0, 500),
    module: window.location.pathname.split('/')[1] || 'home',
  };
}

export function audit(
  actionType: ActionType,
  details: Record<string, unknown> = {},
  options?: {
    immediate?: boolean; userId?: string; module?: string; targetTable?: string; targetId?: string; targetName?: string;
    oldValues?: Record<string, unknown>; newValues?: Record<string, unknown>; durationMs?: number; errorMessage?: string;
  },
) {
  if (!(options?.userId || currentUserId)) return;
  try { if (typeof window !== 'undefined' && sessionStorage.getItem('__impersonation_state')) return; } catch {}

  const context = getContext();
  logAuditEvent({
    action_type: actionType,
    details: { ...details, _level: ACTION_LEVELS[actionType] || 'P2' },
    request_source: 'frontend',
    module: options?.module || context.module,
    page_url: context.page_url,
    user_agent: context.user_agent,
    target_table: options?.targetTable,
    target_id: options?.targetId,
    target_name: options?.targetName,
    old_values: options?.oldValues,
    new_values: options?.newValues,
    duration_ms: options?.durationMs,
    error_message: options?.errorMessage,
  });
}

/** 为兼容旧调用保留参数；当前阶段不再采样，保证行为记录完整。 */
export function auditSampled(actionType: ActionType, details: Record<string, unknown> = {}, _sampleRate = 1) { audit(actionType, details); }

export const auditLogin = (userId: string, email: string) => audit(ACTION_TYPES.LOGIN, { email }, { userId });
export const auditLogout = () => audit(ACTION_TYPES.LOGOUT, {}, { immediate: true });
export const auditLoginFailed = (email: string, reason?: string) => audit(ACTION_TYPES.LOGIN_FAILED, { email, reason }, { immediate: true });
export const auditDataInsert = (table: string, record: any) => audit(ACTION_TYPES.DATA_INSERT, { table, record_id: record?.id, record_name: record?.name || record?.title });
export const auditDataUpdate = (table: string, recordId: string, changes: Record<string, unknown>) => audit(ACTION_TYPES.DATA_UPDATE, { table, record_id: recordId, changes });
export const auditDataDelete = (table: string, recordId: string, recordName?: string) => audit(ACTION_TYPES.DATA_DELETE, { table, record_id: recordId, record_name: recordName });
export const auditMetricsUpdate = (buildingId: string, buildingName: string, changes: Record<string, unknown>) => audit(ACTION_TYPES.METRICS_UPDATE, { building_id: buildingId, building_name: buildingName, changes });
export const auditMetricsInsert = (buildingId: string, buildingName: string, year: number, quarter: number) => audit(ACTION_TYPES.METRICS_INSERT, { building_id: buildingId, building_name: buildingName, year, quarter });
export const auditSubmitData = (year: number, quarter: number, buildingCount: number) => audit(ACTION_TYPES.SUBMIT_DATA, { year, quarter, building_count: buildingCount });
export const auditExportData = (exportType: string, recordCount: number, filters?: unknown) => audit(ACTION_TYPES.EXPORT_DATA, { export_type: exportType, record_count: recordCount, filters });
export const auditViewBuilding = (buildingId: string, buildingName: string) => audit(ACTION_TYPES.VIEW_BUILDING, { building_id: buildingId, building_name: buildingName });
export const auditPageView = (page: string) => audit(ACTION_TYPES.PAGE_VIEW, { page }, { targetName: page });
export const auditSearch = (keyword: string, module: string) => audit(ACTION_TYPES.SEARCH, { keyword, module });
export const auditMapFilter = (filters: Record<string, unknown>) => audit(ACTION_TYPES.MAP_FILTER, { filters }, { module: 'map', targetName: '地图筛选' });
export const auditEnterModule = (module: string) => audit(ACTION_TYPES.ENTER_MODULE, { module }, { module, targetName: module });

export const AuditService = {
  audit, auditSampled, setCurrentUser, clearCurrentUser,
  login: auditLogin, logout: auditLogout, loginFailed: auditLoginFailed, dataInsert: auditDataInsert, dataUpdate: auditDataUpdate,
  dataDelete: auditDataDelete, metricsUpdate: auditMetricsUpdate, metricsInsert: auditMetricsInsert, submitData: auditSubmitData,
  exportData: auditExportData, viewBuilding: auditViewBuilding, pageView: auditPageView, search: auditSearch, mapFilter: auditMapFilter, enterModule: auditEnterModule,
};
export default AuditService;
