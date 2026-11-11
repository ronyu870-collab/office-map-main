# 加载性能采集

用同一提交的生产构建、角色、数据与网络比较。工具只准备证据，不改变认证、应用缓存、数据或用户操作。共享 CI 的单次墙钟计时不作阈值，受控验收按 [VERIFY-05](../../docs/standards/05_工程验证与交付规范.md#verify-05)。构建清单也不是实际浏览器瀑布图。

## 校准与回归

CI Verify 在构建后安装隔离的 Playwright Core/Chromium，执行：

```sh
node scripts/performance/verify-summary.mjs
node scripts/performance/verify-capture.mjs
node scripts/performance/verify-anonymous.mjs http://127.0.0.1:3210
node scripts/performance/verify-home-cold-start.mjs http://127.0.0.1:3210
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

分别构建改前和改后的完整检出（保留各自源码和 `.next`），在已安装 Chrome 和 `PERF_PLAYWRIGHT_MODULE` 的机器运行：

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

场景 contract 至少提供：`source_url, trigger, shell, content, scenario, environment, commit, role_class, device, network, cache_state`。可提供 `ready_selector` 等待登录后的源页实际入口，再自动执行一次导航；否则终端回车继续。`feedback, fresh, error` 分别是反馈、新鲜回读和业务错误的 CSS selector，未定义指标保留 null。`deployment, data_origin, proxy_state, timeout_ms` 记录测试边界。

selector 必须按实际页面校准：目标内容不能在源页已经可见，必须是完整结果与核心操作可用的状态；空列表、只读、管理等状态需各自定义，不能拿 spinner 消失或标题出现代替内容。需要新鲜数据时必须单独定义 fresh，且证明它来自本次回读。该采集器不判断缓存事实，不应由快慢推断缓存命中。真实地图瓦片与完整标记需要专项采集，不拿普通 DOM 表格就绪替代。

目前采集器只支持同文档 SPA 导航，文档替换时保存失败样本，不能补填时间。真实浏览器渲染帧观察从目标真实 click 事件开始，不使用工具调用的往返时间。request_count 包括采集窗口中新发起的请求；尚未完成的请求保留 null timing/status，失败单独记录。分类不保存 query 或具体业务对象路径，不等同于完整 HAR。

汇总用 nearest-rank 分位数，按提交/部署/环境/数据来源/设备/浏览器/网络/代理/角色/场景/缓存状态隔离分组。失败保留在分母；成功样本缺指标另计，不能补零。低样本限制明确列出；没有访问频率权重时不计算全系统提升比例。读汇总时必须同时看失败率和缺测数。

构建清单枚举 client-reference manifest 中各路由的引用 chunk，分别记录原始与本机 gzip 大小。它不证明实际下载时序、CDN 压缩、执行成本或具体包大小。
