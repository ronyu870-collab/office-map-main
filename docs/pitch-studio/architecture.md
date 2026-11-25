# Colliers Pitch Studio 公共架构与协议

阶段 01，协议 `colliers-pitch/1`。此文档随基础实现交付，后五阶段按以下边界接入；不表示后续能力已经上线。

本阶段提供真实的「测试素材归档 → 图文模板 → 私人项目与标准页 → 私有 PPTX → 项目重开」闭环。原件、业务内容、视觉布局、主题及用户作品分别管理。产品以可编辑单页／多页 PPT 为核心，独立素材导出为兼容方向，AI 完整提案为后续方向。

## 1. 模块职责与依赖

| 模块 | 职责与边界 |
| --- | --- |
| `src/app/intelligence/pitch` / `src/components/pitch` | 五板块工作台、会话隔离、可恢复创建、项目重开、导出历史、分类管理；手机使用同一操作与持久化接口 |
| `src/app/api/intelligence/pitch` | Node 路由；调用经过认证、校验、审计的领域 HTTP 入口 |
| `src/lib/pitch/contracts` | 版本化领域 DTO、Zod Schema、命令及内容／场景协议；拒绝未知字段和不支持的版本 |
| `src/lib/pitch/templates` | 数据库配置 + 审查后的代码适配器；内容构建与布局计算分开 |
| `src/lib/pitch/design` | 独立主题协议；业务模板不包含品牌配色、字体或字号 |
| `src/lib/pitch/render` | 已获权、已验证媒体字节和场景 → 可编辑 Office 文本、图片；不接收 URL、脚本或 XML |
| `src/lib/pitch/data` | 新鲜权限 RPC、对象存储、哈希、模板与主题快照、任务与文件生命周期 |
| `private.pitch_studio_access` | 唯一领域写入者，原子保存业务记录和审计事件；所有读写都重核有效角色、会话、试点资格及范围 |

复用 `SessionProvider`、共享 Supabase 客户端、`verifyQueryIdentity`、现有原件哈希方法、私有 Supabase Storage 机制和品牌 Logo。将现有研究报告的 PptxGenJS 初始化提取为 `officePresentation.ts`，研究导出与 Pitch 共用底层引擎；两者继续拥有独立内容与存储模型。未修改客户方案草稿、楼书知识库或研究结果的业务协议。

没有为了目录完整创建空的 AI／任务模块。已有 `verifiedDataTool`、`modelProvider`、`modelRuntime` 的数据授权、模型路由和成本控制留作阶段 04／06 的适配入口，不能把管理员专用 AI 查询资格误当作 Pitch 员工资格。

## 2. 领域及数据模型

| 对象 | 关系型存储与关键关系 |
| --- | --- |
| SourceDocument | `pitch_source_documents`：私有原件路径、MIME、大小、SHA-256、版本、语言、数据日期、组织／区域／城市／业务线、创建／修改人、状态、有效期与可见范围 |
| SourcePage | `pitch_source_pages`：原件 FK、页序／逻辑单元、定位、抽取文本、解析器版本；原始 PPT 只属于原件域 |
| MediaAsset | `pitch_media_assets`：`(id, version)` 主键、来源页 FK、独立文件路径／哈希／大小、作用域与生命周期；媒体版本不可被普通用户覆盖 |
| ContentAsset | `pitch_content_assets`：所有权、分类 FK、标签、多语言名称、发布状态、当前版本、可见范围及三项使用许可；`pitch_asset_media` 用资产／媒体版本外键维护图片依赖；`pitch_asset_versions` 保留不可变内容和当时发布／披露快照 |
| SourceReference | `pitch_source_references`：`(asset_id, asset_version, id)` 主键；原件／页面 FK、记录标识、定位、来源版本、日期、哈希；页面再保存来源快照 |
| BusinessTemplate | `pitch_templates` + `pitch_template_versions`：业务分类、名称、状态、版本与配置／哈希；可执行逻辑只在代码注册表 |
| LayoutDefinition | `pitch_layout_definitions`：`(id, version)` 主键、审查后的引擎标识及容量配置，与业务模板分别版本化 |
| DesignTheme | `pitch_design_themes` + `pitch_theme_versions`：可发布主题与不可变视觉协议／哈希 |
| PitchProject | `pitch_projects`：私人所有者、作用域、项目版本、主题版本及可选上版项目 FK；普通管理员也不能读取他人的私人项目 |
| PitchSlide | `pitch_project_slides`：项目 FK、顺序、页面版本、资产／模板／布局／主题版本 FK、SlideContent、SlideScene、来源快照 |
| GenerationJob | `pitch_jobs`：项目 FK、任务类型、状态、失败码、创建／修改人、时间；当前导出同步执行且保留持久状态 |
| ExportArtifact | `pitch_exports`：项目／任务 FK、受众、格式、私有路径、哈希、大小、页面版本清单、状态及创建时间 |

