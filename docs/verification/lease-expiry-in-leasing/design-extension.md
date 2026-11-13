# 租赁成交内租约到期：既有设计系统扩展记录

日期：2026-11-13。核对分支：`codex/lease-expiry-in-leasing`；HEAD 与本地已取得的 `origin/main` 均为 `1095754b728b4899317d1f16f771678bb8c52259`，本记录描述其上的未提交实现。未重新拉取远端，不代表线上现状。

## 范围与设计依据

本次是现有操作系统的普通扩展：在租赁成交内查看企业、楼宇与预计到期时间。沿用 [01 系统设计语言](../../standards/01_系统设计语言.md) 和 [现有令牌](../../../src/styles/tokens.css)，不建立新视觉方向，不创建或改写全局 `DESIGN.md`、设计 sidecar 或规范。本记录采用 impeccable document 的源码提取方法，记录实际继承关系；任务局部的布局选择不升级为全局设计规则。

用户要求只读查看，不加入 AI 分析、核实、保存或跟进操作。“待核对”仅为既有估算限制的文字状态，不是新的核实流程。范围及其他验证由 [任务记录](README.md) 维护。

## 沿用的令牌与共同组件

| 实现证据 | 本次用途与继承关系 |
| --- | --- |
| `--cd-color-workspace`、`--cd-color-surface`、`--cd-color-surface-alt` | 分别用于工作区、页头／入口／按钮、时间图内容面与悬停面；保留现有浅色操作界面，没有新增色板。 |
| `--cd-color-text-primary`、`--cd-color-text-secondary` | 主标题和企业使用主文字；楼宇、日期、范围、计数及限制采用次级文字。颜色不编码机会评分或客户归属。 |
| `--cd-color-border`、`--cd-color-brand` | 细边框划分记录；品牌色用于时间条及焦点轮廓。时间条使用品牌色的局部透明度，不新增颜色令牌。 |
| [AppHeader](../../../src/components/ui/AppHeader.tsx) | 复用 54px 页头、16px／600 模块标题；通过 actions 插入返回租赁成交链接，没有修改共同页头。 |
| [Button](../../../src/components/ui/Button.tsx) | 重试与分页复用 secondary 变体，继承表面、边框、6px 圆角、14px 文字、500 字重、焦点和禁用反馈。 |
| `LoadingState` | [到期组件](../../../src/components/lease/LeaseExpiryTimeline.tsx) 复用现有加载状态，不另造加载视觉。 |
| [LeaseExpiryLink](../../../src/components/lease/LeaseExpiryLink.tsx) | 两处入口使用同一局部组件，继承表面、边框、主文字、品牌焦点和 `--cd-radius-md`；采用现有 Lucide 图标语言。 |

核对时 `git diff --name-only HEAD -- src/styles src/components/ui src/app/globals.css DESIGN.md .impeccable` 无输出。此次功能没有更改全局令牌、字体设置或共同 UI 组件；新增局部组件并不构成新的全局设计系统。

## 字号、文字分组与阅读顺序

字体继承 [全局样式](../../../src/app/globals.css) 的 Arial、PingFang SC、Microsoft YaHei 与系统回退。本页主体只用 20px 标题和 14px 正文两档；日期、楼宇、说明、计数与返回链接均保持正文档，不按每种信息各设字号。局部正文使用常规字重，企业名称与主标题使用 600；共同 Button 保留既有 500 字重。页头的 16px 属于已有模块身份角色，不另加正文层级。

企业与楼宇垂直成组；预计日期紧邻对应记录。企业名称是行内主要强调项，楼宇、日期与辅助信息不同时加粗。长名称自然换行，日期启用 `tabular-nums`。窗口范围与页面标题同组，总数与分页同组，估算限制集中于数据下方。

## 入口及宽窄屏语义

- [租赁成交页](../../../src/app/lease-submission/page.tsx) 在内容顶部放置入口；[成交数据库页](../../../src/app/lease-submission/history/page.tsx) 在既有工具栏中使用同一入口组件。名称均为“租约到期”，目标均为 `/lease-submission/expiry`，不取代原有新增、筛选或导出操作。
- [到期组件](../../../src/components/lease/LeaseExpiryTimeline.tsx) 保留模块身份与“租赁成交”返回链接。入口有可见键盘焦点和至少 44px 高命中区；这只是源码依据，不是实际设备操作结论。
- 桌面视口（整数 CSS 宽度从 1024px 起）保留企业／楼宇列和时间图。[日期工具](../../../src/lib/leaseExpiry/timeline.ts) 让月首和区间共同按 `as_of` 至 `window_end` 的真实日期比例定位，单日为点，超出窗口末端使用延续标记；完整的日期文字仍可直接读取，不依赖悬停。
- 中窄屏（CSS `max-width: 1023px`），[局部样式](../../../src/components/lease/LeaseExpiryTimeline.module.css) 隐藏月轴及条形，改为逐条列表外观，保留企业、楼宇、完整预计时间和必要提示。没有用均分月份伪装真实日期尺度；分页和返回仍可见。最终实现已撤掉 900px／760px 局部断点，按 01 的桌面边界组织图表与列表。
- 窄屏只是视觉重排：DOM 仍沿用 table／row／cell 角色，没有切换成新的可访问列表组件。不能由“列表外观”推断屏幕阅读器、键盘或真机已经验证。

## 局部几何与证据边界

最终源码使用 1440px 业务工作台容器、24px 桌面内边距和列间距、8px 面板圆角、4px 企业与楼宇间距；这些局部 CSS 字面值映射 01 的已有尺寸与间距角色，不新增令牌。图表表头至少 56px、记录至少 80px，为两行身份和日期提供空间。列表行内边距为 12px／16px；页面使用 12px 水平密集工作区内边距，标题、页脚与说明再加 4px，形成 16px 文字阅读边界。空／错状态保留 8px 圆角，返回链接为 6px；图内点、条与箭头尺寸只是数据几何，不成为普通组件的新尺寸标准。整体没有新增阴影、渐变、独立字体或装饰卡片体系。

本子任务仅写本文件并检查引用，未修改源码、规则、全局设计文档，也未运行应用测试。impeccable context 引擎因未安装且默认缓存目录不可写未运行，已改为直接读取现有源码与仓库规范；未补装或修改技能环境。

手机列表是对 [首轮视觉评审](visual-review.md) 中时间轴尺度问题的实现修正；最终视觉结论由该评审记录单独维护。本记录不授予最终视觉通过，不声称 iOS／Android 真机、辅助技术、用户缩放或 CUA 人工交互已验收，不证明精确 PR head 的 CI 通过，也不代表已提交、合并或生产发布。
