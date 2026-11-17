# Conversational Experience 2.0 P2 — 验证记录

基线：`b59e4f640ba630b24bfa843a3f5f8cd8a80f6f41`（main / P1 PR #206）。本文件记录提交前取得的证据；PR 另行登记精确 head 的 CI、补充看图结论与发布状态。

## 1. 版本与完成边界

| 证据 | 对应版本及状态 |
| --- | --- |
| 隔离前后设计矩阵 | UI 与测试差异 SHA-256 `a687e0383eefd9e8fce56ea128049b0af68ae8ba374e26966333bbb268781220`；两版各 76 条观测，实际脚本均退出 0 |
| 后续键盘修正 | 来源／摘要区域程序聚焦后按 DOM 位置继续 Tab；提交前 UI 与测试差异 SHA-256 `916667ab96e544007ed0df10f0437ebe71abea3385104ba8b5d64d33679813f9`；设计矩阵不冒称该版本截图 |
| 本地完整验证 | 设计版审计、类型、Lint（0 错误／854 warning）、271 文件 2,062 测试通过；页面收集受宿主限制，整体退出 1。最终键盘修正版 271 文件／2,064 项、审计／类型／Lint 通过；同宿主构建限制仍存在，见 [最终本地记录](local-final-verification.json)及[原始日志](local-final-verify.log.gz) |
| 隔离生产构建 | 设计版完整 `npm run build` 退出 0；[构建记录](isolated-build.json)，不代替最终 head CI |
| 独立视觉 | 已实际看图状态见[独立评审](visual-review.md)；精确 head 的完整代表状态仍待 CI 截图与补充看图，整个 Visual acceptance 尚未写为通过 |
| 视觉迭代后的本地验证 | UI 差异 `bf2856e7f37c54bff693c721af182dd5e475d5ce342657484f77f62bd4eb4656`；再次运行 npm run verify，审计／类型／Lint及271文件／2064项通过，完整构建仍受同一宿主限制，退出1。见[本轮记录](local-visual-iteration-verification.json)及[日志](local-visual-iteration-verify.log.gz) |
| CI阻断修正后的本地验证 | 加入审计提交时序回归后，npm run verify 的审计／类型／Lint及271文件／2065项通过，编译通过，页面收集仍因同一宿主限制退出1；见[最新本地记录](local-ci-closure-verification.json)及[原始日志](local-ci-closure-verify.log.gz)。首页视觉差异仍为bf285，审计焦点及性能准备脚本另有摘要 |
| 精确 head CI | 视觉迭代后须重新执行全部六个 Verify jobs 与 Visual acceptance evidence；当前完整 head 及最终状态由 PR 另行核实 |
| 首次 PR head 复核 | `4f67196` 的主工程 job 和 76 状态生产矩阵完成；独立看图及原 P1 性能仍有实际失败，见本页第 7 节。旧 head 的成功项不能代替迭代后精确 head |
| iOS Safari／Android Chrome | 无真实设备，未执行；模拟视口不能代替 MOB-05 |
| main／生产 | 本批未合并、未发布；不将 PR 创建或 Preview Ready 视为生产完成 |

## 2. 实际渲染与交互

实际 Next／React 页面、合成会话与拦截 HTTP，没有 HTML 摹图、生产凭据或生产写入。两版 fixture digest 一致；before 工作树保持基线且差异为空。环境：Chromium 159.0.8154.6、Playwright 1.65.1、Node 24.22.3、Next 16.2.12，2 vCPU／4 GB。

| 宽度 | 每版观测数 | 范围 |
| --- | ---: | --- |
| 1280px | 15 | 桌面完整状态及业务／团队区域 |
| 1536px | 14 | 宽桌面完整状态 |
| 768px | 14 | 平板完整状态 |
| 390px | 18 | 手机、400px 短视口、业务／团队及 editor／viewer |
| 320px | 15 | 窄手机及 400px 短视口 |

状态包含欢迎、短答、澄清、指标、全屏欢迎／复杂结果／多轮／结果末尾、历史、研究资料、失败、等待、停止、资格不可用。152 条观测均无页面横向溢出、重复输入、全屏输入越界或 pageerror。新版本每个宽度正反各 60 步长结果 Tab，共 600 步：实际到达的焦点均可见且位于工作空间内，包含屏外目标被滚入，背景保持不动。390／320 短视口各正反 20 步，共 80 步通过。连续编辑、组合事件防误发送、同一输入节点／草稿和历史搜索跨刷新保持均已检查。

这不代表真实 Auth、数据库、生产性能或物理手机结果。原真实 Auth／SQL／数值 oracle／交付回执／性能验证继续由原 CI 执行。

- [before-browser.json](browser/before-browser.json)、[after-browser.json](browser/after-browser.json)：逐项布局、交互、浏览器与来源摘要。
- [manifest.json](browser/manifest.json)：实际 152 张截图的尺寸与 SHA-256；清单存在不代表全部原文件已保存。
- [before-run.log](browser/before-run.log)、[after-run.log](browser/after-run.log)：两版最终设计矩阵运行记录。

