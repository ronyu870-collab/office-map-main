# Colliers AI 主页命名验收

基线：main c90e00fd12dc568b379a893df6ff00e848901455。用户确认采用Colliers AI，并明确授权本次文案合入main及上线。

产品差异仅为主页label“对话查询”→“Colliers AI”、placeholder“对话查询尚未开放”→“AI 助手尚未开放”。同步2个既有测试文件及现有浏览器回归的可访问名称，未放宽断言。没有样式、业务逻辑、路由、AI接口、模型调用、权限、数据库或配置变更。查询与发送继续禁用，既有管理员业务智能入口与季度研究入口保留。

## 验证与视觉

- 纯文案调整，按VERIFY-01复用已有回归；两个受影响测试文件24项全部通过，生产构建成功。未为文案新增只复述实现的测试，未将这些检查冒称本地完整verify。
- 现有主页浏览器回归10组通过，结果见[after-browser.json](after-browser.json)。包含1280/390/320、相关断点两侧、管理员正常/长消息、普通用户空状态、编辑者错误恢复；菜单焦点、导航往返、禁用查询、无新AI请求和无横向溢出保持通过。
- before与after使用同一合成夹具、角色、Chrome157.0.8103.52与视口。基线生产构建只还原主页两处旧文案，截图后工作区恢复已确认新文案；其他产品源码与main相同。初次dev夹具曾等待业务入口超时，不作为通过证据；生产构建模式没有修改断言。
- 评审者Codex。实际核对整页与标题/输入框分组：桌面和窄屏标题不换行、不挤压右侧入口，字号、字重、留白及版块边界保持原版。**视觉结论：通过。** 用户已确认名称，最终PR head在描述中绑定。
- 手机为模拟视口；真实iOS/Android未测，沿用用户本次主页明确不等待真机验收的决定。仅更改禁用控件标签与提示，不改输入或触控流程。无加载或速度变化，VERIFY-06不适用。

|视口|修改前|修改后|
|---|---|---|
|1280|[前](before-1280.png)|[后](after-1280.png)|
|390|[前](before-390.png)|[后](after-390.png)|
|320|[前](before-320.png)|[后](after-320.png)|

[普通用户示例](after-empty-viewer-390.png)。全部截图使用合成数据，不含生产用户资料或凭证。

本地日志：`/private/tmp/colliers-home-ai-label-test.log`、`/private/tmp/colliers-home-ai-label-build.log`、`/private/tmp/colliers-home-ai-label-after.log`；基线生产构建日志`/private/tmp/colliers-ai-label-baseline-build.log`。合并仍要求精确head的Verify和Visual acceptance通过。生产部署结果另存项目outputs发布回执，不把本地验证视为已上线。
