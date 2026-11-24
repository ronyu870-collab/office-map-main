# UI Craft & Motion Overhaul

基线：2026-11-25 获取的 origin/main `43511a2484338daa4ad1a6772059ed75f2b026e5`。分支 `codex/ui-craft-motion-overhaul`。不合并 main，不写生产数据，不调用付费模型。

## 上游技能

仅阅读已核验的 Markdown，不安装或运行上游脚本；项目规范优先。Next 16.2.12 的 server/client 与 CSS 文档已阅读。

| 来源 | SHA | 许可证 | 实际采用 |
|---|---|---|---|
| [jakubkrehel/make-interfaces-feel-better](https://github.com/jakubkrehel/make-interfaces-feel-better) | 6d9f2f1df10e8ce2ae1708598a73b0506fb98794 | MIT | icons / surfaces / animations / typography / performance：同组光学重量、圆角嵌套、命中区、明确过渡属性 |
| [emilkowalski/skills](https://github.com/emilkowalski/skills) | 64eb3deb9a5fbfa041faf783e0bc3fd635872e9c | MIT | emil-design-eng、remove-animations、animation-performance：频率决策、CSS接管、反馈保留静态语义 |
| [pbakaus/impeccable](https://github.com/pbakaus/impeccable) | b49177d32788f2dc585c42831d845dacf1ebed2c | Apache-2.0 | polish / craft-floor：Operate模式、对齐、去噪及边界状态；未运行需下载执行器的context |
| [jakubkrehel/skills](https://github.com/jakubkrehel/skills) | 672ae44ace6aaed65b86cbb1e2fd6fbea0e79578 | MIT | better-ui、better-typography、better-accessibility；interface-review用于差异扩散检查参考，不执行其只读工作流替代实施 |
| [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) | 5a37a6329fbad3666c3207392a6a7c0110e92efb | 根目录未发现许可证 | web-design-guidelines 1.1.0及捆绑command.md；仅参考，不复制分发其代码 |

指定的技能目录均已核验；未机械运行 animate / choreograph 等不适用命令。外部技能要求40px桌面目标、统一scale(.96)、模糊等参数与项目密度／任务边界冲突时，以本项目32/36/44px和动效克制规则为准。

## 源码审计与实施清单

扫描所有实际路由、共享UI及模块样式；初始扫描：48处全属性过渡（12文件）、216处title（89文件）、77处手写SVG（32文件）、496处原生button（96文件）。计数只用于定位，不作为缺陷判定或完成指标。图表SVG、品牌、地图数据色、导出模板属于合理例外。

| 优先级 / 位置 | Before / 原因 | After / 方案 | 频率 / 影响 / 风险 | 验证 | 状态 |
|---|---|---|---|---|---|
| P0 SearchableSelect锁定清除 | disabled仍调用onClear | 原生disabled保护 | 高频表单；越过禁用；低风险 | 旧实现单测确实失败、修复通过 | 已修复 |
| P1 Button / IconButton | 仅hover；图标和触控规格散落 | active/pressed/focus/disabled、图标16/1.75、32/36/44目标；可选稳定加载 | 全站；公共样式风险 | 控件、调用方、全量工程与渲染 | 已实施 |
| P1 Tooltip | 高频图标依赖title延迟和浏览器外观 | 原生Popover top layer；450ms首延迟、同组600ms宽限、键盘及Escape/点击关闭 | 高频；浮层焦点风险 | 自动组件与浏览器 | 已实施 |
| P1 SearchableSelect | 手写SVG、近似色、绝对定位裁切、选项转移焦点 | Lucide、语义token、原生popover限界、保持输入焦点及Tab退出 | 高频；中文输入与身份风险 | 连续输入、IME、选择、禁用、空结果 | 已实施 |
| P1 Dialog / 菜单 | 缺空间进入关系、局部22px标题 | 轻量CSS进入、减少动效、保持关闭即时和原焦点保护 | 中频；嵌套焦点风险 | Dialog/菜单/浏览器回归 | 已实施 |
| P1 AI composer / actions | 发送停止替换按钮节点、反馈规格不齐 | 固定按钮/图标盒交叉淡化、真实loading/Check | 高频；草稿/请求语义风险 | AI工作区/焦点/导出测试 | 已实施 |
| P1 map toolbar / marker | 17/18px混组、1.35–1.8倍hover、强制reflow弹跳 | 16px组、公共图标按钮、去重复样式与几何跳动 | 高频；地理层级风险 | marker/runtime/workspace回归 | 已实施 |
| P1 admin / 密集操作 | transition-all和普遍scale；3套AGGrid近似色 | 精确属性、高频不缩放、共同语义主题 | 高频；虚拟化/编辑风险 | admin编辑与搜索/全量测试 | 已实施 |
| P2 Stacking / 图表 / 保存状态 | 控件字重/描边、状态色及token漂移 | 保留数据色和导出，统一界面控件与数值对齐 | 中频；导出/权限风险 | stacking/图表/季度回归 | 已实施 |

## 动效决策

每处先判断：是否解释操作／状态、出现频率、是否阻塞后续操作、是否可中断反向、减少动效等效、布局/绘制成本与清理。

- 公共按钮只做120ms表面/颜色反馈；密集表格不缩放。
- AI发送作为独立主要操作可短按.97；图标只做120ms透明度变化，静态图形/名称始终表达状态。
- Popover/菜单用120ms小幅进入；Dialog180ms、Drawer240ms；关闭立即移除，避免为退出动画延迟焦点恢复和业务关闭。
- 保留已有AI300ms空间展开与地图WAAPI240ms中断/重开机制，不重建状态架构。
- 地图列表联动保留静态描边，不持续跳动或强制回流。

## 实际入口覆盖

逐项检查公共控件、图标、交互状态、异步禁用、浮层、标题操作组、窄屏与减少动效。下表区分源码覆盖和实际执行；源码审阅不冒称逐页浏览器验收。

| 入口 / 模块 | 本轮处理及保留边界 | 执行覆盖 |
|---|---|---|
| `/`、用户菜单、设置、登录 | 公共 Button/IconButton/Input；保留导航权限与登录流程；真实 loading，图标及 Chevron；手机输入44px/16px | 首页/会话/设置单测；新增登录浏览器保护 |
| `/search`、`/compare` | SearchBar Lucide、输入焦点与公共标题/按钮；保留比较列、来源和虚拟化 | 搜索覆盖门禁、比较/连续输入回归 |
| `/update` | 公共按钮、SaveStatus 的同组图标/数字与真实重试；不动季度草稿/提交逻辑 | 季度和关闭保护回归 |
| `/lease-submission` | SearchableSelect top layer、保持输入身份、禁用清除；行操作 Button；关闭列表清空内容避免多个空结果 | 成交输入/关闭/转交回归；新增实际表单浏览器 |
| `/lease-submission/history`、`monitoring`、`expiry` | 复用共享标题、按钮、表单/对话框、全局原生焦点；保留数据阅读/导出/团队范围 | 历史/监控/到期与业务保护回归；CI原有broker/Auth矩阵 |
| `/intelligence`、`proposal`、`lease-expiry` | 公共控件；方案排序16px图标及手机44px；到期记录稳定保存态；保留需求解析/评分/权限 | proposal、到期、身份与选择器连续输入回归 |
| `/intelligence/audit` | 原专用密度和44px控件保留；基线颜色归语义token、active反馈 | AiAuditWorkspace 状态/分页/焦点/身份回归 |
| `/map`、`/md-20260928/map` | 公共图标提示与面板操作；MapDisclosure复用180/120；地理点不缩放/跳动、不强制reflow；共享边框和表面 | 地图生命周期/工作区/阅读/焦点单测及隔离SDK浏览器；旧入口同一实现 |
| Stacking Plan | 界面表面、按钮状态和图标；保留租户色、楼层坐标、admin授权及PNG/Excel内容 | Stacking/导出/权限回归 |
| 楼书、PDF、照片/图表 | PDF适应页面改公共Button；共用Dialog/工具条；图表SVG、坐标/单位/数据色及导出保持专项 | PDF取消/翻页/下载及地图真实阅读回归；AI图表浏览器 |
| `/oss`、研究资料库 | 真实上传进度入口使用loading；既有目录/队列/失败恢复和权限保留 | OSS队列/上传/研究资料测试，CI原有浏览器 |
| `/quarterly-research`、`/occupier-insights` | 保留报告专用排版/图表/iframe；共享页面入口/焦点；不把网页工具条参数强加报告 | 报告/研究单测与CI既有报告浏览器 |
| `/admin`、`display-overrides`、数据库、公告 | 去transition-all与普遍scale；AGGrid语义主题、局部滚动条/图标/数值；不改列宽/虚拟化/数据字典/权限 | 后台编辑/弹窗/审计/字段字典及全量回归 |
| 反馈与公告入口 | 反馈关闭IconButton、触控热区、提交/回复稳定loading；保留线程、附件及草稿 | feedback-thread、feedback-v2、懒加载回归 |

## 轮次与验证

1. 完成实际路由及共享调用链审计，问题随轮次复核。
2. 完成 token、公共 Button/IconButton/Input 与调用方迁移。
3. 完成 Tooltip/Menu/Dialog/Drawer。Tooltip直接增强原按钮，保留父子选择器、ref与事件；只在可见时监听全局事件。选择器保持输入和浮层实例，关闭后无隐藏选项文字。
4. 完成 AI 发送／停止节点、复制Check、真实下载/复制loading及300ms缓动统一；保留原空间状态控制。
5. 完成地图工具条、联动静态强调、原生marker去几何hover及重复样式；保留相机/SDK生命周期。
6. 完成其余业务覆盖及必要迁移，见上表。
7. 去掉48处Tailwind transition-all及2处原生HTML全属性过渡、密集操作缩放、重复marker hover覆盖和运行时弹跳样式注入；AGGrid滚动条不再泄漏到全站；loading spinner仅busy时运行。
8. 边界回归发现并修复关闭选择器残留空结果、Tooltip包裹节点影响直接子元素样式、错误边框被hover覆盖。完成新增连续输入/IME/Tab、禁用、ref、Tooltip清理及地图回流回归。

本轮测试在当前分支执行，持续回归由现有 Vitest 全量入口和 Verify 的 `ui-craft-browser.mjs` 运行，不用历史记录替代。到期线索的既有隔离组件浏览器适配真实构建的 CSS Module 类名，避免新公共按钮在该夹具中丢失样式；保留失败重试与幂等断言。本次实际执行结果：

- `NEXT_PUBLIC_AMAP_KEY=syntheticfixture npm run verify`：audit coverage、typecheck、lint、405个测试文件／3076项测试及生产构建通过；Lint 0 errors，974条既有警告未在本任务批量治理。末轮2处原生HTML过渡清理另经MapController执行测试、Lint与生产构建通过。
- 搜索覆盖契约通过；精确基线SHA的 `scripts/search-focus-gate.mjs`：334项回归全部执行并通过。
- `ui-craft-browser.mjs`：1280/390/320px三档通过，含Top Layer、44px/16px手机输入、稳定loading、防重复请求、输入实例、选项焦点、Tab退出与减少动效。
- AI真实Next构建隔离HTTP浏览器：1280/390/320px，92组场景通过，包括键盘、来源、历史、图表、下载、失败与停止请求。
- 地图桌面1280px套件通过；390px异步照片／原件阅读单独复验通过（原几何状态和500ms稳定尾段断言保留）。完整窄屏、菜单及到期线索同样接入原有PR必要CI；结果以精确head检查为准。
- 新增进入过渡后，异步资料采样等待弹窗自身有限进入完成再开始；不等待子孙loading动画，不放宽异步到达后的几何阈值。键盘测试按可见文字识别操作，避免保留宽度的隐藏加载文字干扰。
- 曾有并行测试时既有50ms缓存计时断言测得54ms；保留门槛，串行完整verify通过。未跳过用例或提高阈值。


## 验证范围与限制

- 新增回归已验证旧错误：禁用的锁定选择器仍触发清除；地图原bounce需要强制读取offsetHeight。修复后均通过。
- 性能按 VERIFY-06 验证结构与代表业务；不增加运行时依赖、请求或付费调用，不宣称未经前后计时的量化提升。
- 浏览器使用本地生产构建、合成HTTP/SDK及桌面Chrome视口；不代表生产身份集成或实体手机验证。数据库、权限和真实Auth集成沿用PR必要CI，未改其实现。
- 未写生产、未部署、未合并main；PR状态在最终交付中单独列出。