## 3. 已保存且校验匹配的设计图

| 状态 | 真实页面截图 |
| --- | --- |
| 1280px 首页 | [after](browser/after-1280-welcome.webp) |
| 1536px 首页 | [after](browser/after-1536-welcome.webp) |
| 768px 首页 | [after](browser/after-768-welcome.webp) |
| 390px 首页前后 | [before](browser/before-390-welcome.webp) · [after](browser/after-390-welcome.webp) |
| 390px 已加载研究面板 | [after](browser/after-390-research-open.webp) |
| 320px 已加载研究面板 | [after](browser/after-320-research-open.webp) |

这 7 张 WebP 与设计矩阵 manifest 的哈希完全匹配，未注入改变页面的截图 CSS；先等待字体，再由截图 API 固定有限动画的完成态。初轮截图单独放在 [iterations](iterations/README.md)，不冒称最终 head。

**取回限制：** 通过 execution logs 导出归档被自动审批拒绝，原因涉及归档暴露与账号归属依据；该路线已停止。重新核实项目／域名／测试会话归属后，专用 `read_session_file` 小分片通道获准，取得上述精选图。临时环境到固定上限后已停止，其余原始 PNG 大包未完整取回，不提供不存在的下载链接。见 [retained-evidence.json](retained-evidence.json)。精确 head 的 CI 已接入完整 after PNG 上传，可在该实际运行后补充最终视觉证据。

## 4. 首屏关系的可量化变化

同夹具、同视口欢迎状态中的业务区及输入面纵坐标，来自浏览器 DOM 测量并四舍五入到 px。位置改善不等于性能提升。

| 宽度 | 原业务区顶部 | 新业务区顶部 | 原输入面 → 新输入面 |
| --- | ---: | ---: | --- |
| 1280px | 833px | 533px | 633px → 272px |
| 1536px | 834px | 533px | 635px → 272px |
| 768px | 839px | 533px | 640px → 272px |
| 390px | 929px | 536px | 714px → 241px |
| 320px | 929px | 603px | 714px → 241px |

1280px 完整业务导航已进入 900px 首屏；390px 和 320px 首屏可进入地图与主要业务。手机 44px 触控与完整审计提示保留，未缩小点击区来压高度。

## 5. 失败复现与修复

1. **隐藏辅助信息的焦点环。** 旧过滤器将 CSS 隐藏祖先内的 summary 当作末尾目标，Shift+Tab 不能到达可见发送按钮。[旧失败](focus-regression-before.log.gz)与[修复后通过](focus-regression-after.log.gz)保留。首次夹具遗漏 submit mock 不计作复现；最终旧实现日志明确聚焦隐藏 summary。
2. **来源／摘要程序焦点。** 实际来源与摘要区域有 `tabIndex=-1`。真实组件回归证明旧循环从这里误跳“返回主页”；修复后按 DOM 相对位置继续 Tab／Shift+Tab，关闭后还原原触发器，输入／结果实例和单次查询保持。[旧实现两项失败](panel-tab-before.log.gz)、[修复后三套 49 项通过](panel-tab-after.log.gz)。
3. **截图 readiness。** 独立评审发现初轮研究面板只有 lazy loading；已等待实际面板与来源概览并取得加载完成图。最终 CI 脚本另补团队公告／交流实际内容等待，避免把占位内容当作该状态验收。

设计版完整本地命令与输出摘要见 [local-verification.json](local-verification.json)，原始输出见 [local-verify.log.gz](local-verify.log.gz)。专项与全量重叠，不累加为唯一总数。工具栏 44px、原 36 次焦点循环、IME，以及数值／权限／导出／回执／性能断言保留。

## 6. 可复现入口与合并限制

`scripts/verification/home-query-experience-p2-browser.mjs before|after http://127.0.0.1:PORT` 只允许回环地址。`HOME_QUERY_P2_SOURCE_ROOT` 指定对应工作树，`HOME_QUERY_P2_BUILD_MODE` 明示 development／production，`HOME_QUERY_P2_EVIDENCE_DIR` 指定输出。最新脚本包含来源面板键盘回归，由最终 head CI 实际执行。

本轮没有豁免。MOB-05 要求真实 iOS Safari 与 Android Chrome 的受影响闭环；缺证据时不得合并。本文件不能替代 GitHub CI 或独立视觉结论。

已只读核实 active main ruleset：托管层必需 `Search and filter focus coverage`、`Typecheck, lint, test and build`、`Visual acceptance evidence`；没有 bypass actor，当前身份不可绕过。见[规则读回](github-ruleset.json)。项目规则仍要求精确 head 的全部六个 Verify jobs 与适用手工门槛。旧 branch-protection 端点返回集成权限 403，不据此推断保护缺失，亦未修改任何保护。

## 7. 首次 PR 生产实页的独立复核与迭代

