# Colliers Pitch Studio 公共架构与协议

阶段 01–04，公共协议 `colliers-pitch/1`；新布局引擎 `pitch-layout/2`，场景渲染标记 `pitch-scene/2`。阶段 02 依赖阶段 01 PR #309 的已验证提交 `fef812d3`，不从缺失基础表、权限与注册表的旧 main 重建。渲染细则见 [渲染引擎](render-engine.md)。阶段 03 基于阶段 02 已验证提交 `ab6b9b15`，企业素材库协议、真实任务执行、权限边界与限制见 [素材库](material-library.md)。

已提供真实的「测试素材归档 → 结构化内容与独立布局 → 私人单页／多页项目 → 共享场景预览 → PPTX／PNG／SVG／Excel → 私有归档与项目重开」闭环。原件、业务内容、视觉布局、主题及用户作品分别管理。产品以可编辑单页／多页 PPT 为核心，独立素材导出为兼容方向，AI 完整提案为后续方向。

阶段 04 在阶段 03 提交 `89712682` 上增加版本化业务档案、15 个业务配置、统一可信数据适配与持久生成快照；完整能力及明确限制见 [业务模板](business-templates.md)。所有生产模式仍输出相同 SlideContent，不改变既有研究报告契约。

## 1. 模块职责与依赖

| 模块 | 职责与边界 |
| --- | --- |
| `src/app/intelligence/pitch` / `src/components/pitch` | 五板块工作台、会话隔离、可恢复创建、项目重开、导出历史、分类管理；手机使用同一操作与持久化接口 |
| `src/app/api/intelligence/pitch` | Node 路由；调用经过认证、校验、审计的领域 HTTP 入口 |
| `src/lib/pitch/contracts` | 版本化领域 DTO、Zod Schema、命令及内容／场景协议；拒绝未知字段和不支持的版本 |
| `src/lib/pitch/templates` | 数据库配置 + 审查后的代码适配器；内容构建与布局计算分开 |
| `src/lib/pitch/design` | 独立主题协议；业务模板不包含品牌配色、字体或字号 |
| `src/lib/pitch/layout` | 12 类视觉布局、可组合组件、字体度量、分页和质量检查；只处理结构化内容与主题 |
| `src/lib/pitch/render` | 同一场景 → 原生可编辑 PPTX、矢量 SVG／PNG、可见数据 Excel；不接收 URL、脚本或 XML |
| `src/lib/pitch/business` | 业务档案、受控业务配置、可信数据适配、固定快照、混合组合及新鲜权限依赖 |
| `src/lib/pitch/library` | 安全结构解析、候选提取、任务分批执行、来源缩略图与历史标准化；复用共享布局与渲染 |
| `src/lib/pitch/data` | 新鲜权限 RPC、对象存储、哈希、模板与主题快照、任务与文件生命周期 |
| `private.pitch_studio_access` | 唯一领域写入者，原子保存业务记录和审计事件；所有读写都重核有效角色、会话、试点资格及范围 |

复用 `SessionProvider`、共享 Supabase 客户端、`verifyQueryIdentity`、现有原件哈希方法、私有 Supabase Storage 机制和品牌 Logo。将现有研究报告的 PptxGenJS 初始化提取为 `officePresentation.ts`，研究导出与 Pitch 共用底层引擎；两者继续拥有独立内容与存储模型。未修改客户方案草稿、楼书知识库或研究结果的业务协议。

没有为了目录完整创建空的 AI／任务模块。已有 `verifiedDataTool`、`modelProvider`、`modelRuntime` 的数据授权、模型路由和成本控制由阶段 04 复用可信查询，阶段 06 再接入完整模型能力，不能把管理员专用 AI 查询资格误当作 Pitch 员工资格。

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
| GenerationJob | `pitch_jobs`：项目 FK、任务类型、状态、失败码、创建／修改人、时间；新导出异步领取、持久进度、截止时间与失败码；旧单页接口兼容 |
| ExportArtifact | `pitch_exports`：项目／任务 FK、受众、格式、私有路径、哈希、大小、页面版本清单、状态及创建时间 |

`pitch_asset_categories` 的稳定 `system_code` 与显示名称分离，管理员可增设、改名、启停分类，不能重命名系统标识；`general` 是初始能力标识，不能停用。北京、公司介绍、团队介绍、案例等均未固化为数据库枚举。语言使用可扩展语言标记，名称采用语言键映射。

