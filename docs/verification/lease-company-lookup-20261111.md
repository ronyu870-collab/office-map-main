# 新增成交：企业联想与近期成交

合并候选与 `origin/main`（`39d2c7a3732f92a858dc6c30b6f72109f02b1c4c`）对照，包含该版本已有的桌面团队成交表格修复。改动仅接入「租赁成交填报 → 新增成交」的企业名称字段。编辑记录、归属、代报、草稿快照、原提交与重复成交检查沿用原契约。

- 联想来源为填报人可读的租赁成交。企业名称和疑似全称支持关键词搜索，最多显示 8 个名称。疑似全称只用来找候选；选中后只更新企业名称，可以继续手工修改或直接填写新名称。查询失败不阻塞填报。
- 当名称忽略大小写和首尾空白后精确匹配，且有可见、有成交时间的记录，显示「查看近期成交」。展开后按既有日期或周期的起始时间倒序显示最近 5 笔；没有额外的月份截断。名称相似、疑似全称、分公司和不同写法不会被自动归为同一家企业。查阅不会复制旧成交的数据。
- 复用原成交读接口的身份和来源判断。编辑者和只读角色只能查系统成交，管理员按原权限可读归档；用户模拟按有效角色查询。接口不缓存、不返回填报人信息、不修改表或权限。没有外部企业库或模型调用。

接口为 `GET /api/lease-transactions/read`，参数为 `company_lookup=suggestions|recent` 与 `company`。建议响应只含候选和近期成交存在标记，近期明细在展开时读取。可选 `record_source` 仍受原服务端范围约束；未授权、参数无效和查询失败分别沿用 401/403、400 和 500 响应语义。

验证：

- `VITEST_MAX_WORKERS=4 npm run verify` 通过：审计覆盖、类型、Lint（零错误）、180 个测试文件的 1,152 项测试及生产构建。前一次默认并发运行有一项未改动的模拟导航计时超过 1 秒；降低本机并发后整套验证通过，未修改该测试或门槛。
- 搜索焦点门禁已登记企业联想用例；门禁自身 5 项测试通过，合并候选的门禁执行 18 个文件、162 项测试并核对必需用例均运行且通过。
- CI 持续回归入口为 Vitest 的 [成交读接口测试](../../src/app/api/lease-transactions/read/__tests__/company-lookup.test.ts) 和 [真实表单交互测试](../../src/app/lease-submission/__tests__/lease-close-protection.test.tsx)。覆盖来源隔离、精确匹配、候选去重、限制笔数、首字符后等回包再编辑中间字符、焦点与光标、中文组词、过期回包、手填保存以及按需展开和重试。
- 实际生产构建的读接口经 Supabase JS 2.111.0、PostgREST 16.5 与本机 PostgreSQL 17.11 的合成视图运行。匿名、普通编辑、管理员及管理员模拟编辑均按预期返回；含标点的名称精确查询返回倒序前五笔，疑似全称与分公司未混入。未读写生产数据。
- Chrome 157.0.8103.50 在 1280×900、390×844、320×844 下走通实际填报页、中文组词事件、继续输入、候选键盘或触控选择、按需查看、保存并重开草稿。认证及原填报数据接口使用合成夹具；1280 和 390 视口也走通了正式提交，核对只发出一次写请求，选择的企业名称正确且历史字段没有带入。实际展开检查了 44px 触控目标、页面无横向溢出及草稿企业名称回读。见[浏览器验证记录](lease-company-lookup-images/browser-results.json)。
- iOS Safari 和 Android Chrome 真机、目标库角色会话未验证。手机视口与触控模拟单独记录。精确 PR head 的 CI 结果见 PR 的 Checks。

视觉复核（VERIFY-05）：Codex 查看了同一编辑角色、相同合成数据和浏览器下基线与本 PR head 的实际页面，桌面和手机视口均通过。空态保留原有阅读顺序、文字分组与对齐；候选沿输入框宽度展开，关闭后恢复下方控件；同名入口紧贴企业名称且不抢焦点；展开后历史条目按楼宇分组，字号和间距沿用表单，同一滚动区域中的底部提交动作保持可见。320px 边界未见文字裁切或横向溢出。

| 视口 | 修改前 | 空态 | 候选 | 同名入口 | 展开近期成交 |
| --- | --- | --- | --- | --- | --- |
| 1280×900 | [基线](lease-company-lookup-images/before-1280.png) | [空态](lease-company-lookup-images/empty-1280.png) | [候选](lease-company-lookup-images/suggestions-1280.png) | [入口](lease-company-lookup-images/matched-1280.png) | [历史](lease-company-lookup-images/recent-1280.png) |
| 390×844 | [基线](lease-company-lookup-images/before-390.png) | [空态](lease-company-lookup-images/empty-390.png) | [候选](lease-company-lookup-images/suggestions-390.png) | [入口](lease-company-lookup-images/matched-390.png) | [历史](lease-company-lookup-images/recent-390.png) |
| 320×844 | — | [空态](lease-company-lookup-images/empty-320.png) | [候选](lease-company-lookup-images/suggestions-320.png) | [入口](lease-company-lookup-images/matched-320.png) | [历史](lease-company-lookup-images/recent-320.png) |