`pitch_asset_categories` 的稳定 `system_code` 与显示名称分离，管理员可增设、改名、启停分类，不能重命名系统标识；`general` 是初始能力标识，不能停用。北京、公司介绍、团队介绍、案例等均未固化为数据库枚举。语言使用可扩展语言标记，名称采用语言键映射。

权限、状态、所有权、版本、日期、哈希与关键关联都有关系字段／约束／索引。JSONB 仅承载通过 Zod 校验的内容、场景及视觉／模板配置。数据库额外约束 JSON 类型、协议标识、外键、唯一性及状态；写 RPC 只授予服务端，浏览器不能绕过 Zod 直接写入内容。源页尚无用户编辑接口；新增解析必须创建可追溯的新记录，不能修改历史原件。

## 3. 内容、场景与主题

`SlideContent` 表达业务含义：标题／副标题、结构化段落、指标、带来源的图片、表格、图表、地图引用、时间线、团队、案例、分析观点与限制、来源、数据时间和披露级别。未知数字保留 `null`，不能填成零；所有块引用已有证据，表格／图表校验形状，合成来源必须标为测试数据。

`SlideScene` 表达完成布局计算的视觉元素，只有有界文本和媒体 ID／版本；坐标不得越出画布。当前图文适配器只接受简短正文及一张图片，超过容量／缺少图片／语言不匹配时拒绝生成，不截断内容，也不静默丢弃表格、地图或其他不支持的块。

`DesignTheme` 提供 16:9 尺寸、品牌及辅助色、柔和背景、Logo 资源引用、中英文字体、标题／正文两档字号、边距、网格、图表配色、表格样式、页脚与页码。`colliers-default-v1` 明确是临时主题，未经品牌部门确认。主题定义不等于正式 PPT 母版。

历史项目固定主题、内容、模板和布局版本。主动升级通过 `project_theme_upgrade` 另存关联的新项目版本：原项目、旧主题、原始页面及导出文件保持不变；新页面沿用原资产／来源／内容，只重算布局并递增页面版本。暂不提供覆盖原历史版本的编辑。

## 4. API 契约

统一入口 `/api/intelligence/pitch`，请求要求真实 Bearer 会话，响应 `private, no-store`。POST 要求同源（或无 Origin 的已认证 API 客户端）、JSON，实际读取上限 24 KiB；未知字段、非法参数和超限内容拒绝。

| 方法／action | 输入／结果 |
| --- | --- |
| GET `catalog` | 当前有效试点范围与独立能力、分类、已发布模板和主题 |
| GET `list_assets` / `list_projects` | 可选 `before` UUID 游标；返回 `items`（最多 50）与 `next`，工作台支持继续加载 |
| GET `get_project` | `projectId`；返回私人项目、固定版本页面／来源和最近 50 条导出索引 |
| GET `download` | `projectId, exportId, audience`；权限和哈希校验后的真实 PPTX，不返回公开或签名 URL |
| POST `sample_create` | `requestId, scope`；归档合成原件／媒体／内容资产，返回 `assetId`；相同账号与 requestId 可安全重试 |
| POST `asset_save` | `assetId, expectedVersion, asset`；维护人员在获权范围内新增／更新企业内容，保存新不可变版本；企业发布要求关联媒体和原件也已在相同作用域发布；不能接管他人私人草稿 |
| POST `project_create` | `projectId, assetId, title, templateId, templateVersion, themeId, themeVersion, parameters`；返回保存后的项目 ID，重复 ID 只重放相同内容 |
| POST `project_theme_upgrade` | `sourceProjectId, projectId, expectedVersion, themeId, themeVersion`；另存新主题版本并保留父项目 |
| POST `export` | `projectId, audience: internal/client`；返回归档文件 ID、哈希、大小及受众，下载走独立接口 |
| POST `category_save` | `id, expectedRevision, systemCode, names, enabled`；仅有效管理员可维护分类，冲突返回 409 |

