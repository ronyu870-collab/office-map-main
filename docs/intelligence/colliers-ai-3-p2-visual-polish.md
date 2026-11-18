# Colliers AI 3.0 P2 — 对话与研究结果视觉整合

基线：最新远端 `main` 的 `0f539116806e2e2c8a68afd3b769ed31a03ba8e6`，已包含 3.0 P0（PR #208）与 P1（PR #209）。开发分支：`codex/colliers-ai-3-p2-visual-polish`；目标：`main`；[本次 PR #210](https://github.com/ronyu870-collab/office-map-main/pull/210)。本记录只对应 3.0 P2，记录实现与本地证据；最终完整 head、远端工程检查、main 合并提交与生产部署的最终状态及证据统一见本次 PR，不把创建 PR 或 Preview Ready 等同于生产发布。

## 1. 授权与边界

用户要求实际完成本阶段 UI 和用户体验升级，在必要工程验证与不可省略的仓库 CI 通过后创建 PR 并直接合并 `main`，不再次请求发布确认。设计以简洁对话、舒适正文、结论优先和可追溯研究结果为方向；不引入外部产品名称、Logo、配色或无关功能。

本次明确豁免独立人工视觉评审、重复手工浏览器观感审查和实体手机人工验收，不要求额外静态设计稿或逐项确认。三项人工验收均为 `waived`／未执行，不宣称通过；自动化浏览器功能回归与视口模拟不冒充人工视觉、真机或系统输入法证据。规则依据、单次范围及撤除条件见 [06 本次决策](../standards/06_规范维护与决策记录.md#colliers-ai-30-p2-视觉整合与单次人工验收豁免2026-11-18)。

以下既有契约必须保留：

- P0 默认紧凑 AI 入口与综合业务首页，包括业务导航、团队动态和角色可见范围。
- P1 同一会话与输入节点的 `compact`／`focus`／`expanded` 切换，包括草稿、选区、中文组合输入、在途请求、滚动位置及 reduced motion。
- 正式指标计算、期间、比较尺度、有效样本和统计限制；不将推断包装成数据库事实，不给缺失值补造数据。
- 服务端授权、角色限制、来源快照、展示回执、本人历史、地图跳转、导出资格及审计契约。

本轮不修改数据库结构、RLS、生产业务数据、模型配置或正式计算逻辑；全站公共组件不作无关重写。

## 2. 已实现的界面整合与受影响路径

| 范围 | 本轮实现 | 保留的实际操作与间接依赖 |
| --- | --- | --- |
| 对话与工作空间 | 阅读宽度统一为 800px，正文采用 16px／1.8 行高；去掉助手正文 44px 缩进及多余大面积底板，用户消息使用浅色低强调气泡，输入面减少投影 | 单实例三态切换、发送与停止等待、错误恢复、按需侧栏、焦点与视口处理 |
| 顶部工具栏 | 产品名与必要动作共用对齐线，图标统一 16px；所有视口保留至少 44px 点击区，选中、Hover 与键盘焦点统一，保持轻量图标视觉 | 历史、新对话、返回／全屏，研究资料仅在已有相关结果时出现 |
| 历史侧栏 | 标题为主、日期分组为辅，搜索继续保留；每条记录的重命名与归档收纳到更多菜单，提供键盘开关／焦点与触控操作 | 本人历史搜索、分页、原快照恢复、签名继续分析、重命名失败草稿及权限变化清理 |
| 研究结果 | 按已有内容形成直接结论、核心指标、图表与分析、数据来源、统计口径与末尾操作五层；指标数字统一 24px，单位和期间弱化，使用等宽数字对齐 | 各查询类型、缺失／无效值、有效样本与警告、图表与表格、原来源和服务端快照 |
| 指标与证据 | 结论依据、指标数值与来源摘要提供轻量来源入口；数据库 ID、执行条件和版本等技术信息按需展开 | 数据表、字段、期间、版本、原件引用与关联状态；必要样本与统计限制仍可见 |
| 图表与楼宇 | 图表系列、填色和网格复用品牌及语义令牌，标题与注释层级统一；楼宇图片与主要信息桌面并排、手机堆叠 | 同源图形、缺失期与无样本、真实授权字段、地图定位与楼宇详情 |
| 成果与后续操作 | 复制、下载及低频操作移到结果末尾；在同一结果的局部容器中用 portal 重排原操作组件，不另建图表／导出实例；下载进度／成功／错误随底部工具区呈现，图表状态仍在图旁；更多及下载菜单的 Escape 只关闭当前展开项 | 复制结论、摘要、CSV／XLSX／SVG、原操作状态、导出权限复核、来源快照与审计；关闭菜单不退出工作空间 |

复用 [01 系统设计语言](../standards/01_系统设计语言.md) 与共有色彩、间距、字号、圆角令牌，新增 AI 阅读宽度、正文行高、消息间距及图表填色等语义映射，仅由 AI 组件使用；清理 11 段无调用的旧 CSS 选择器及局部重复覆盖，不重写全站组件。

受影响入口包括 `HomeQuery`／工作空间样式、`HomeQueryHistory`、`HomeQueryResult`、`HomeQueryArtifacts`、`HomeQueryResultActions`、研究资料面板与楼宇展示。查询请求、历史服务、来源快照、计算和导出协议继续复用既有链路。结果末尾的局部 portal 不改变 P1 输入／会话树，也不替换工作空间。

**原件边界**：既有 `source.original` 契约没有直接下载 URL，本轮保留原件引用和关联状态展示。来源面板可以查看获权表、字段、期间和版本，不宣称所有原始资料都支持点击下载；不拼造链接，也不扩大资料读取范围。

## 3. 必要验证与证据

沿用 [AGENTS](../../AGENTS.md) 的工程命令与 CI 门槛；按 [VERIFY-03／04](../standards/05_工程验证与交付规范.md#verify-03) 验证实际受影响操作。对单纯间距／颜色不增加复述实现的测试；新增菜单、展开／收起或焦点行为由真实组件回归覆盖，修复缺陷须保留旧实现失败、修复后通过的证据。

重点路径：输入连续编辑与模式切换、历史搜索／重命名／归档、来源开关与键盘焦点、图表及多指标选择、楼宇与地图入口、复制／文件导出权限、网络失败恢复及迟到结果处理。已有生产构建浏览器、真实 PostgreSQL／Auth／HTTP 和原性能预算继续执行，不因人工验收豁免而跳过。

| 项目 | 本轮状态／证据 |
| --- | --- |
| 基线与保护 | `0f539116806e2e2c8a68afd3b769ed31a03ba8e6`；P1 #209 已合并。实时回读[规则集 #27013547](https://github.com/ronyu870-collab/office-map-main/rules/27013547) 为 active，要求 Search and filter focus coverage、Typecheck, lint, test and build、Visual acceptance evidence，且无 bypass actor。只读核查，不改变配置；基线结果不替代 P2 检查 |
| 适用组件／功能回归 | 集成前定向回归通过：历史／工作空间 41 项、Focus 12 项、研究 5 文件／53 项、复制与楼宇 2 文件／11 项。后续焦点修正后历史／工作空间／Focus 3 文件／55 项通过；下载状态归位后 result-experience 17 项通过。各集合与全量测试重叠，不累计为总数 |
| 本地 `npm run verify` | 中间完整调用的审计、类型、Lint（0 错误、854 条警告）及 272 文件／2,084 项测试通过；Next.js 16.2.12 webpack 编译成功（30.9s），随后 `/api/oss` 页面数据收集被宿主 `uv_interface_addresses` 错误阻断。完整本地 verify **未通过**，编译成功不等于完整生产构建成功 |
| 历史焦点／下载反馈修正后的本地 `npm run check`（CI 反馈前） | 退出码 0：审计、类型、Lint（0 错误、854 条警告）和 272 文件／2,087 项测试全部通过。定向集合不重复累计；该命令不包含生产构建，不覆盖前述完整本地 verify 未通过事实 |
| 搜索与筛选连续编辑 | 现有登记覆盖 HomeQuery、工作空间和历史入口，相关实际组件回归已在上述 check 运行；远端专属覆盖检查的最终结果见 [PR #210](https://github.com/ronyu870-collab/office-map-main/pull/210) |
| 专属豁免规则回归 | `node --test scripts/verification/visual-acceptance.node-test.mjs` 23 项全部通过，新增 #210 正向与错误编号／分支／仓库／目标／完整 head／scope／reason 拒绝验证，旧条目及通用校验保持 |
| 首次精确 head 的远端回归 | `029762c011558124e3b8812db9353a3c25f5a115` 的 [Verify #975](https://github.com/ronyu870-collab/office-map-main/actions/runs/44246824825) 原生生产构建及之前的工程／数据库步骤通过；主浏览器步骤因 `focus layout: touchClose` 失败，P2 Auth 的首次历史测量因旧文本触发条件未识别图标入口而超时。两项分别按下文修复，不将该轮记为 Verify 通过 |
| CI 命中区修正后的定向回归 | 现有 Focus／workspace 两文件、42 项通过，`git diff --check` 通过；真实几何和完整最终 head 验证仍以原 CI 为准 |
| 历史入口测量适配校准 | 两个脚本 `node --check` 及 `verify-query-p2-workspace-calibration.mjs --summary-only` 均退出 0；只证明语法与原摘要／预算保护，不冒充图标入口的浏览器校准通过。完整校准保留在原 CI；本地 Chromium 在启动阶段被宿主 socket 限制阻断，未运行页面场景 |
| 第二次精确 head 的远端回归 | `395f2ad60fd38613fbceb8c404ab3818a93ec4a4` 的 [Verify #976](https://github.com/ronyu870-collab/office-map-main/actions/runs/44248830340) 主工程 job 完整通过；实际浏览器 5 视口／88 条记录的检查为 true、错误为 0，包含各视口 `touchClose`。P2 图标入口校准通过，全部 360 性能样本完整，但 `buildings_snapshot` 的反馈 P90 桌面 182.6ms／手机条件 356.2ms 超过 100ms，因此该轮 Verify **未通过** |
| 楼宇快照反馈采集修正 | 仅为 `buildings_snapshot` 识别实际历史面板内可见的「正在读取历史记录…」，增加面板外同文案拒绝、实际点击、旧结果／未知元数据／权限加载／缺卡片／缺地图链接及最终五卡片校准；不改应用、内容就绪条件、真实响应、20 次采样或预算。本地只核对脚本语法与摘要校准，完整浏览器校准和性能结果由修正后精确 head 原 CI 验证 |
| 精确 PR head 的完整 Verify | 六项必需 jobs 的最终状态、完整被测 head、构建与远端证据见 [PR #210](https://github.com/ronyu870-collab/office-map-main/pull/210)；本地通过不能替代 CI |
| Visual acceptance evidence | #210 的仓库／分支／目标／完整当前 head／scope／reason 联合校验；最终状态及精确 head 见 [PR #210](https://github.com/ronyu870-collab/office-map-main/pull/210)。成功仅表示豁免记录合规，不是人工视觉通过 |
| 独立人工视觉评审 | `waived`，本次用户明确豁免，未执行 |
| 重复手工浏览器观感审查 | `waived`，本次用户明确豁免，未执行 |
| 实体手机人工验收 | `waived`，本次用户明确豁免，未执行 |

未执行的检查保持未验证；工程失败须记录命令、版本与具体原因，不将其写成通过，不改变必需 CI、保护规则或原有性能预算。

### 本轮执行回归与本地构建限制

历史更多菜单引入的焦点恢复逻辑曾在重命名或归档请求迟到刷新后，把焦点从用户已主动转向的搜索框或其他控件抢回列表。针对实际 `HomeQueryHistory` 的两条用例先在修复前执行：

```sh
npx vitest run src/components/home/__tests__/home-query-history.test.tsx -t 'rename refresh|archive refresh'
```

两项均因真实焦点不符合预期而失败。修复仅在仍应由原历史操作接管焦点时恢复控件；用户已经主动转移焦点则保留其选择。随后 `home-query-history.test.tsx`、`home-query-workspace.test.tsx`、`home-query-focus.test.tsx` 三文件 55 项通过，包含搜索与重命名连续输入、菜单键盘和三态切换；回归进入既有 Vitest／CI，不用 Mock 固定成功替代实际交互断言。

下载状态归位增加延迟失败场景，核对下载等待与失败反馈位于末尾操作区域，图表本身的状态仍留在图旁；`home-query-result-experience.test.tsx` 17 项通过。这两项修正发生在中间完整 `verify` 之后，因此最终另行运行全量 `check`，以其 272 文件／2,087 项通过及退出码 0 为该次应用源码的本地检查证据（早于下述 CI 反馈修正）；先前 2,084 项只保留为中间验证记录。

生产编译后的阻断由独立 Node 探针核实：`os.networkInterfaces()` 与 `require('ali-oss')` 都直接返回 `ERR_SYSTEM_ERROR`，`syscall: uv_interface_addresses`、`errno: 1`；本轮 Git diff 确认 OSS 路由、`package.json` 和锁文件均未改。记录为本执行宿主的运行限制，不修改 OSS 业务或环境逻辑来绕开；最终完整生产构建必须由精确 PR head 的强制远端 CI 成功补齐。即使本地检查通过，六项既有 Verify jobs 仍全部要求绿色，不能只满足三个受保护的检查名称。

### 首次 CI 的实际浏览器失败与修正

首次发布 head `029762c011558124e3b8812db9353a3c25f5a115` 的 [Verify #975](https://github.com/ronyu870-collab/office-map-main/actions/runs/44246824825) 在原生 runner 完成生产构建，未出现本地 OSS 宿主错误；但主工程 job `134607831455` 的实际浏览器步骤在 1280px 的首次 Focus 切换时失败，错误为 `focus layout: touchClose`。`query-focus-browser-checks.mjs` 保留 P1 对关闭按钮至少 44px 点击区的验证，本轮初版桌面工具栏降为 36px，实际矩形不满足要求。

按真实失败恢复顶部工具栏在全部视口至少 44px 的点击区，同时保留 16px 图标和克制视觉；不删除或降低 `touchClose` 断言，也不修改性能预算。首次失败、后续修正 head 及完整 CI 结果在本次 PR 追溯，修正代码不等于已验证通过。新 head 必须重新满足六项 Verify 和准确 head 的 Visual acceptance evidence；失败轮的局部成功不作为替代。

该轮保留 [P2 浏览器 artifact](https://github.com/ronyu870-collab/office-map-main/actions/runs/44246824825/artifacts/14402671723) 及[首页入口证据](https://github.com/ronyu870-collab/office-map-main/actions/runs/44246824825/artifacts/14402826119)。P2 artifact 仅到首次 Focus 失败前，不能据此声称本轮五视口全部通过。

同一轮 P2 Auth job `134607831921` 在 `verify-query-p2-workspace.mjs` 的首次 `history_list` 操作测量中发生 35 秒等待超时。真实历史请求已返回，但历史工具栏已改为只有 `aria-label="历史记录"` 的图标按钮，旧 probe 仍以 `textContent` 匹配触发名称，采集器的 `start` 始终为 `null`，既未计时也未进入自身超时状态。该失败不是业务查询性能已测超预算，不能据此生成虚假的耗时样本。

仅将该场景参数从 `triggerText` 改为既有采集器已支持的 `triggerAria`，不修改采集器、计时起点、真实键盘／触控操作、就绪条件、20 次采样、请求／回执核对或任何预算。首个校准场景同步为 16px SVG、无文本、带准确 aria-label 的按钮，并添加真实点击后 `start` 已设置的断言，避免文字替身再次掩盖入口差异。旧版实际 CI 超时证据见上述 job；本地 Chromium 因 `process_singleton_posix.cc:297 socket() failed: Operation not permitted` 在启动时失败，0 页面／0 视口，不虚构本地图标校准红绿结果；修正后的完整浏览器校准及 P2 链路继续由新 head 原 CI 执行。

该 P2 Auth 失败轮保留 [artifact 14402343738](https://github.com/ronyu870-collab/office-map-main/actions/runs/44246824825/artifacts/14402343738)，仅包含此前 HTTP／授权回归结果，未产出完整 P2 性能与后续空间切换结果；不能将其报告为性能通过。

### 第二次 CI 的反馈采集失败与校准

修正 head `395f2ad60fd38613fbceb8c404ab3818a93ec4a4` 的 [Verify #976](https://github.com/ronyu870-collab/office-map-main/actions/runs/44248830340) 中，主工程 job `134614420841` 完整通过，包括原生生产构建与实际浏览器。其 [P2 浏览器 artifact 14403911473](https://github.com/ronyu870-collab/office-map-main/actions/runs/44248830340/artifacts/14403911473) 的 `after-browser.json` 记录 320／390／768／1280／1536px 五个视口，共 88 条结果，全部几何检查为 true、错误为 0；各视口 Focus 转换与 `touchClose` 通过，历史、研究、复杂图表、多轮、等待、停止、错误和权限不可用等后续场景均完成。这是自动功能／几何证据，不代表已执行豁免的人工视觉或真机验收。

P2 Auth job `134614420901` 的图标入口与原采集器浏览器校准实际通过；随后桌面及手机条件各 20 轮、九场景共 360 个样本完成，`complete: true`、`functionalPassed: true`，但 `budgetsMet: false`，以 `P2_WORKSPACE_BUDGET_FAILURE` 退出。保留完整 [P2 性能 artifact 14403481617](https://github.com/ronyu870-collab/office-map-main/actions/runs/44248830340/artifacts/14403481617)，不删除失败样本、不用后续结果覆盖本轮失败。唯一超预算场景是 `buildings_snapshot` 的首次反馈，两个条件各 20 样本均完整、操作失败与缺测均为 0：

| 条件 | 反馈 P50／P90 | 反馈 P90 预算 | 内容可用 P50／P90 | 内容 P90 预算 |
| --- | --- | --- | --- | --- |
| 桌面 1280×900，CPU×1，60ms／30Mbps | 163.2／182.6ms | ≤100ms | 573.5／579.5ms | ≤2500ms |
| 手机模拟 390×844，CPU×4，150ms／10Mbps | 339.4／356.2ms | ≤100ms | 769.6／783.0ms | ≤3500ms |

原始资源记录分段（各列均为 P50／P90；响应结束相对实际点击计时）：

| 分段 | 桌面 | 手机模拟 |
| --- | --- | --- |
| 历史响应结束 | 121.5／126.7ms | 177.8／180.1ms |
| 历史请求至首字节／传输 | 111.5／117.8ms；3.8／4.1ms | 115.1／147.8ms；45.2／54.1ms |
| 楼宇响应结束 | 554.4／562.6ms | 723.3／728.9ms |
| 楼宇请求至首字节／传输 | 107.3／118.1ms；2.7／2.8ms | 109.5／123.0ms；45.8／50.0ms |
| 最终响应后的浏览器验证与渲染 | 18.0／21.9ms | 48.3／53.7ms |

请求至首字节是浏览器资源计时，包含网络及服务端等待，不能冒称纯服务端计算耗时。桌面长任务数量为 0；手机条件长任务数量 P50／P90 为 1／1，最大长任务时长为 105／112ms。该轮数据只用于定位，不能因为内容可用达标就把超预算的反馈判为通过。

源码及分段核对发现：`buildings_snapshot` 从历史条目打开，UI 会先显示实际历史面板的「正在读取历史记录…」；采集器的楼宇分支仍只匹配旧「正在读取本人」及楼宇模块提示，漏记这条已有可见反馈，直到历史响应后才识别楼宇加载。记录的反馈比历史响应结束晚桌面 41.0／44.9ms、手机条件 162.2／178.8ms，符合漏采阶段；不据此猜测真实反馈具体耗时。

修正严格限于 `mode === 'buildings_snapshot'`，只接纳对应 `aside[aria-label="历史工作记录"]` 内可见且文本准确匹配的状态；面板外同文案不算反馈，楼宇翻页不因此接受历史状态。保留实际点击计时起点、真实响应核对、五个正确卡片、当前目录元数据、地图链接、新结果身份、无权限加载状态等既有内容就绪条件，以及全部请求、回执、授权、样本与预算。

新增校准按实际点击后逐阶段绘制 DOM：同文案在历史面板外不得设置反馈；面板内真实忙碌状态可设置反馈但不能设置内容可用；旧结果、未知目录元数据、权限仍在核对、少于五卡片或缺少地图链接均不能结束测量，最后只有新结果中五张正确卡片全部可用才完成。阶段之间等待真实动画帧，不重设计时起点，也不把校准延时作为产品性能证据。本地 Chromium 的宿主阻断已独立确认，因此未再次尝试启动或绕过；本地语法／摘要检查与完整浏览器校准分别记录，最终结果以修正后精确 head 原 CI 为准。

## 4. PR 记录与发布

本次沿用现有 `visual-acceptance.mjs` 专属授权登记机制：仓库必须为 `ronyu870-collab/office-map-main`，PR 必须为 **#210**，源分支必须为 `codex/colliers-ai-3-p2-visual-polish`，目标为 `main`。PR body 使用 `result: waived`，完整当前 head 必须与平台一致，scope 与 reason 必须与本 PR 专属条目完全相同；不复用旧 head，不放宽通用校验。

本次 PR 的精确范围和授权理由：

```text
scope: Colliers AI 3.0 P2 conversation and research visual polish, PR #210
reason: User explicitly waived independent visual review, repeated manual browser visual review and physical-phone manual acceptance for Colliers AI 3.0 P2 on 2026-11-18; applies only to PR #210
```

| 发布阶段 | 最终状态与证据入口 |
| --- | --- |
| PR 与完整当前 head | [PR #210](https://github.com/ronyu870-collab/office-map-main/pull/210) 的最终工程验证与 visual-acceptance 记录；每次更新后核对完整 SHA |
| 合并 main | 本次 PR 的最终合并状态及 main commit；必须先满足精确 head 的全部必需检查 |
| Vercel production | 本次 PR 的生产 deployment ID、target、commit 与 READY／失败状态；Preview Ready 或 main 合并不能代替该证据 |
| 正式域名 | 本次 PR 的 `https://www.colliersdata.com` alias 与生产部署 commit 对应记录 |

## 5. 回退与剩余边界

回退本次前端组件、AI 局部样式与对应规范记录即可恢复 P1 的已发布布局；不删除历史、来源快照、导出、审计或业务数据。P0 紧凑首页和 P1 单实例切换属于本次保留基线，不作为回退目标移除。

人工视觉和真实手机验收均未执行，因此不声称所有设备的人工观感已经获验收。原件直接下载仍受既有来源契约限制；本轮未新增无 URL 原件的下载能力。远端自动工程结果、剩余问题及生产发布的最终状态见 [PR #210](https://github.com/ronyu870-collab/office-map-main/pull/210)；本次豁免随本 PR 合并或关闭终止，不适用于后续 PR。