首次 head `4f6719696d019ea00e33a3de4d8d55e9a2a99bdf` 对应 [Verify run 44080622029](https://github.com/ronyu870-collab/office-map-main/actions/runs/44080622029)。实际测试 merge `7527858284681c08fc05a598a359df25fbe97ec4` 的父提交是基线 b59 与该 head，tree 均为 `9082978ef2999753c39e4aa74f5ab29ea1056e42`；它不是已合并 main 的提交。

正式 artifact `14327462214` 已通过官方通道完整取回：76 PNG 与报告，ZIP 5,671,835 bytes，SHA-256 `aed7e4825081369e2b31c0467c7bae70de7658aa5728d05b4fc655abd6790976`。这是 Chromium 145.0.7632.6、Next production 的合成会话实页，与此前 sandbox 开发构建严格区分。自动布局和五宽度来源面板键盘链均通过；独立评审实际查看 44 张图后，仍给出待验结论。

| 实际发现 | 处理及仍待验证的部分 |
| --- | --- |
| 1280px 复杂结果只有图表说明，下面 SVG 区域空白 | [原图](iterations/ci-4f67196-1280-expanded-complex.png)保留。其他宽度及后续1280状态可见折线，尚不能确定空白的单一原因。脚本补滚动后双帧、实际 SVG／折线几何、原 PNG 的可见曲线像素检查，并另拍完整图表；不注入 CSS 或改写原图。旧空图 0 曲线像素，1536／768／390 对应图分别 1502／1286／616，可拒绝已观察到的空白负例，见[原图校准](chart-paint-calibration.json)。 |
| 320／768px 历史面板首次打开看不到记录 | [320 原图](iterations/ci-4f67196-320-history-open.png)、[768 原图](iterations/ci-4f67196-768-history-open.png)保留。限定窄屏导航并排、说明按需展开和间距压缩；新回归要求首条记录与真实滚动窗有至少44px有效交集，不主动滚到记录后冒充初始状态。 |
| 原 data-result 截图停在回复底部；管理员手机团队图未覆盖下半区 | 原图保留为实际滚动状态，另加 data-summary 和 team-details。只通过真实滚动补充取证，不修改 P1 自动跟随。 |
| 手机首次展开反馈超预算 | 原120样本保留在[性能报告](ci-4f-workspace-performance.json)。mobile first_expand 20/20 有效样本、P50 123.7ms／P90 124.3ms，超过100ms；content usable P90 456.2ms在500ms内，其余5条件通过。没有将稳定超预算当作CI噪声，亦未直接重跑放行。 |

性能优化仅先读取锚点和祖先样式，再批量写入占位／inert／overflow，仍在同一 layout effect 完成隔离；340ms 动画、原采样与预算均保持。这是基于实际路径的第一轮局部优化，旧汇总数据没有分段 trace，不能提前断言哪一行独占额外耗时。新 head 必须重新通过原性能检查。旧性能脚本 baseline 字段仍提到 P0 无全屏，只是继承描述；本轮实际基线 b59 已有 P1，不据此豁免对照。

上述发现的文件摘要、artifact 与版本见 [ci-first-head.json](ci-first-head.json)。迭代后的全部新状态按报告实际 `recordCount` 统计，仍需精确新 head CI 和独立重新看图。MOB-05 真机门槛保持未完成。

## 8. 第二次 CI 的阻断与精确修复

head `f852d5b89d58860c697c5462d8091467b5ea7926`、测试 merge `dbd4f7fb9e6c85c6b35a6474b4d17dbf6da9a3cf` 对应 [run 44085449242](https://github.com/ronyu870-collab/office-map-main/actions/runs/44085449242)。主job在单测阶段失败，**生产视觉矩阵没有执行，也没有新的图表／历史截图**；always上传步骤的成功状态不构成产物证据。

| 阻断 | 原始证据与修正 |
| --- | --- |
| 审计详情关闭焦点落到 body | 270文件／2063项通过，AiAuditWorkspace一项原有关闭焦点断言失败。新增真实组件Profiler提交边界回归，在旧实现稳定得到相同body焦点，[旧失败](audit-focus-before.log.gz)与[修复后15项通过](audit-focus-after.log.gz)均保留。仅将详情聚焦effect移到layout提交阶段，条件、依赖、关闭处理、权限清空与DOM结构不变。 |
| 原P2手机第17轮历史更早提问准备超时 | [333条原始记录](ci-f852-p2-performance.json.gz)：327成功、1失败、5依赖失败，后续计划样本缺测。失败在scrollIntoView前，没有发起更早提问请求，也没有pageerror。退出动画可仍绘制已hidden/inert的面板，原helper仅检查isVisible不足；新helper依据展开控制状态重开，并等待hidden／inert解除和真实可见。该准备发生在两个measureAction之间，计时与预算未改变。[原Node契约校准](history-preparation-calibration.log.gz)通过，最终同口径浏览器通过仍待确认。 |

独立评审已只读核对两处diff，无新增布局、权限或数据变化，原有断言保留。没有直接重跑失败job放行，也没有再做无测量依据的第二轮性能优化；此次P1的120个首次展开／收起／再开样本未开始，原4f的反馈超预算仍须由最新head复测。版本、artifact SHA与日志摘要见 [ci-second-head.json](ci-second-head.json)。