401：认证失效／模拟身份；403：试点关闭、作用域／角色／素材或披露许可拒绝；400／413／415：参数、大小或格式非法；409：版本／幂等冲突；422：模板容量或内容条件不满足；503：服务、存储或审计暂不可用。正文错误不返回密钥、底层 SQL 或业务记录。内部 `pitch_studio_access` RPC 只授予 service_role，不允许客户端提交身份或任意 SQL。

## 5. 权限与信任边界

`PITCH_STUDIO_ENABLED=true` 为服务端开关；`private.pitch_control.enabled` 是数据库开关，迁移默认 false。`private.pitch_grants` 是独立试点授权：账号、组织、区域、城市、业务线、到期时间、素材维护角色、检索／生成／对客／外部 AI 四种独立许可。空的授权区域／城市／业务线表示该授权内全部范围，资产和项目自身必须有明确作用域。权限来自当前 `user_roles`、未删除／未禁用账号、活动 `auth.sessions` 及当前数据库授权，不信任 user_metadata 或缓存 JWT 角色。

| 身份 | 能力 |
| --- | --- |
| 管理员 | 必须有有效试点授权；在授权范围维护素材，可全局维护稳定分类；不能读取其他人的私人项目 |
| 素材维护人员 | 当前 canonical editor/admin + `maintainer`，仅维护获权组织／范围素材；无权代管其他人的私人草稿 |
| 普通业务用户 | canonical editor/admin + generate，使用有权且已发布的企业素材及自己的草稿创建私人项目 |
| 只读用户 | canonical viewer，即使试点 grant 错配为 can_generate 仍不能写；可读取有权素材及自己已有项目 |
| 私人草稿所有者 | 必须同时满足当前身份和范围；所有权不豁免撤权、到期、只读或对客审批 |

所有 17 张 public 新表启用 RLS，authenticated 仅有 SELECT，按当前授权、范围、所有权及历史版本发布快照过滤；anon 无表权限。private 控制、授权、审计表同样启用 RLS并撤销直接权限。公开 RPC 为 security invoker，security definer 逻辑位于 private 且固定空 search_path。

检索不等于生成；生成不等于对客导出；内部授权不等于外部 AI 处理。对客导出还要求账户对客权限、当前及所引用历史版本均已发布且允许对客、披露为 client_approved、不是测试素材；下载前复核来源媒体和原件访问。外部 AI 暂无出站功能，`ai` 授权判断独立保留，不能由模型配置或模板自行打开。接入时必须另外核对每个依赖来源的外发许可。

初期拒绝所有管理员代入身份请求，包括代入本人；复用已有身份验证入口的这一收口，避免真实管理员权限扩大有效身份的素材或私人项目范围。后续如增加只读模拟，必须同时实现有效用户范围、数据库身份和审计，不得只移除 HTTP 头检查。

不新增真实业务数据查询旁路；后续数据模板调用已有受控 query / verifiedDataTool，Pitch 授权本身不能获得租赁团队、季度、楼书或其他业务数据权限。

## 6. 存储、失败及审计

私有 bucket `pitch-studio-private` 复用受控 Supabase Storage，不增加浏览器 Storage 策略。路径由服务端分配：`sources/{owner}/{document}/original.json`、`media/{owner}/{media}/{version}.png`、`exports/{owner}/{project}/{export}.pptx`。数据库只存索引／元数据，不存二进制或依赖 Vercel 临时文件。