权限、状态、所有权、版本、日期、哈希与关键关联都有关系字段／约束／索引。JSONB 仅承载通过 Zod 校验的内容、场景及视觉／模板配置。数据库额外约束 JSON 类型、协议标识、外键、唯一性及状态；写 RPC 只授予服务端，浏览器不能绕过 Zod 直接写入内容。源页尚无用户编辑接口；新增解析必须创建可追溯的新记录，不能修改历史原件。

## 3. 内容、场景与主题

`SlideContent` 表达业务含义：标题／副标题、结构化段落、指标、带来源的图片、表格、图表、地图引用、时间线、团队、案例、分析观点与限制、来源、数据时间和披露级别。未知数字保留 `null`，不能填成零；所有块引用已有证据，表格／图表校验形状，合成来源必须标为测试数据。

`SlideScene` 表达完成布局计算的有界文字、媒体 ID／版本、表格、图表、形状、线条、地图与品牌资源。新引擎先测量内容并分页，再生成同一场景供所有渲染器使用；不在网页和 PPTX 分别计算业务布局。v1 图文适配器及历史场景继续兼容；新场景通过可选 `rendererVersion` 区分。明确拒绝不匹配的内容、缺字、长标题、过密标签及超大单元格，禁止缩字塞满或静默丢弃。

`DesignTheme` 提供 16:9 尺寸、品牌及辅助色、柔和背景、Logo 资源引用、中英文字体、标题／正文两档字号、边距、网格、图表配色、表格样式、页脚与页码。`colliers-default-v1` 明确是临时主题，未经品牌部门确认。主题定义不等于正式 PPT 母版。

历史项目固定主题、内容、模板和布局版本。主动升级通过 `project_theme_upgrade` 另存关联的新项目版本：原项目、旧主题、原始页面及导出文件保持不变；新页面沿用原资产／来源／内容，只重算布局并递增页面版本。暂不提供覆盖原历史版本的编辑。

## 4. API 契约

统一入口 `/api/intelligence/pitch`，请求要求真实 Bearer 会话，响应 `private, no-store`。POST 要求同源（或无 Origin 的已认证 API 客户端）、JSON，实际读取上限 24 KiB；未知字段、非法参数和超限内容拒绝。

| 方法／action | 输入／结果 |
| --- | --- |
| GET `catalog` | 当前有效试点范围与独立能力、分类、已发布模板和主题 |
| GET `list_assets` / `list_projects` | 可选 `before` UUID 游标；返回 `items`（最多 50）与 `next`，工作台支持继续加载 |
| GET `get_project` | `projectId`；返回私人项目、固定版本页面／来源和最近 50 条导出索引 |
| GET `download` | `projectId, exportId, audience`；权限和哈希校验后的归档文件，不返回公开或签名 URL |
| GET `export_status` | `projectId, exportId`；持久状态、0–100 进度、文件名、失败码；超时任务转失败 |
| POST `preview` | `projectId, page`，可选布局／变体／主题；对实际获权内容生成 SVG 与场景，报告分页数量 |
| POST `project_compose` | `projectId, title, parts, themeId, themeVersion`；最多 12 组资产／布局，服务端生成最多 50 页并原子保存 |
| POST `export_start` | `projectId, exportId, audience, format, page?`；202 后后台领取；PNG／SVG 必须指定单页 |
| POST `sample_create` | `requestId, scope, fixture?, language?`；归档合成原件／媒体／内容资产，返回 `assetId`；相同账号与 requestId 可安全重试 |
| POST `asset_save` | `assetId, expectedVersion, asset`；维护人员在获权范围内新增／更新企业内容，保存新不可变版本；企业发布要求关联媒体和原件也已在相同作用域发布；不能接管他人私人草稿 |
| POST `project_create` | `projectId, assetId, title, templateId, templateVersion, themeId, themeVersion, parameters`；返回保存后的项目 ID，重复 ID 只重放相同内容 |
| POST `project_theme_upgrade` | `sourceProjectId, projectId, expectedVersion, themeId, themeVersion`；另存新主题版本并保留父项目 |
| POST `export` | `projectId, audience: internal/client`；旧单页 v1 兼容接口；多页及 v2 场景要求使用 `export_start` |
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

私有 bucket `pitch-studio-private` 复用受控 Supabase Storage，不增加浏览器 Storage 策略。路径由服务端分配：`sources/{owner}/{document}/original.json`、`media/{owner}/{media}/{version}.png`、`exports/{owner}/{project}/{export}.{pptx|png|svg|xlsx}`。数据库只存索引／元数据，不存二进制或依赖 Vercel 临时文件。

