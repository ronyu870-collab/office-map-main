# Colliers AI 交互可靠性执行记录

日期：2026-11-24。基准为执行时重新获取的 `origin/main`：`249e97cccffb47a9ab79fd613be0171646ca721c`。
开始及提交前检查 PR #284：仍为 OPEN，head `3f84b067033682bfbe0cf4ef801f651ded51e2dd`；本分支没有合入或覆盖该 PR 的正文、证据入口和地图设计改动。浏览器脚本在 main 版本上增量扩展。

## 确认缺陷与根因

| 问题 | 可执行证据 | 修复 |
| --- | --- | --- |
| 回答菜单坍缩成白条，选项实际不可点 | 原始 main 的实际 Next/React 页面，Chromium 1280×900、focus：触发器高 40px，菜单高 **10px**；计算 top=40px、bottom=44px，首尾选项 hit=false。相同几何断言直接失败 | 删除 ResultActions 对 `details > div` 的另一套反向定位和废弃容器查询；HomeQueryMenu 独占位置与尺寸 |
| 裁剪风险及历史菜单依赖 112px 估算（代码风险） | 原 DOM 路径包含 overflow:auto/hidden，旧规则无法逃出裁剪；新断言逐项检查实际边界、首尾命中和滚动可达性 | 使用原生 Popover top layer，DOM 仍在活动工作区内；按触发器、真实菜单、工作区及 visualViewport 测量翻转和限宽 |
| 详情编辑器遇到旧式中文输入法 Escape 会关闭 | premium 新用例在旧 DetailPanel 上失败；修复后通过 | DetailPanel 原生监听尊重 defaultPrevented、isComposing 和 keyCode=229；菜单原生监听先拦截 Escape，保留上级详情／工作区 |

新机制联调还发现并修正两处实现问题：打开前排队的 scroll 事件不能关闭刚打开的菜单（比较打开时祖先真实滚动位置；用例先失败后通过）；历史命令菜单由 ArrowUp 打开时应聚焦最后一个可用命令（独立失败回归后修正）。这些属于本轮实现中发现的问题，不计作旧系统缺陷。

旧失败与新通过的实际几何摘要见 [JSON](colliers-ai-interaction-reliability.json)。完整失败日志会输出触发器、菜单、可视边界、top/bottom/height、overflow、裁剪祖先、活动浮层和 elementFromPoint 命中；CI 保留完整 menu-geometry.json。

## 公共机制与保护边界

- 回答更多操作、结果下载、可选图表下载、专业图表下载、表格筛选／字段／导出及历史操作共用 HomeQueryMenu。原生顶层浮层无需 document.body Portal，继续属于工作区 inert、焦点约束和样式继承范围。
- 只有打开的菜单注册全局关闭监听及 ResizeObserver／MutationObserver；没有每行测量、轮询或新依赖。尺寸更新合并到动画帧；祖先实际滚动关闭，菜单内部独立滚动，模式变化／隐藏／卸载清理。
- 普通命令关闭并保留业务反馈；混合筛选采用 group 与原生表单语义，连续 checkbox/select 编辑不关闭；历史保留 menu/menuitem 与方向键。单活动菜单、Escape、外部点击、Tab 离开和触发器恢复统一处理。
- 手动复制、摘要返回改为聚焦可见触发器，避免聚焦已关闭面板内的按钮。表格及回答组件删除重复外部点击／Escape 处理。
- 查询、快照、来源、权限、统计、历史变更、受信复制／下载、审计及 Object URL 生命周期沿用原路径；没有数据库、服务端协议或模型调用改动。

## 连带审计结论

