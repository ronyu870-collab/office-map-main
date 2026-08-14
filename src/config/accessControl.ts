/**
 * 访问控制配置模块
 * 
 * 本模块定义了需要管理员权限才能访问的受限模块配置。
 * 用于实现基于角色的访问控制（RBAC）功能。
 */

/**
 * 受限模块类型定义
 * 
 * @property module - 模块标识符，必须与 NAV_MODULES 中的 module 字段匹配
 * @property href - 路由路径，用于导航和权限验证
 */
export type RestrictedModule = {
  module: string;
  href: string;
};

/**
 * 受限模块配置列表
 * 
 * 用途：
 * - 定义需要管理员权限才能访问的模块
 * - 管理员（admin）可以正常访问这些模块
 * - 非管理员（viewer/editor）无法访问，显示灰色禁用样式
 * 
 * 维护方法：
 * - 添加新的受限模块：在数组中添加 { module, href } 对象
 * - 移除访问限制：从数组中移除对应项即可
 * 
 * 注意事项：
 * - module 字段必须与 NAV_MODULES 中的 module 字段完全匹配
 * - href 字段必须与实际路由路径一致
 * - 修改此配置后，访问控制逻辑会自动应用到相关模块
 * 
 * 当前受限模块：
 * - bi: 商业智能看板 - 包含敏感的市场分析数据
 * - deals: 租赁成交 - 包含商业交易信息
 */
export const RESTRICTED_MODULES: RestrictedModule[] = [
  { module: 'deals', href: '/deals' },
];
