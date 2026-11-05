# 通用楼宇图片验证记录

日期：2026-11-05。基线：主线 `ccedadb3b5e69d09613a4303d8677f138bbce5d3`。本轮范围是将原两栋试点拓展为楼宇照片目录，保持原资料入口与看图的按需交互。网络图片收集、生产上传与上线结果由批次记录另行确认，不能用代码测试代替。

## 执行回归

- `src/app/api/map/building-photos/__tests__/route.test.ts` 执行实际 GET handler：匿名、viewer/editor/admin、未知有效角色、模拟登录归属、active/tracked 条件、跨楼宇/归档照片不可访问、精确私有路径、外链和来源校验、签名错误、中文审计标签。
- `src/app/api/map/data/__tests__/building-photos.test.ts` 执行地图 GET handler：现有楼宇及未来供应通过正确的 building_id 获得摘要，只有返回范围内的记录进入响应，无 URL/Storage 路径泄漏，匿名及未知角色不查询目录。
- `src/lib/building-photos/__tests__/catalog.test.ts` 覆盖目录分页、ready/active/tracked 条件、字段白名单和错误传播；`src/services/__tests__/buildingPhotosClient.test.ts` 覆盖登录、模拟登录请求头、取消信号和撤回错误。
- 地图原 `map-building-preview.test.ts` 的试点交互回归保留，并增加普通楼宇/未来供应、关闭试点开关、说明转义、来源、取消迟到响应、失败重试、指标回读保留摘要、无图与演示模式。首屏转换路径另由 `mapStartupOptimization.test.ts` 覆盖。
- `supabase/tests/building-photos/run.mjs` 接入 Verify 的 PostgreSQL 17.6 服务，执行本次 migration，测试角色表权限、RLS、临时放开权限时仍隔离浏览器角色、唯一/外键/字段/存储归属及完整性约束、服务端发布/归档/删除。只连接一次性 localhost 合成库。
- 上传 handler 的 Node 安全及幂等测试通过独立 CI 步骤运行；该脚本不由 Vitest 扫描。
- 审计动作翻译影响 `AuditLogPage` 的实际筛选消费链，新增并登记该页面的对象筛选执行回归：首字后结果回读、继续输入、光标中插、中文组合输入、清空及照片导入中文动作显示。

## 本地执行结果

- 最终一轮 `npm run verify` 的检查部分通过：审计覆盖、TypeScript、Lint（0 错误、809 警告）、158 个 Vitest 文件 / 1061 项测试。首轮误将独立 Node 测试作为 Vitest 文件，已改为独立 `.node-test.mjs` 文件名并保留 CI Node 步骤；同轮原有随机延时导航测试一次超过其 500ms 断言，最终完整重跑通过，没有改动其断言或实现。
- Webpack 生产编译成功；随后收集原有 `/api/oss` 页面数据时，`ali-oss → address → os.networkInterfaces()` 因执行环境的 `uv_interface_addresses / Unknown system error 1` 失败。因此本地不能声明完整生产构建通过，必须由精确 PR head 的 Verify 完成。
- 最终署名布局改为说明与翻页下方的整行后，6 个受影响测试文件 / 58 项回归再次通过。新增文件定向 Lint 通过。上传 handler 的 9 项 Node 测试通过。
- 本批 50 条清单逐条通过实际应用的摘要、URL、来源、许可证与存储路径校验。此项只证明记录符合应用入口，不替代图片内容、Storage 上传和生产读取核验。

## 隔离浏览器

`scripts/verification/verify-building-photos.mjs` 使用实际画廊、图片客户端和 CSS，登录与照片响应使用合成夹具，不接触生产账号。该脚本已加入 Verify，并将截图与 JSON 结果作为 7 天 CI artifact 保留。

本地 Chromium 153 的 1280×800 键盘、390×844 和 320×740 触控模拟均通过：默认零图片请求、按张加载、第二张失败后重试、返回复用、来源与许可链接、长署名可读、无横向溢出、Esc 收起并把焦点还给看图入口。手机来源/许可链接命中区至少 44×44px，长署名独占整行。

本地浏览器分发包默认没有中文字体，首轮截图出现缺字；仅在临时验证目录添加官方 Noto CJK 字体后，重新运行上述全部尺寸并目检中文换行、署名和入口，产品字体及项目依赖均未改变。截图在本地 `verification/building-photos/`，不纳入 Git；CI 使用其安装的 Chromium 与字体环境。该隔离场景不覆盖真实高德底图、正式登录身份或生产照片。

## 待 CI / 生产确认的边界

本地执行环境仅映射 root UID，PostgreSQL 按安全规则拒绝启动，未绕过该限制。本地没有实际执行本次 SQL，数据库结论必须等待精确 PR head 的 CI PostgreSQL 17.6 回归。未使用生产库代测。手机真机与生产带真实账号的浏览器验收尚未执行；上线状态和实际照片数量由批次记录及生产回读确认。

## CI 搜索焦点门槛修正

首个 PR head `8da7cb4` 因改动全局 `vitest.config.ts` 触发全部搜索入口检查。将上传测试改为独立 `transfer-handler.node-test.mjs` 文件名后，恢复原 Vitest 配置，不再产生无关全局影响。剩余受影响入口为地图既有登记入口和实际消费新增审计文案的审计页；为后者补真实组件回归并登记，门槛脚本及既有用例均保持。

以精确基线 `ccedadb3b5e69d09613a4303d8677f138bbce5d3` 实际运行搜索焦点 gate，3 个测试文件 / 33 项通过，执行报告确认所有登记必需用例均实际通过。门槛契约的 5 项 Node 测试及改名后的 9 项上传测试同样通过。
