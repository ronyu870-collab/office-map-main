/**
 * 访问控制工具函数模块
 * 
 * 本模块提供基于角色的访问控制（RBAC）工具函数，用于判断用户对特定模块的访问权限。
 * 支持健壮的角色验证，处理各种边缘情况（null、undefined、空格、大小写等）。
 */

import { RESTRICTED_MODULES } from '@/src/config/accessControl';

/**
 * 检查模块是否为受限模块
 * 
 * 此函数通过查询 RESTRICTED_MODULES 配置来判断指定模块是否需要管理员权限。
 * 
 * @param moduleId - 模块标识符（如 'bi', 'deals', 'map' 等）
 * @returns 如果模块在受限列表中返回 true，否则返回 false
 * 
 * @example
 * ```typescript
 * isModuleRestricted('bi')     // true - 商业智能看板需要管理员权限
 * isModuleRestricted('deals')  // true - 租赁成交需要管理员权限
 * isModuleRestricted('map')    // false - 地图模块不受限
 * ```
 */
export function isModuleRestricted(moduleId: string): boolean {
  try {
    return RESTRICTED_MODULES.some(m => m.module === moduleId);
  } catch (error) {
    console.error('检查受限模块时发生错误:', error);
    // 发生错误时默认返回 false，避免误拦截正常模块
    return false;
  }
}

/**
 * 检查用户是否为管理员
 * 
 * 此函数实现健壮的角色验证逻辑，处理各种边缘情况：
 * - null/undefined → 视为非管理员（安全默认值）
 * - 空字符串 → 视为非管理员
 * - 自动去除前后空格（如 '  admin  ' → 'admin'）
 * - 大小写不敏感（如 'ADMIN', 'Admin', 'admin' 都识别为管理员）
 * 
 * @param role - 用户角色字符串，可能为 null 或 undefined
 * @returns 如果角色为 'admin'（忽略大小写和空格）返回 true，否则返回 false
 * 
 * @example
 * ```typescript
 * isUserAdmin('admin')      // true
 * isUserAdmin('ADMIN')      // true
 * isUserAdmin('  Admin  ')  // true
 * isUserAdmin('viewer')     // false
 * isUserAdmin('editor')     // false
 * isUserAdmin(null)         // false
 * isUserAdmin(undefined)    // false
 * isUserAdmin('')           // false
 * ```
 */
export function isUserAdmin(role: string | null | undefined): boolean {
  try {
    // 处理 null、undefined 和空字符串
    if (!role) {
      return false;
    }
    
    // 去除前后空格并转换为小写进行比较
    const normalizedRole = role.trim().toLowerCase();
    return normalizedRole === 'admin';
  } catch (error) {
    console.error('验证用户角色时发生错误:', error);
    // 发生错误时默认返回 false（最小权限原则）
    return false;
  }
}

/**
 * 判断用户是否可以访问指定模块
 * 
 * 此函数是访问控制的核心决策函数，综合考虑模块限制和用户角色：
 * 
 * 决策逻辑：
 * 1. 如果模块不受限 → 允许所有用户访问
 * 2. 如果模块受限 + 用户是管理员 → 允许访问
 * 3. 如果模块受限 + 用户是高管 (executive) → 允许访问（只读）
 * 4. 如果模块受限 + 用户是其他角色 → 拒绝访问
 * 
 * @param moduleId - 模块标识符
 * @param userRole - 用户角色，可能为 null 或 undefined
 * @returns 如果用户可以访问该模块返回 true，否则返回 false
 * 
 * @example
 * ```typescript
 * // 非受限模块 - 所有用户都可以访问
 * canAccessModule('map', 'viewer')     // true
 * canAccessModule('map', 'admin')      // true
 * canAccessModule('map', null)         // true
 * 
 * // 受限模块 - 管理员和高管可以访问
 * canAccessModule('bi', 'admin')       // true
 * canAccessModule('bi', 'executive')   // true
 * canAccessModule('bi', 'viewer')      // false
 * canAccessModule('bi', null)          // false
 * canAccessModule('deals', 'editor')   // false
 * ```
 */
export function canAccessModule(
  moduleId: string,
  userRole: string | null | undefined
): boolean {
  try {
    // BI 看板：仅 editor 不可访问，其他角色均可
    if (moduleId === 'bi') {
      return userRole !== 'editor';
    }

    // 检查模块是否受限
    const isRestricted = isModuleRestricted(moduleId);

    // 如果模块不受限，所有用户都可以访问
    if (!isRestricted) {
      return true;
    }

    // 如果模块受限，管理员和高管可以访问
    return isUserAdmin(userRole);
  } catch (error) {
    console.error('判断模块访问权限时发生错误:', error);
    // 发生错误时默认拒绝访问（安全默认值）
    return false;
  }
}

/**
 * 模块样式配置类型
 * 
 * @property cardClass - 卡片容器的 CSS 类名
 * @property iconClass - 图标的 CSS 类名
 * @property textClass - 文本的 CSS 类名
 * @property cursorClass - 鼠标光标的 CSS 类名
 */
export type ModuleStyles = {
  cardClass: string;
  iconClass: string;
  textClass: string;
  cursorClass: string;
};