上传 immutable、禁止 upsert；重试只能复用哈希一致的既有对象。读取检查大小与 SHA-256。新导出先写 queued job + pending artifact，HTTP 202 后通过 Next `after` 领取带令牌的任务，写入持久进度，再生成、复核权限、归档、原子完成任务和审计；下载在读取对象前后都重核权限。不发会在撤权后继续有效的签名 URL。

每次领域变更及文件交付准备都原子追加 `private.pitch_events`，记录真实账号、会话、动作、目标与必要前后结果。审计失败回滚业务事务。跨数据库与对象存储不能做单一事务：上传后最终保存失败可能留下孤立私有对象；进程退出／撤权可能留下显式 running/pending 任务；120 秒期限后查询状态会转为失败，用户以新 exportId 重试。当前任务不是无限时长的外部队列：最多 50 页、16 MiB、后台 I/O 信号 45 秒，路由 maxDuration 60 秒。超出范围明确拒绝；后续持久 worker 和孤立对象对账仍是扩展点，不能宣称会自动恢复任意大任务。

## 7. 模板与主题扩展

1. 普通模板新增配置版本，使用 `templateConfigSchema` 校验，并通过经过审查的迁移登记模板根记录及 immutable 版本／哈希。可复用现有 `text-image/1` 适配器，无须新增执行代码。
2. 配置必须声明 ID／版本、中英名称、分类、资产类型、业务场景、输入参数约束、数据源、权限、布局、导出能力、AI 要求和缺失处理。旧适配器参数为 strict `{language: zh|en}`，新适配器为 strict `{language, layoutId, variant}`；不接受未知字段。
3. 新业务计算或新内容类型才增加审查过的代码适配器和对应参数 Schema；必须有合法／非法输入及实际执行回归。数据库配置不接受函数、JS、SQL、HTML 或 PPTX XML，管理员上传 JSON 不能获得代码执行权限。
4. 新主题按 `designThemeSchema` 创建新版本并记录审批状态，不覆盖旧定义。切换 current_version 不影响已生成页面；用户通过显式另存新主题版本升级。
5. Renderer 只处理受约束场景与已获权媒体字节。PPTX、SVG、PNG 共用场景；Excel 只导出选中场景可见的表格／图表／地图数据，不接收原始资产的额外字段。

## 8. 当前阶段与后续接入

| 阶段／范围 | 实际状态 |
| --- | --- |
| 01 基础架构与统一协议 | PR #309：领域表、RLS、内容协议、注册表、图文闭环与原始来源追溯 |
| 02 PPT Design System 与渲染引擎 | 本次独立 PR：12 布局、两套可替换临时主题、共享场景预览、原生 PPTX、图片及可见数据导出、异步任务与实际回归 |
| 后续原件解析与素材管理 | 复用 SourceDocument / SourcePage / MediaAsset / SourceReference，增加可恢复解析、审核发布，不把原始 PPT 当模板 |
| 后续业务数据与 AI 编排 | 复用各数据域权限及 modelRuntime 成本控制；只生成经过校验的内容命令，不执行任意代码或外发未获权原文 |
| 后续编辑与长任务 | 沿用项目／页面版本和冲突保护，扩展持久外部 worker、对账及复杂地图适配器 |

后续阶段名称与范围由用户的新目标确定；上述扩展入口不代表已经实施或上线。

## 9. 验证与部署边界

持续回归包含 `src/lib/pitch/__tests__`、首页独立开关行为、现有研究 Office 导出、`supabase/tests/pitch-studio/render.mjs`（12 布局、原生 OOXML、分页、导出与错误反馈）、`supabase/tests/pitch-studio/run.mjs`（真实 PostgreSQL 17 + 真实应用工作流／PPTX）及 `scripts/verification/verify-pitch-studio-http.mjs`（实际本地 GoTrue / PostgREST / Storage / 生产构建 Next HTTP）。渲染、数据库及 HTTP 回归均已接入 Verify，失败阻断。

本 PR 不合并 main、不执行生产迁移、不授予生产账号权限、不开启生产试点。上线需另行授权：应用本迁移、部署对应版本、按真实业务组织／区域发放最小授权，再独立开启服务端与数据库开关；首页入口随构建开关生成。回退先关闭数据库开关和服务端开关；不要删掉已归档的资产／项目／版本记录来回退应用。
