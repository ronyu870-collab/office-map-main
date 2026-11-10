# 加载性能采集

用同一提交的生产构建、角色、数据与网络比较。工具只准备证据，不改变认证、应用缓存、数据或用户操作；计时不是 CI 的硬阈值。构建清单也不是实际浏览器瀑布图。

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
