import { parseUserRole } from '@/src/types/auth';

/**
 * 首页「企业选址洞察报告」卡片的可见范围。
 *
 * 报告页面本身是公开链接：/occupier-insights 不需要登录即可阅读，
 * 外部分享链接的访问不受影响。这里只收缩首页入口的展示范围，
 * 不在允许名单内的用户首页不出现该板块。
 */
export const OCCUPIER_REPORT_CARD_EMAILS: readonly string[] = [
  // 闫涛 / Tony Yan
  'tony.yan@colliers.com',
];

export function canSeeOccupierReportCard(
  role: string | null | undefined,
  email: string | null | undefined,
): boolean {
  const parsedRole = parseUserRole(role);
  if (!parsedRole) return false;
  if (parsedRole === 'admin') return true;

  const normalized = email?.trim().toLowerCase();
  return normalized ? OCCUPIER_REPORT_CARD_EMAILS.includes(normalized) : false;
}
