# 主页第三版发布验收

发布基线：main `cc5b920`（含已发布地图照片优化和租约到期入口）。分支：`codex/home-polish-release`。用户确认本地第三版并明确授权合入main、上线及提交主页CHANGELOG说明。

## 范围

只移入已确认主页的5个源码/测试文件：HomeWorkspace组件和局部CSS、NoticeBanner组件及新增局部CSS、既有主页文案测试。另包含本说明、合成数据截图及CHANGELOG。源文件与已确认预览逐字节一致，见[source-manifest.json](source-manifest.json)。没有合并其他开发分支。首次CI通过后，PR #179先行合入main，仅引起CHANGELOG顶部冲突；保留双方日志并同步已发布main，主页源码保持用户确认版。

入口采用统一图标、比例与留白，去掉“常用工作”；查询与入口、业务区与团队动态通过细线和同色容器区分。公告桌面日期/正文分列，手机上下排列；标题基线统一，反馈归入底部工具行。保留顶部搜索、完整导航和早期地图焦点、按意图预取、会话、角色可见性和现有管理员业务智能入口。查询仍明确“尚未开放”，输入和发送禁用。

没有AI API、模型调用、新查询接线、数据库迁移、RLS、环境配置、依赖、权限或数据口径变更。NoticeBanner仅被主页引用，本次未改数据获取、日期逻辑、展开/收起和错误重试行为。

## 规范与验证

适用UI-01、MOB-01/05、VERIFY-01/03/05和ARCH-01—04。仅布局变更，复用现有行为回归；无数据库行为变更需新增SQL验证。搜索输入和结果状态未变，VERIFY-04无新增受影响路径。无加载顺序、媒体或等待机制变化，日常样式按VERIFY-06不触发额外计时门槛。

- 用户确认预览的本地全量：199文件、1,258项测试与生产构建通过；10组主页浏览器场景通过。
- 首轮09f3807整合版本完整 `VITEST_MAX_WORKERS=2 npm run verify` 退出0：199文件/1,264项测试、审计覆盖、类型、Lint（826警告/0错误）及生产构建通过。合成构建环境为example.supabase.co；日志 `/private/tmp/colliers-home-v3-release-verify.log`。远端精确head CI独立判断。
- 最新main最终构建浏览器回归10组全部通过、0页面错误，Chrome157.0.8103.52，结果见[after-browser.json](after-browser.json)，日志 `/private/tmp/colliers-home-v3-release-sync-browser.log`。
- 原有 `scripts/verification/home-entry-browser.mjs` 已进入Verify CI。本地临时副本仅替换截图目录，未改断言。覆盖桌面1280、手机390/320、639/640、959/960，以及管理员正常/长消息、普通用户空状态、编辑者错误重试；检查导航返回、菜单Escape焦点、公告展开/收起、交流开关、角色入口、查询禁用且无新AI请求、无横向溢出和初始页面滚动0。
- 真实iOS Safari/Android Chrome未测，沿用用户本次主页“不管真实 iOS Safari 和 Android Chrome 验收”的明确决定；模拟视口不冒称真机。未放宽任何业务或权限保护。

## 视觉结论

评审者：Codex；用户已确认第三版。原预览已实际查看1280/390/320/640与手机团队动态：大区和内部边界清楚，文字成组，两档字号，窄屏完整可读。合入main不改这些源码，最终构建已实际查看1280和390画面，与用户确认版一致；320/640边界及全部角色状态由同一浏览器回归复核。**最终视觉结论：通过。** PR记录对应当前head。截图来自同一合成夹具，不含生产数据或凭证。

before使用原线上1095754版本的对应截图；main cc5b920的全部主页/公告源码与该版本相同，地图照片改动未涉及本页面。after为最终发布构建。

|视口|修改前|最终版|
|---|---|---|
|1280|[前](before-1280.png)|[后](after-1280.png)|
|390|[前](before-390.png)|[后](after-390.png)|
|320|[前](before-320.png)|[后](after-320.png)|

[中间宽度640](after-640.png)、[手机团队动态](after-activity-390.png)、[普通用户空状态](after-empty-viewer-390.png)、[编辑者错误](after-error-editor-390.png)、[管理员长消息](after-long-admin-390.png)。

## 发布与恢复

远端Verify和Visual acceptance evidence均通过后按授权合并，再核对Vercel正式项目colliersdata、main提交和域名。必要时仅revert本PR，不覆盖既有地图照片优化或其他工作。本文不将本地通过冒称已上线；最终发布回执另存项目outputs。

## 同步main后的最终复验

首次精确head 3fefc084be5514821f9ff24f5d07b60a6ac2a61d 的Verify与Visual acceptance全部通过；因main并行更新，同步后对新head重新执行远端门槛，不沿用旧head的CI结论。

- 本地两worker复验出现模拟导航计时和后台schema焦点失败，等待较久后中断；保留 `/private/tmp/colliers-home-v3-release-sync-verify.log`，不将中断记录算通过。
- 单worker完整复验：审计覆盖、类型、Lint（828警告/0错误）通过；201文件中200通过，1,277项通过、1项失败。失败为 `AuditLogPage.focus.test.tsx:122` 清除筛选后等待“Alps 楼”超时，日志 `/private/tmp/colliers-home-v3-release-sync-serial.log`；前一轮导航与schema失败项在本轮通过。此轮全量命令退出1，不记为全绿。
- 当时进程检查确认另外三个工作区同时运行全量测试，可能存在负载影响，但不把相关性视为已证实根因。其他测试结束后，同一源码单独运行 `npm test -- src/components/admin/AuditLogPage.focus.test.tsx --reporter=verbose`，3项全部通过，含原失败序列（1,792ms）；日志 `/private/tmp/colliers-home-v3-focus-diagnostic.log`。未修改应用、测试断言、超时或跳过项。
- 最终生产构建退出0，日志 `/private/tmp/colliers-home-v3-release-sync-build.log`。远端新head必须独立全量通过后才能合并。

- cc5b920整合版最终构建的10组主页浏览器场景全部通过，0页面错误；重新查看1280和390画面，仍与已确认V3一致。源码5项指纹全部一致。
