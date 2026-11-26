# 2026-11-24 开放 PR 整合

用户授权合并当前全部41个开放 PR。整合基线：`7a27c08798f18f48cd5605f348a3efc0ba1040f8`；使用合并提交保留原始 PR 祖先关系，交由 #289 承载整合后的检查。

## 冲突处理

- #284/#289：合并 AI 阅读、原生菜单及键盘操作；保留后来已验收的地图指标卡、短窗口和资料阅读修复。
- #15/#30/#41/#114/#116/#143：后续 main 已有替代实现的部分保留现行实现，移除重复监听、旧反馈入口、旧草稿迁移、未引用组件及不兼容的旧缓存／部分网格方案。保留仍适用的新增回归和历史说明。
- #17：保留中文与填报契约检查，断言适配当前分组、动态加载与带版本时间的更新接口。
- #20：创建成功后确认回读确实含新账号；保留当前 UI 角色映射及必填手机号。
- #59：只将既有迁移文件改名为生产实际迁移时间，SQL 字节不变，不重复执行生产迁移。
- #82：原子转交、资格锁、版本检查、幂等收据、失败保留待确认入口及事务内两类审计。新增真实 PostgreSQL 17 CI。用户另行授权后已应用生产迁移 `20261124142812`；函数服务端专用、空 search_path、收据 RLS 与外部权限均核验，既有触发器保持，收据0行，未执行生产业务写入。迁移 SQL 内容不变，文件时间与生产登记对齐。
- #93：文字主轴、成组对齐及两档字号起步纳入现行规范；撤销的人工视觉和真机合并门槛保持撤销。原编号冲突顺延 N39。
- #126/#220：保留历史核查记录，不将旧证据当作本轮验证或重新回填生产数据。
- #142：保留显式 `?visual=editorial` 候选预览，正常入口设计不变；不恢复已由 AI 工作区替代的旧首页卡片。
- #145–#165：21个累积性能 PR 已由 #166 发布；本轮并入原始历史，保留 #166 及后续修复，删除残留的重复订阅和无用变量。
- #176：管理备忘录离开前保存、公告草稿账号／会话隔离、成交云草稿读取保护、历史响应式阅读、关联成交加载／权限／失败／空状态；保留现行地图返回连续性，旧浏览器用例适配现行页签及返回链接。
- #218/#221：保留 main 已采用的 AI 预算／流式工具链及后续修复，不复活过期视觉门槛。
- #235：保存并展示子市场资料，保留脏草稿保护、权限、审计与发布数据校验。

## 验证状态

- 所有41个原始 head 均为整合分支祖先。
- 类型检查、Lint、审计契约检查通过；首次全量 Vitest 3062通过、3失败，失败为过时的中文／导入断言和错误提示断言；适配后的两个文件14项全部通过。
- 隔离 PostgreSQL 17 原子转交23组回归通过，含并发锁、重试、CAS、审计与收据回滚。
- 使用隔离 Supabase 配置与合成地图密钥的生产构建通过。
- 最终 head 的远端完整 CI、GitHub 合并及发布状态以 PR 检查和后续结果为准；本记录不提前声称通过。