上传 immutable、禁止 upsert；重试只能复用哈希一致的既有对象。读取检查大小与 SHA-256。导出先写 running job + pending artifact，再生成、复核权限、归档、原子完成任务和审计；下载在读取对象前后都重核权限。不发会在撤权后继续有效的签名 URL。

每次领域变更及文件交付准备都原子追加 `private.pitch_events`，记录真实账号、会话、动作、目标与必要前后结果。审计失败回滚业务事务。跨数据库与对象存储不能做单一事务：上传后最终保存失败可能留下孤立私有对象；进程退出／撤权可能留下显式 running/pending 任务。这些状态不能宣称成功，后续 worker 须按哈希／引用与任务状态清理、对账，不可无条件重做业务写入。当前工作台可看到 pending/failed 状态并重新导出。

## 7. 模板与主题扩展

1. 普通模板新增配置版本，使用 `templateConfigSchema` 校验，并通过经过审查的迁移登记模板根记录及 immutable 版本／哈希。可复用现有 `text-image/1` 适配器，无须新增执行代码。
2. 配置必须声明 ID／版本、中英名称、分类、资产类型、业务场景、输入参数约束、数据源、权限、布局、导出能力、AI 要求和缺失处理。当前输入协议为 strict `{language: zh|en}`，不接受未知字段。
3. 新业务计算或新内容类型才增加审查过的代码适配器和对应参数 Schema；必须有合法／非法输入及实际执行回归。数据库配置不接受函数、JS、SQL、HTML 或 PPTX XML，管理员上传 JSON 不能获得代码执行权限。
4. 新主题按 `designThemeSchema` 创建新版本并记录审批状态，不覆盖旧定义。切换 current_version 不影响已生成页面；用户通过显式另存新主题版本升级。
5. Renderer 只处理受约束场景与已获权媒体字节；当前只公开 PPTX 能力，其他文件格式未宣称可用。

## 8. 六阶段接入点

| 阶段 | 接入契约／完成范围 |
| --- | --- |
| 01 基础架构（本 PR） | 本文数据／权限／协议、代码注册表、临时主题、合成图文闭环及真实导出 |
| 02 原件与企业素材 | SourceDocument / SourcePage / MediaAsset / SourceReference；复用 parser、受控存储与哈希，增加可恢复解析任务、素材审核发布及来源级使用许可，不把原始 PPT 当模板 |
| 03 模板与主题中心 | BusinessTemplate / LayoutDefinition / DesignTheme 版本表、配置注册及受审查适配器；增加管理 UI、官方母版和更多布局 |
| 04 业务内容生成 | SlideContent + 现有数据授权适配器；在各数据域原权限内构建表格、图表、地图、案例等，不把未知填零或扩权 |
| 05 多页编辑与素材导出 | PitchProject / PitchSlide / SlideScene / GenerationJob / ExportArtifact；扩展分页、编辑冲突、可恢复 worker、独立图片／图表等，复用来源与版本快照 |
| 06 AI 提案编排 | 现有 modelRuntime / modelProvider 成本及路由 + 显式外部 AI 权限 + 结构化协议；AI 只提出经过校验的内容／模板命令，不执行任意代码或外发未获权原文 |

## 9. 验证与部署边界

持续回归包含 `src/lib/pitch/__tests__`、首页独立开关行为、现有研究 Office 导出、`supabase/tests/pitch-studio/run.mjs`（真实 PostgreSQL 17 + 真实应用工作流／PPTX）及 `scripts/verification/verify-pitch-studio-http.mjs`（实际本地 GoTrue / PostgREST / Storage / 生产构建 Next HTTP）。两条数据库／HTTP 回归已接入 Verify，失败阻断。

本 PR 不合并 main、不执行生产迁移、不授予生产账号权限、不开启生产试点。上线需另行授权：应用本迁移、部署对应版本、按真实业务组织／区域发放最小授权，再独立开启服务端与数据库开关；首页入口随构建开关生成。回退先关闭数据库开关和服务端开关；不要删掉已归档的资产／项目／版本记录来回退应用。
