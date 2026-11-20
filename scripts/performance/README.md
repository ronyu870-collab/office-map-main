# 加载性能采集

高样本测量通过 [Performance benchmarks](../../.github/workflows/performance.yml) 手动运行，不再是普通 PR 的合并条件；日常 Verify 保留一次完整真实 Auth／HTTP 和现有浏览器功能回归。下文样本数及预算描述专项工具的诊断契约，不恢复全局门槛。

用同一提交的生产构建、角色、数据与网络比较。工具只准备证据，不改变认证、应用缓存、数据或用户操作。共享 CI 的单次墙钟计时不作阈值，受控验收按 [VERIFY-06](../../docs/standards/05_工程验证与交付规范.md#verify-06)。构建清单也不是实际浏览器瀑布图。

## 校准与回归

CI Verify 在构建后安装隔离的 Playwright Core/Chromium，执行：

```sh
node scripts/performance/verify-summary.mjs
node scripts/performance/verify-capture.mjs
node scripts/performance/verify-api-server-timing.mjs
node scripts/performance/verify-anonymous.mjs http://127.0.0.1:3210
node scripts/performance/verify-home-cold-start.mjs http://127.0.0.1:3210
node scripts/performance/verify-compare-read.mjs http://127.0.0.1:3210
node scripts/performance/verify-oss-directory.mjs http://127.0.0.1:3210
node scripts/performance/verify-map-startup-stages.mjs http://127.0.0.1:3210
node scripts/performance/verify-audit-search.mjs http://127.0.0.1:3210
```

本机复用已安装 Chrome，外部准备的 `playwright-core@1.58.2` 通过 `PERF_PLAYWRIGHT_MODULE` 指向模块目录。不要从业务检出下载或复用生产会话。CI 使用 `PERF_BROWSER_CHANNEL=chromium`，本机默认 Chrome。匿名回归只接受 localhost，只验证新上下文首页/地图/资料库的登录重定向和地图/目录资源边界，不代替真实账号、过期令牌、模拟身份与手机验收。

校准在真实浏览器合成夹具中区分外框、业务内容、新鲜数据、错误与超时。合成夹具的时间不进入产品性能报告。

## 首页冷启动 A/B

两个候选都用无凭据配置运行本地生产构建。回归脚本使用真实浏览器、新浏览器上下文和隔离的 Supabase 响应，覆盖匿名直达登录、可信设备新标签页、过期刷新、拒绝刷新、强制改密，以及角色未完成时实际点击地图且无保护数据请求。功能断言进入 CI；计时不作 CI 阈值。

```sh
node scripts/performance/verify-home-cold-start.mjs --benchmark http://127.0.0.1:3211 http://127.0.0.1:3210 /tmp/home-cold-pairs.json 20
```

默认基线/候选交替顺序，每次用新的浏览器上下文。分别记录地图链接可用、完整工作台和登录表单时间，另有真实点击进入地图路由的样本。角色接口/令牌刷新延迟为固定实验输入；报告桌面与手机条件模拟，不把这些时间当作办公网络、真机、生产认证或地图瓦片结果。

## 地图看图 A/B

分别构建改前和改后的完整检出（保留各自源码和 `.next`）。为此基准准备独立检出，构建时从环境和 Next.js 加载的 `.env*` 中移除 `NEXT_PUBLIC_SUPABASE_URL`；有值时 Next.js 会在构建时内联，运行时无法切到本机夹具。然后用 Chrome 和 `PERF_PLAYWRIGHT_MODULE` 运行：

```sh
node scripts/performance/benchmark-building-photos.mjs /path/to/baseline /path/to/candidate /tmp/photo-pairs.json
```

默认每种网络条件 20 对，顺序交替；阈值和网络条件来自 [budgets.json](budgets.json)，候选未达标或样本失败时返回非零。测量点击、反馈、解码并渲染到帧、照片请求字节与同页再次打开。实际 Next.js 生产构建处理签名 API，画廊用同版本源码运行，Storage／认证／数据是合成夹具；对尺寸缩放使用本机 Sharp，不把结果当作真实 Supabase 或真机速度。功能和失败回退走 Verify 的 `verify-building-photos.mjs`。

## 单次导航采样

```sh
node scripts/performance/capture-navigation.mjs /path/to/contract.json /path/to/sample.json
node scripts/performance/summarize.mjs /path/to/summary.json /path/to/sample.json
node scripts/performance/bundle-inventory.mjs /path/to/bundle.json
```

采集器打开一个新 Chrome 上下文，请用户自行登录；不输入、导出或保存密码、Cookie、Token、请求头、业务正文、HAR 或截图。导航一次后关闭上下文。生产仅单次低频初筛；最终高样本测试使用已确认隔离的环境。多次新上下文不能冒充 W1 返回。

场景 contract 至少提供：`source_url, shell, content, scenario, environment, commit, role_class, device, network, cache_state`。默认 `action: "click"`，还须提供 `trigger`；也可用 `action: "open"` 或 `"reload"`，`destination_url` 默认等于源 URL，且须同源。刷新前要在目标页面完成准备。可提供 `ready_selector` 等待登录后的源页实际入口，再自动执行一次导航；否则终端回车继续。无登录的直开或隔离夹具可显式设置 `prepare: "none"`，跳过准备，只执行一次 `open`。

`feedback, fresh, error, map_tiles, map_markers` 分别是反馈、新鲜回读、业务错误、地图底图和可点标记的 CSS selector，未定义的计时保留 null。只有观察到指定的真实瓦片和标记条件才能填地图指标；不要用 Canvas 存在作为瓦片就绪。`require_content_transition: true` 可拒绝目标内容点击前已存在的场景。固定时钟、角色、构建与缓存状态后再比较结果。

目标为 `/map` 时可设 `map_stages: true`：另记录授权后开始初始化、Controller 构造、SDK 等待前后、SDK 首次 `complete` 事件、渲染容器检查、存量读数和整理、首次非空存量标记绘制调用起止。阶段以本次点击或文档起点计时，未观察到则保留 null。SDK 完成事件、检查结束和绘制方法返回各自是诊断信号；实际高德瓦片可见和标记可点需要独立验收。现有 CI 地图夹具以合成 SDK 及数据响应分别校准两条并行路径，构建用 `NEXT_PUBLIC_AMAP_KEY=syntheticfixture`，本机运行该夹具时也须用同一个合成键构建。

隔离样本可设 `server_timing: true`，按请求保存同源 API 的白名单耗时。本机回环 `next start` 的服务器可设 `PERF_ISOLATED_SERVER_TIMING=local`；明确隔离的 Vercel Preview 可用 `PERF_ISOLATED_SERVER_TIMING=preview`，且部署必须报告 `VERCEL_ENV=preview`。默认关闭，Vercel Production 不返回这些计时，401/403 等未成功请求也不返回。采集器只保存允许的阶段名称及毫秒数，不保存原始响应头、描述、查询值、签名或业务数据。

这组阶段覆盖 `/api/map/data` 的存量、未来、对比和趋势，`/api/oss` 的目录和访问，`/api/lease-transactions/read`、`/api/admin/users` 及 `/api/intelligence/recommend`。`handler` 从进入业务函数起计，`json` 含生成响应；鉴权、数据库/对象存储、外部模型等阶段可能并行，不能相加。`database` 包含应用到 PostgREST 的 I/O 及部分本地组装，不能当成 PostgreSQL 执行时间；`handler` 不含函数启动和发往浏览器的时间。缺 header 只记缺测。

selector 必须按实际页面校准：目标内容不能在源页已经可见，必须是完整结果与核心操作可用的状态；空列表、只读、管理等状态需各自定义，不能拿 spinner 消失或标题出现代替内容。需要新鲜数据时必须单独定义 fresh，且证明它来自本次回读。该采集器不判断缓存事实，不应由快慢推断缓存命中。真实地图瓦片与完整标记需要专项采集，不拿普通 DOM 表格就绪代替。

点击模式从真实 DOM 事件开始，意外替换文档作失败；直开和刷新以指定文档的 Navigation Timing 起点计时，发生多个主文档也作失败，不能拿最终跳转页的局部时钟冒充全程。用 `resource_cache: "disabled"` 可以关闭 Chrome HTTP 缓存，但不等于冷 DNS/TLS/CDN、应用存储或真 C0。浏览器长任务只记录数量与累计阻塞区间；不支持则记 null。request_count 包括采集窗口中新发起的请求；尚未完成的请求保留 null timing/status，失败单独记录。只保存白名单分类及可得的编码响应正文大小，不保存 query、请求头、业务对象路径或正文；它不等同于完整 HAR。

汇总用 nearest-rank 分位数，按提交/部署/环境/数据来源/设备/浏览器/网络/代理/角色/场景/缓存状态隔离分组。失败保留在分母；成功样本缺指标另计，不能补零。低样本限制明确列出；没有访问频率权重时不计算全系统提升比例。读汇总时必须同时看失败率和缺测数。

构建清单枚举 client-reference manifest 中各路由的引用 chunk，分别记录原始与本机 gzip 大小。它不证明实际下载时序、CDN 压缩、执行成本或具体包大小。

## Colliers AI P1 对话 A/B

`verify-ai-query-conversation.mjs` 由真实 Auth 集成 harness 调用，复用本机一次性 GoTrue、PostgREST、PostgreSQL 和 Next 生产构建。先执行 `verify-query-conversation-collector.mjs` 校准采集器；校准夹具的延迟不计入产品报告。无浏览器时可用该校准器的 `--summary-only` 检查分位数、失败保留与缺测规则，但这不能替代浏览器或真实性能验证。

函数 `verifyQueryConversationPerformance({ db, person, app, beforeApp, output, exportCaps, semanticCalls, dataApiOrigin })` 创建独立合成管理员和 24 栋获权楼宇（CBD、金融街各 12 栋，4 季共 96 条季度记录，末季 2 条缺租金），结束时只清理这些楼宇和季度记录。账号清理由调用方原有 harness 负责。只有固定的 localhost 数据库端口 55992 和 loopback 应用可以使用；通过真实登录表单输入该临时账号，不拦截、伪造鉴权或业务响应。`beforeApp` 是已发布 P1 提交 `69f51a65639ec60a06058f6ce9fab6d9fdfe3830`（PR #201）的完整生产构建，由 [基线构建器](../verification/query-performance-baseline.mjs) 取得未改写的 git archive，并核对锁文件一致。省略基线时报告明确缺少基线，不能声称 A/B 完成。

每个桌面 1280 × 900、手机模拟 390 × 844 条件分别采集 20 对，前后版本交替执行。每次新浏览器上下文完成真实登录后，执行 CBD 查询、金融街追问、两地区比较和四季趋势，点击真实“新对话”按钮后在同一页面再执行一遍，分别报告首次对话与同页第二遍。两版均使用相同的省略条件追问，并逐样本核对返回的精确数值、维度和样本字段一致。保留 2 版本 × 2 设备条件 × 2 对话轮次 × 4 步 × 20 次，共 640 个样本。这里的冷条件只表示新浏览器上下文的第一次对话：登录和首页已就绪，后续轮次必须有已执行的父请求，服务端、数据库及 DNS/TLS 冷启动不在该定义中。

计时从真实发送按钮点击开始，保留首次反馈、数值结果绘制、包含必需图表的结果可操作时间、同页来源展开及重开。结果就绪后实际点击数值、确认数据库来源面板，以验证控件可以工作。请求首字节、响应传输、正文大小以及响应结束到浏览器完成校验与渲染的时间分别记录，不把后者误称为单独的 JSON 解码耗时。报告不保存凭据、请求头、完整业务正文、截图或录屏。

单指标 A/B 输出 `output/performance.json`（`query-conversation-performance/2`），每一对采样后写 checkpoint；超时、登录失败、依赖失败及未完成样本均保留。网络采集器将查询、审计、通知和反馈等请求归入有限的端点类别，`dataApiOrigin` 仅用于识别指定隔离 Data API。归因报告不保存任意 URL、业务路径、query、请求头或正文；HTTP 失败均进入样本失败判定，不能把后台 404/500 隐藏为正常结果。首页依赖的旧夹具失败、原始迁移补齐和实际 RLS 回归由 [真实 HTTP 验证](../verification/ai-query-home-dependencies.mjs) 单独执行。

随后调用 [多指标采集器](verify-query-multi-metric.mjs)，复用同一获权合成数据，保留 2 设备条件 × 2 场景 × 20 次，共 80 个真实浏览器样本；这些样本不替代或混入原 640 个 A/B 样本。当前已发布基线具备多指标能力，这 80 个样本是候选版本的持续预算回归，不宣称多指标 A/B。每次新上下文真实登录后，依次查询 CBD、金融街同季度租金与空置率，以及两地区四季度各期样本趋势。结果使用独立 SQL 核对两项指标的精确分数、有效数及面积分母，末季每地区租金有效 11 栋、空置率有效 12 栋。每个样本通过原生“图表指标”选择器切换到空置率，核对实际 HTTP 图表与原结果的 `vacancy_value` 及来源关联，再实际展开、关闭、重开和关闭来源。切换耗时从浏览器原生 change 事件计到正确图表可见且选择器可操作后的渲染帧；只收到响应不能视为完成。

多指标结果单独写入 `output/multi-metric-performance.json`（`query-multi-metric-performance/1`），记录每条件期望／实际／失败数量、独立数值核对、指标切换、来源和 DOM 回执确认。两个报告均记录精确版本、运行环境及模型调用计数；这些限定查询必须为零模型调用。P50/P90 使用 nearest-rank，失败保留在分母，缺测或失败不能得到 `budgetsMet=true`。

两组预算均沿用 VERIFY-06：反馈 P90 不超过 100 ms，结果可操作 P90 桌面不超过 2.5 秒、手机模拟不超过 3.5 秒，同页来源重开 P90 不超过 500 ms。指标切换沿用相同设备的 2.5/3.5 秒预算。共享 CI 自动断言采集完整性、真实操作、来源、数值一致性、无 HTTP 失败及零模型调用；上述原有两份脚本保留报告预算的方式，不因单次共享 runner 的墙钟超预算自动退出失败。运行该性能专项时核对两份 artifact 的预算、完整样本和失败；不要求普通 PR 生成或复核这些报告。这些记录不代表生产网络、真实手机或生产业务数据的性能验收。

## 双维三指标季度趋势

[交叉趋势采集器](verify-query-cross-trend.mjs) 单独保留 2 设备条件 × 2 样本口径 × 20 次，共 80 个真实样本。24 栋合成楼宇分布在 CBD、金融街及 A、B 两等级，4 季共 96 条记录；末季 2 条租金缺失、另外 2 条空置面积超过总面积。各指标的有效样本不同，不能以主指标的分母代替其它指标。每个新浏览器上下文真实登录后，先执行三指标、双维、四季度的各期样本趋势，再追问“共同有效样本呢”，核对两维、三指标和完整期间继承。

[独立 SQL oracle](../verification/ai-query-cross-trend-oracle.mjs) 对实际 PostgreSQL 合成记录建立完整楼宇 × 期间网格，分别求租金、空置率、季度总面积的全期间共同样本。它不导入产品公式、分组或结果生成代码；逐格核对规范季度 `YYYY-QN`、精确分数、有效数、可用数、分母、排除与来源绑定。季度总面积是面积求和，其统计分母是有效楼宇数，不能误测成面积平均值。缺季度、空组合及未知分类保留未知；能力与容量拒绝、撤权、草稿、旧来源协议、单次真实快照 RPC、幂等重试及 CSV/XLSX/SVG 由同一 [真实 HTTP 矩阵](../verification/ai-query-cross-trend-scenarios.mjs) 验证。

每个浏览器样本实际执行租金 → 空置率 → 季度总面积两次图表切换。图表按子市场 × 等级分面，切换后的每个点必须绑定原表对应指标与来源，空值不能变成零。面积选择器名称为“季度总面积”，图表说明使用原列名“总面积（㎡）”。两次切换分别从原生 change 事件计时，直到正确图表可见、选择器可操作且完成渲染帧，预算与结果可操作时间一致。随后真实展开、关闭、重开、关闭来源；每个样本确认初始结果、初始图表、两次指标图表和四次来源操作共 8 个实际 DOM 回执，80 个样本应有 640 个成功回执。

输出 `cross-trend-performance.json`（`query-cross-trend-performance/1`）保留原始样本、每条件 P50/P90、失败/缺测、两次切换、来源、模型调用及预算结果。反馈 P90 ≤ 100 ms；结果可操作及两次指标切换 P90 各自满足桌面 ≤ 2.5 秒、手机模拟 ≤ 3.5 秒；来源重开 P90 ≤ 500 ms。新采集器在完整报告落盘后同时断言功能完整、`budgetsMet=true` 与零模型调用，超预算会让该 CI job 失败；失败报告保留，不降阈值、不删样本。

查询、恢复和图表成功 JSON 在客户端接受时对 ≥16 KiB 正文协商 gzip，原 JSON、来源、归档和交付摘要仍按解压后的完整字节校验，最后实时权限检查在压缩完成后执行。浏览器资源时序分别保留 encoded／decoded 字节，不能把传输压缩当作来源删减，或把解压前到达作为可操作终点。当前全量 HTTP 持续回归验证 gzip／identity 恢复相等及原 SHA-256 交付关系；性能配置、采样数和阈值不变。

按需 Performance benchmarks 的 `Real Auth trusted query HTTP integration` 使用 `AI_QUERY_PERFORMANCE_SUITE=regression`，完整保留原 640＋80；新增 `Real Auth cross-trend HTTP and browser integration` 使用 `cross_trend`，在另一 GitHub runner 的独立 Auth/Data API/PostgreSQL/Next 栈执行新增 80。两个 job 都执行全部新旧 HTTP 场景，均保留 40 分钟时限，不在同一机器争用浏览器资源。suite 只接受这两个值，默认 regression，未知值立即失败；日志及全部报告记录 suite、精确 head SHA 和实际测试的 merge SHA。两份 artifact 分别为 `ai-query-real-auth`、`ai-query-cross-trend-auth`，均不含凭据，保留 7 天。手动运行这两个套件时，三个性能报告保留完整性、来源、零失败、零模型及预算断言，总样本仍为 800；普通合并不要求执行这些专项。