- 比较页加载中的返回链接缺失上下文：新执行单测在旧实现1失败／1通过；修复后与比较工作区共11项通过。加载占位使用同一受校验返回地址并保留 Suspense 边界。
- 生产安全顾问新增一项私有收据表“RLS开启但无策略”的信息提示；这是服务端专用、普通角色全部拒绝的预期设计，权限实际核验通过。[提示说明](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)。其他顾问项目与迁移前一致。
- 生产迁移前核对 PG17.6、现行审计函数与3条成交触发器；备份健康 [45370046874](https://github.com/ronyu870-collab/office-map-main/actions/runs/45370046874) 验证本周完整归档 `2026-11-22T23-28-40-402Z-2245f18f-b34a-467f-b90d-89ca9569f80a`。既有数据库恢复演练见[恢复记录](../backup-recovery/2026-11-06-verification.md)，本轮不重新执行生产恢复。

- 生产构建浏览器：关联成交四态＋比较显式返回／浏览器后退在1280、390两档通过，保持项目、搜索与相机；备忘录保存失败、离开保护、正文读取重试与缺失预览回退通过。AI 1280结果阅读场景及390角色场景通过，其余宽度与菜单矩阵交由完整 CI。

- 远端首轮 [45415128641](https://github.com/ronyu870-collab/office-map-main/actions/runs/45415128641)：401文件／3067单测、全部数据库、真实 Auth／HTTP、搜索焦点及报告之前的浏览器矩阵通过；报告隔离渲染器未解析新增 visualPreview 模块而失败。补齐真实模块解析后，本地报告七档视口、18节／11图／62数值、导航、减少动态效果、匿名阅读与主页／地图保护均通过。最终精确 head CI 继续单独检查。

## 原始开放 PR 快照

| PR | 原始 head | 标题 |
| --- | --- | --- |
| [#15](https://github.com/ronyu870-collab/office-map-main/pull/15) | `bf63b5e189328b622cd37a5be783aade11f65b30` | perf: harden map marker rendering and overlay interactions |
| [#17](https://github.com/ronyu870-collab/office-map-main/pull/17) | `469ecea7cc277aa1801792e596b37dbdffdcedf0` | test: harden broker lease form language and business contract |
| [#20](https://github.com/ronyu870-collab/office-map-main/pull/20) | `8f406b812bbbc850e91984d9ef04aceb16cbcf31` | fix: restore admin user creation flow |
| [#30](https://github.com/ronyu870-collab/office-map-main/pull/30) | `17be9ffcb215751284d25462673052b9f26b5adf` | feat: add non-admin user feedback portal |
| [#41](https://github.com/ronyu870-collab/office-map-main/pull/41) | `3544360986ce85c3444bef5ffdb3cc4860483a16` | Fix quarterly draft lifecycle and period integrity |
| [#59](https://github.com/ronyu870-collab/office-map-main/pull/59) | `59f4828355a4c4cdc8459f963053d36b16669752` | Align map migration history timestamp |
| [#82](https://github.com/ronyu870-collab/office-map-main/pull/82) | `d9cf3e3daf061a996c37f2108cb06c6f1f6b406c` | 修复成交转交的接收人校验、并发覆盖与安全重试 |
| [#93](https://github.com/ronyu870-collab/office-map-main/pull/93) | `a721c895422fe5a6d92a748f238c83e64a442569` | docs: 统一 Agent 审美补充与设计验收规范 V2.3 |
| [#114](https://github.com/ronyu870-collab/office-map-main/pull/114) | `39416981f898956c464b17f9421001a2b8ff76d0` | 统一玉渊潭和四季青大气泡的颜色 |
| [#116](https://github.com/ronyu870-collab/office-map-main/pull/116) | `c1150f503b4d87cacf52a95631de77908ac7f65a` | 企业选址洞察：十一页资料完整重编与滚动研究报告 |
| [#126](https://github.com/ronyu870-collab/office-map-main/pull/126) | `d73a7d385d8364a25ea7ad2215381301452d5719` | 记录玉渊潭地图验收与发布核对 |
| [#142](https://github.com/ronyu870-collab/office-map-main/pull/142) | `aa5ce033d4b35ba9f8d4fc22c6d72d5fe23a6dfb` | [实验 / 不合并] 报告、登录页与首页的建筑摄影视觉预览 |
| [#143](https://github.com/ronyu870-collab/office-map-main/pull/143) | `701580befb17d212c39d4d9c609e6e450bf55db2` | perf: 第三轮首批性能优化（资料库、审计与后台） |
| [#145](https://github.com/ronyu870-collab/office-map-main/pull/145) | `e405cb8af2c99ed0ce36bb966a5b9dcbbb7c5a78` | Improve navigation timing coverage and slow-route feedback |
| [#146](https://github.com/ronyu870-collab/office-map-main/pull/146) | `7725d9819403a9f9b0f3c8508daf328f7000941e` | Keep building comparison responsive and refresh snapshots after writes |
| [#147](https://github.com/ronyu870-collab/office-map-main/pull/147) | `28f69024c4f1784df33dc9bd41bc87401bb2ccbd` | 减少研究资料库重复读取并支持目录分页 |
| [#148](https://github.com/ronyu870-collab/office-map-main/pull/148) | `a0a7f62c757f60350b916ab7b01998e60741b0a4` | 分段诊断地图启动关键路径 |
| [#149](https://github.com/ronyu870-collab/office-map-main/pull/149) | `fcde97b684aba2295ca7acd459a7fb94b9719136` | 合并审计快速输入查询并丢弃旧结果 |
| [#150](https://github.com/ronyu870-collab/office-map-main/pull/150) | `7e13c12694b8ba9101d771a9c330e6c55da9d947` | 楼宇对比先加载候选目录，再按需读取详情 |
| [#151](https://github.com/ronyu870-collab/office-map-main/pull/151) | `23e7342c503747faca69c80dcb11ab8f6ac1bf5e` | 租赁填报分开显示本周进度和个人记录 |
| [#152](https://github.com/ronyu870-collab/office-map-main/pull/152) | `0e0bf96f62b88edccca49dd4b853e42feb0df65a` | 后台栏目复用入口核验的真实操作者邮箱 |
| [#153](https://github.com/ronyu870-collab/office-map-main/pull/153) | `2e38de2504869d35b28ee074bafad925190f092a` | 季度填报先显示已确认任务和只读草稿 |
| [#154](https://github.com/ronyu870-collab/office-map-main/pull/154) | `e623c21f5e21dc35d3c2b5ad770cc8e6dea8ff9a` | 客户方案改名和排序复用已选楼宇资料 |
| [#155](https://github.com/ronyu870-collab/office-map-main/pull/155) | `6a783fb3e26d1dbebf18ae73c527d51a6c78bafe` | 隔离诊断区分鉴权、数据源和 API 响应耗时 |
| [#156](https://github.com/ronyu870-collab/office-map-main/pull/156) | `fcb378610a36db1be289e1bee646d311b9ddaad5` | 后台台账先读，修复楼宇对比首次选中竞态 |
| [#157](https://github.com/ronyu870-collab/office-map-main/pull/157) | `0cf4a8caa35bebd2d3a3cb6fcba18cbe171b7f46` | Reduce admin diagnostic reads to the required fields |
| [#158](https://github.com/ronyu870-collab/office-map-main/pull/158) | `7a8a1f59cd66695245251d96b7208f2777f2e7d7` | Load admin memo lists and tags independently |
| [#159](https://github.com/ronyu870-collab/office-map-main/pull/159) | `c32d28299e6a42d1a5b7d413f03d67e07b46e770` | Show admin user directory before assignment counts |
| [#160](https://github.com/ronyu870-collab/office-map-main/pull/160) | `6b8aff090a78a7b8e39fca66cf56fcefdca6c797` | 性能：显示覆盖规则先于新增楼宇目录加载 |
| [#161](https://github.com/ronyu870-collab/office-map-main/pull/161) | `3153d5c4a8b69e39502149b62efb7c3db5ddd316` | 性能：减小企业选址报告封面与章节图片 |
| [#162](https://github.com/ronyu870-collab/office-map-main/pull/162) | `1a137b4f2c8a80b18727d748ebba2b144d516990` | Improve system performance through lease history loading |
| [#163](https://github.com/ronyu870-collab/office-map-main/pull/163) | `c475beb7b1d0f6417e82ab1d17384d4bd40d7d71` | Improve system performance through team monitoring |
| [#164](https://github.com/ronyu870-collab/office-map-main/pull/164) | `ac7eafc1e3a796fa4e0b48603d3073c9c319e3b2` | Improve system performance through feedback timelines |
| [#165](https://github.com/ronyu870-collab/office-map-main/pull/165) | `874c27834b3ae9ec1f87e693eb2118efb317e557` | Improve system performance through the login transition |
| [#176](https://github.com/ronyu870-collab/office-map-main/pull/176) | `070c1c87cb5de84781be8d7ea48e496f91afe1a4` | 全站基础体验横查：修复成交、地图与后台交互 |
| [#218](https://github.com/ronyu870-collab/office-map-main/pull/218) | `8dda5b98baec31a75f770b0ad608be1380596231` | feat(ai): Colliers AI 4.0 P3 bounded token budget and conservative provider cost audit |
| [#220](https://github.com/ronyu870-collab/office-map-main/pull/220) | `2a243b4fb946759a6be5f81d03d4d2e152c51d69` | docs(map): 记录16个子市场生产资料补齐、来源与审计核查 |
| [#221](https://github.com/ronyu870-collab/office-map-main/pull/221) | `9a9a1576e97f70448be7e660aa55f7a443118128` | feat(ai): Colliers AI 4.0 native DeepSeek streaming, tool events, and signed terminal delivery |
| [#235](https://github.com/ronyu870-collab/office-map-main/pull/235) | `de7c554b4b76932607fa779358e3cb3de969d805` | feat(map): auto-publish all submarket briefs without editorial approval step |
| [#284](https://github.com/ronyu870-collab/office-map-main/pull/284) | `3f84b067033682bfbe0cf4ef801f651ded51e2dd` | fix(ui): clarify AI evidence and map reading hierarchy |
| [#289](https://github.com/ronyu870-collab/office-map-main/pull/289) | `de55eb6577df2fed5c162510c4bc7d4d6bd7b793` | fix(ai): restore reliable workspace menus and interaction boundaries |