/**
 * 获取模块卡片的样式类名
 * 
 * 此函数根据用户的访问权限返回不同的 Tailwind CSS 样式类名：
 * 
 * 可访问模块样式：
 * - 白色背景，带边框和阴影
 * - 悬停时有上移动画和阴影增强效果
 * - 图标和文本在悬停时变为品牌蓝色
 * - 正常鼠标指针
 * 
 * 受限模块样式（非管理员）：
 * - 灰色背景（bg-zinc-100）
 * - 浅灰色文本（text-zinc-400）
 * - 图标半透明（opacity-50）
 * - 禁用鼠标指针（cursor-not-allowed）
 * - 无悬停效果
 * 
 * @param moduleId - 模块标识符
 * @param userRole - 用户角色，可能为 null 或 undefined
 * @returns 包含各部分样式类名的对象
 * 
 * @example
 * ```typescript
 * // 管理员访问受限模块 - 返回正常样式
 * getModuleStyles('bi', 'admin')
 * // {
 * //   cardClass: "group relative flex ... hover:shadow-md",
 * //   iconClass: "text-zinc-500 ... group-hover:text-[#003e7e]",
 * //   textClass: "text-[13px] ... group-hover:text-[#003e7e]",
 * //   cursorClass: "cursor-pointer"
 * // }
 * 
 * // 非管理员访问受限模块 - 返回禁用样式
 * getModuleStyles('bi', 'viewer')
 * // {
 * //   cardClass: "relative flex ... bg-zinc-100 ... cursor-not-allowed",
 * //   iconClass: "text-zinc-400 opacity-50",
 * //   textClass: "text-[13px] ... text-zinc-400",
 * //   cursorClass: "cursor-not-allowed"
 * // }
 * 
 * // 非受限模块 - 所有用户都返回正常样式
 * getModuleStyles('map', 'viewer')
 * // 返回正常样式（与管理员相同）
 * ```
 */
export function getModuleStyles(
  moduleId: string,
  userRole: string | null | undefined
): ModuleStyles {
  try {
    const canAccess = canAccessModule(moduleId, userRole);
    
    if (canAccess) {
      // 正常可访问样式
      return {
        cardClass: "group relative flex flex-1 items-center justify-between rounded-xl border border-zinc-200/60 bg-white px-4 py-3 shadow-sm transition hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-md",
        iconClass: "text-zinc-500 transition group-hover:text-primary",
        textClass: "text-[13px] font-semibold tracking-tight text-zinc-900 group-hover:text-primary",
        cursorClass: "cursor-pointer"
      };
    } else {
      // 受限模块样式（灰色禁用）
      return {
        cardClass: "relative flex flex-1 items-center justify-between rounded-xl border border-zinc-200/60 bg-zinc-100 px-4 py-3 shadow-sm cursor-not-allowed",
        iconClass: "text-zinc-400 opacity-50",
        textClass: "text-[13px] font-semibold tracking-tight text-zinc-400",
        cursorClass: "cursor-not-allowed"
      };
    }
  } catch (error) {
    console.error('获取模块样式时发生错误:', error);
    // 发生错误时返回禁用样式（安全默认值）
    return {
      cardClass: "relative flex flex-1 items-center justify-between rounded-xl border border-zinc-200/60 bg-zinc-100 px-4 py-3 shadow-sm cursor-not-allowed",
      iconClass: "text-zinc-400 opacity-50",
      textClass: "text-[13px] font-semibold tracking-tight text-zinc-400",
      cursorClass: "cursor-not-allowed"
    };
  }
}

/**
 * 可访问性属性类型
 * 
 * @property aria-disabled - 指示元素是否被禁用（仅在受限时存在）
 * @property aria-label - 描述性标签，说明模块状态和访问要求
 * @property role - 元素的 ARIA 角色
 */
export type AccessibilityProps = {
  'aria-disabled'?: 'true';
  'aria-label'?: string;
  role?: string;
};

/**
 * 获取模块的可访问性属性
 * 
 * 此函数为模块卡片生成适当的 ARIA 属性，以支持屏幕阅读器和其他辅助技术：
 * 
 * 受限模块（非管理员）：
 * - aria-disabled="true" - 标记为禁用状态
 * - aria-label - 包含模块标题和"需要管理员权限"说明
 * - role="link" - 标记为链接元素
 * 
 * 可访问模块：
 * - role="link" - 标记为链接元素
 * - 不添加 aria-disabled 属性
 * 
 * @param moduleId - 模块标识符
 * @param moduleTitle - 模块标题（用于生成描述性 aria-label）
 * @param userRole - 用户角色，可能为 null 或 undefined
 * @returns 包含 ARIA 属性的对象
 * 
 * @example
 * ```typescript
 * // 非管理员访问受限模块 - 返回禁用属性
 * getAccessibilityProps('bi', '商业智能看板', 'viewer')
 * // {
 * //   'aria-disabled': 'true',
 * //   'aria-label': '商业智能看板 - 需要管理员权限',
 * //   role: 'link'
 * // }
 * 
 * // 管理员访问受限模块 - 返回正常属性
 * getAccessibilityProps('bi', '商业智能看板', 'admin')
 * // {
 * //   role: 'link'
 * // }
 * 
 * // 非受限模块 - 所有用户都返回正常属性
 * getAccessibilityProps('map', '地图', 'viewer')
 * // {
 * //   role: 'link'
 * // }
 * ```
 */
export function getAccessibilityProps(
  moduleId: string,
  moduleTitle: string,
  userRole: string | null | undefined
): AccessibilityProps {
  try {
    const canAccess = canAccessModule(moduleId, userRole);
    
    if (!canAccess) {
      // 受限模块 - 添加禁用属性和描述性标签
      return {
        'aria-disabled': 'true',
        'aria-label': `${moduleTitle} - 需要管理员权限`,
        role: 'link'
      };
    } else {
      // 可访问模块 - 只添加基础 role 属性
      return {
        role: 'link'
      };
    }
  } catch (error) {
    console.error('获取可访问性属性时发生错误:', error);
    // 发生错误时返回禁用属性（安全默认值）
    return {
      'aria-disabled': 'true',
      'aria-label': `${moduleTitle} - 需要管理员权限`,
      role: 'link'
    };
  }
}
