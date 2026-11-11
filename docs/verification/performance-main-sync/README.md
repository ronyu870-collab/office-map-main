# 性能分支对齐 main：成交页面复核

基线为 GitHub main `39d2c7a`，候选为本次合并后的生产构建。固定 Chromium 145.0.7632.6；同组隔离管理员、2 位顾问和 24 条合成成交记录。认证、外部服务与数据接口由夹具替代。

| 页面 | 桌面 1280×844 | 窄屏 390×844 |
| --- | --- | --- |
| 填报工作区 | [前](workspace-before-1280.png)／[后](workspace-after-1280.png) | [前](workspace-before-390.png)／[后](workspace-after-390.png) |
| 楼宇成交抽屉 | [前](drawer-before-1280.png)／[后](drawer-after-1280.png) | [前](drawer-before-390.png)／[后](drawer-after-390.png) |
| 团队监控 | [前](monitor-before-1280.png)／[后](monitor-after-1280.png) | [前](monitor-before-390.png)／[后](monitor-after-390.png) |

Codex 视觉复核：填报状态和明细继续沿用 main 的分组；抽屉仍分开显示本楼和未确认楼座的记录，关闭恢复焦点；桌面表格显示全部列，成交年份紧邻季度；窄屏保留横滑、本周及展开各周。团队监控数据库链接移入内容区上方，不遮挡分页。其他模块沿用各自的对照记录，整份 PR 的视觉评审和两类手机真机验收仍未完成。

团队监控浏览器回归首先重现浮动链接拦截第二页按钮的点击；候选真实点击可翻页，同时保留入口、筛选、周数、顾问下钻、返回填报和两类查看者零受保护请求。回归接入 Verify。工作区与历史浏览器回归独立通过。