| 路径 | 本轮结论与依据 |
| --- | --- |
| Compact／Focus／Expanded、输入与动画 | 已有实际浏览器工作区回归及 focus/workspace 测试覆盖同一输入节点、草稿／选区／IME、动画取消、visualViewport、背景锁及 Tab；未复现额外缺陷，不重建组件树 |
| 长对话、异步排版和阅读位置 | 原 P2 浏览器长结果与键盘可视回归通过；use-query-scroll、workspace 已覆盖阅读旧内容时不追尾、历史／模式恢复及图表迟到；保留现有实现 |
| 研究／历史／来源／表格／图表详情 | premium、research、history 与 P2 浏览器覆盖来源身份、返回焦点、抽屉与状态保留；本轮增加详情内菜单 Escape 和 IME 回归 |
| Markdown 与安全 | markdown、polish、reading-polish 覆盖 GFM、长内容、目录、流式残片、安全链接、原始 HTML 与远程图片限制；未改动内容渲染。PR #284 的目录改进保留在其独立分支 |
| 表格 | data-table/premium 覆盖筛选＋排序、分页、选择身份、0／未知及展开状态；新浏览器真实选择第 0 行并核对导出 selection={kind:selected,rowIndexes:[0]}，连续字段编辑、筛选和搜索不发查询 |
| 图表与文件 | chart-workspace/result-experience/export/pdf 覆盖轴范围、排序、当前视图导出、失败／重试与原图保留；浏览器实际接收 XLSX、CSV 来源 ZIP、生成图及专业图 PNG/SVG 来源 ZIP。开关菜单／导出不额外生成图表 |
| 身份、并发与成本 | 原测试覆盖迟到复制、停止后响应、身份／权限切换、历史恢复竞争、下载拒绝、收据取消与卸载；scope/result/request 绑定以及 HomeQuery 和回答的现有 key 仍生效；未发现需要改动的额外业务缺陷 |

## 验证

- `npm run verify`：380 文件、2,895 项通过；类型、全量 Lint（0 错误，959 个原有警告）及生产构建通过。随后增加的 ArrowUp 回归与最终源码另跑受影响检查及构建。
- `npx tsc --noEmit`、改动文件 ESLint、`git diff --check`：通过。
- `npx vitest run src/components/home/__tests__ --maxWorkers=2`：36 文件、292 项通过。曾在并行跑浏览器时出现一条 polish 异步等待超时；未改断言／超时，单文件 8 项复核通过，再以两 worker 执行完整首页回归。
- 原 `home-query-experience-p2-browser.mjs after`：1280／390px 实际开发页面通过，包含三模式、输入保持、长回答／Tab、来源、表格、图表、失败恢复和 editor/viewer 禁止探测。
- 最终生产构建 `HOME_QUERY_MENU_ONLY=1 HOME_QUERY_P2_BUILD_MODE=production node scripts/verification/home-query-experience-p2-browser.mjs after <localhost>`：320／390／768／1024／1280／1536px 全通过，317 次几何检查。每个菜单覆盖上／中／下位置、首尾命中、点击／Escape／外部关闭、祖先滚动、resize；另有详情、15 条历史、归档恢复、失败下载重试和手动复制。
- `HOME_QUERY_MENU_ONLY=1 HOME_QUERY_P2_WIDTHS=1280 HOME_QUERY_P2_BROWSER_ZOOM=1.25` 及 `=2`：Chromium 原生每站缩放，断言 innerWidth 与 devicePixelRatio，125%／200% 及 600px 物理高度检查通过。不是 CSS zoom 或 pinch 模拟。
- CI 在既有真实页面浏览器步骤加入六档菜单与两档原生缩放，失败即阻断；原焦点／权限／数据库／工程检查继续执行。
- 首轮 CI：380 文件 2,896 项、焦点、真实 Auth、隔离数据库、构建、原 P2 六档及菜单六档通过；缩放前置断言发现默认 headless shell 不读取 Chrome 缩放偏好。用同版 Playwright 1.58.2 在本地复现 width=1280/dpr=1 后，缩放场景明确选完整 Chromium channel，保持原缩放与几何断言不变；同版完整 Chromium 145 的125%／200%及低高度均通过。

未确认仍未修复的本轮功能缺陷。验证使用本地实际组件与合成 HTTP／文件，不代表生产身份、真实数据库、真实模型、物理手机键盘或系统文件保存验收；未写生产数据，也未合并／发布 main。远端 CI 状态以 PR 精确 head 为准。
