# 首页长结果焦点与布局竞态

本项处理阻挡地图 PR 279 的首页必要 CI，不改变地图业务、权限或统计。

CI 45207623216 在 Chromium 145.0.7632.6、768px 下，Tab 第30步“复制结论”处于对话区外（top 1769.47，视口61—922，scrollTop899）。相同版本本地复现了“数据依据”在对话区外。失败后截图已有一次恢复可见，因此不能把所有瞬间裁切认定为持续失效，也不能仅凭推测归因地图或SDK。

焦点交接改用 preventScroll，再由既有 revealControl 仅调整工作区滚动容器；进入对话内容的焦点、键盘或指针操作立即解除结果尾部跟随与旧阅读锚。两者独立修改曾仍捕获浏览器失败，未据此提交；组合版本执行原脚本完整五档通过。未删除SVG可聚焦点、等待重试或放宽可见性断言。

稳定执行回归：隐藏布局容器的原生焦点滚动、focusin/keydown之后布局变化先于scroll事件三种情况；旧实现3失败，修复后3文件62项全部通过。现有Verify工作流会执行全量Vitest及首页浏览器脚本，无需新增跳过或审批。类型、改动Lint（0错误）和生产构建通过。

原浏览器命令：`PLAYWRIGHT_BROWSERS_PATH=/private/tmp/colliers-playwright-145 PERF_BROWSER_CHANNEL=chromium PERF_PLAYWRIGHT_MODULE=/private/tmp/map-workspace-browser-tools/node_modules/playwright-core HOME_QUERY_P2_BUILD_MODE=production HOME_QUERY_P2_EVIDENCE_DIR=/tmp/map-136-home-focus-contained-browser node scripts/verification/home-query-experience-p2-browser.mjs after http://127.0.0.1:3238`。

1280/1536/768/390/320五档共113条记录通过；各档Tab/Shift+Tab各60步，下折叠区控件分别9/9/8/10/17次正确显示，背景位置不变。实际浏览器145.0.7632.6，Next16.2.12生产构建、隔离身份和业务HTTP；非原生手机或生产身份验证。原错误、候选失败及最终结果摘要保留在[JSON](home-focus-ci.json)。本次通过不能证明永久无时序问题；提交后仍以精确head必要CI判定合并。
