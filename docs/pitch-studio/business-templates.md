# Pitch Studio 企业资产与动态业务模板

阶段 04 基于阶段 03 已验证提交 `8971268262efe3bb5d61c786f4a3ce3b552e2656`，保留 `colliers-pitch/1`、`pitch-layout/2` 和 `pitch-scene/2`。未部署生产迁移，未开放生产账号试点；前序 PR 未合并时以阶段 03 分支为 PR 基线。

## 生产入口和统一链路

工作台「模板中心」提供正式资产选择、多人／多案例组合、获权楼宇参数、页面组清单、主题选择、生成及业务档案维护。生成后的私人项目使用原有页面预览、缩略图和 PPTX／PNG／SVG／Excel 导出入口。移动端使用相同表单和 API；列表分页、搜索节点保持稳定，不因请求结果刷新而替换输入框。

`BusinessProfile / BusinessRecipe / Pitch Data Adapter → SlideContent → Layout Engine → SlideScene → 现有预览及原生 PPTX Renderer`。业务构建器不包含颜色、字号或独立 HTML 布局。AI-assisted 仅保留严格校验的、引用已确认事实的 insight 输入协议，当前没有可执行生成命令、模型调用或向外部模型发送私有内容的路径。

| 模式 | 输入 | 行为 |
| --- | --- | --- |
| Static | 一份当前已发布资产 + 业务配置版本 | 使用维护者确认的内容；不能自动翻译或编造缺失字段 |
| Semi-dynamic | 按选择顺序的多个已发布资产 | 团队组合、案例组合或其他受控内容组合；自动分页，来源合并去重 |
| Dynamic | 严格类型的参数 + 独立数据权限 | 可信查询、原生表格／图表、口径续页及不可变数据快照 |
| AI-assisted | `pitch-assisted/1` 预留 schema | 需要第六阶段独立授权；本阶段不执行 |

`POST /api/intelligence/pitch/business` 支持 `profile_save / recipe_save / generate / restore`；GET 支持 `catalog / buildings / search / profile / generation / compare`。真实认证、禁止模拟身份、同源写入、24 KiB 请求上限和 no-store 沿用领域边界。模板参数不接收查询文本、代码、SQL、URL、XML、场景或自由计算公式。一次最多 20 组、50 页、8 MiB 提交载荷；超限明确失败。最终文件继续使用既有持久导出任务和私有对象存储，不依赖临时文件持久化。

## 企业档案与目录

先通过素材库上传原件和确认来源，维护业务档案后会建立新草稿；再次确认发布才可生成。上传／解析／保存档案均不等于发布。区域、城市、业务线、语言、标签、原件、有效期、披露许可和测试标记复用既有 ContentAsset 与 SourceDocument，不另造权限或员工身份体系。

- Corporate：全球／中国／区域／城市／业务线；已确认的简洁和详细介绍、服务能力、荣誉资质、带单位的指标和照片。数值 `null` 与真实 `0` 分开。全球／全国回退要求同组织、明确 `fallbackFor` 精确范围，且用户主动允许。
- Team：可选关联既有 `auth.users`，不创建员工账号；独立姓名、职位、团队、经历、业务领域、资质、代表项目、项目角色、照片、案例关联及已确认汇报关系。账号不等于对客档案。多人按每页二／三人分页；详细履历另起续页。汇报对象不在选择集合或存在循环时明确拒绝。
- Case：城市／子市场、物业／服务／客户分类、规模及单位、背景、挑战、策略、过程、成果、团队、图片、发生日期与可选真实 building_id。正式页面使用独立确认的 `display`，精简模板要求独立 `briefDisplay`；维护结构字段后必须同步核对展示版本。不会自行生成面积、评价、成果或业绩合计。
- Research：宏观、城市经济、政策、写字楼、区域、供需、观点、展望及自定义主题；明确已发布／历史／当前有效／预测／自定义分析的性质与原日期。原生图表与经确认 insight 可同页呈现，方法保留续页。动态模板可指定 `researchAssetId` 合并研究观点，保留研究日期、来源和权限依赖，不跨口径混算。
- Custom：`typeCode + SlideContent` 支持扩展服务方案、执行计划等，不局限四类企业档案。

首批 15 个业务配置：`corporate-overview / corporate-metrics / corporate-capabilities / team-single / team-multiple / team-core / team-roles / team-organization / case-detail / case-brief / case-portfolio / case-track-record / case-public-projects / research-page / custom-content`。组织结构首版使用可编辑的成员—汇报对象关系表；业绩汇总使用已确认案例行，不把不同规模口径相加。公开客户／项目模板仅接受批准名称披露的案例。

管理员在模板维护中新增代码、分类、名称、描述、`accepts`、受控 `strategy`、已注册 `layoutId` 和容量。配置按 revision 乐观锁保存历史；普通新增方案可复用 `content` 策略和任意已有通用布局。新数据计算或策略需要代码审查，不能通过管理员 JSON 注入代码。停用配置不删旧页面；新生成会校验当前配置及版本。

## 动态数据契约与真实能力

`src/lib/pitch/business/adapter.ts` 是唯一查询适配入口。模板不直接查业务表。季度路径复用 `serverAuthority → readQuerySnapshots → executeQueryPlan` 和现有 `aggregateQuarter` 精确计算；成交复用 `loadLeaseSnapshot / authorizeLeasePlan / buildLeaseResult`。不复制楼宇、季度或成交数据库，不改变内部研究报告协议。

| 模板 | 当前状态、来源和口径 |
| --- | --- |
| 项目概况 | 一个明确楼宇，目录名称和获权楼书／季度参数；位置／照片不猜测，照片可组合正式素材。首版未接项目位置及图片适配器 |
| 横向参数对比 | 明确项目集合，同一正式季度，自选获权高度、楼层、车位、总面积、空置面积、净有效租金 |
| 租金对比 | 同期净有效租金，支持排序、目标标记、同一样本的面积加权参考统计；不冒充报价租金 |
| 空置率对比 | 同一期有效空置面积／总面积；直接复用现有精确公式，缺失、无效与零分开；图表显示百分比 |
| 租金／空置率历史趋势 | 获权子市场／项目范围，正式连续季度、per_period 样本；保留样本覆盖及变化说明；原生折线／柱／条图或表 |
| 项目与子市场表现 | 一个目标项目及一个子市场，同季度同算法分别展示结果和方法；首版使用对应结果页，不跨口径拼算差值 |
| 代表性租赁成交 | 独立成交授权；日期、区域、项目、来源筛选；按实际面积排序，不声称主观代表性。仅投影楼宇、行业、期间精度与面积 |
| 成交行业分布 | 复用既有成交去重／行业分组，选择笔数或面积；缺失行业、有效面积样本与期间精度保留；原生表或统计图 |
| 成交面积区间分布 | **暂不可用**：现有可信查询未提供受控区间分组；无伪造统计 |
| 竞争项目地图 | **暂不可用**：缺少 Pitch 地图导出素材许可及坐标披露适配器 |
| Stacking Plan | **暂不可用**：保留既有功能及权限范围，未开放新的 Pitch 导出路径 |

输入由 `dynamicParametersSchema` 固定：项目最多 20 个、子市场最多 30 个、明确季度／连续趋势区间、六项白名单指标、排序、四种支持图表及成交条件。城市不是新增自由 SQL 过滤器：当前空间范围由获权项目与现有子市场控制。数据期末用季度末或成交查询截止日，生成时间单独记录；未提供可靠 GDP、政策或全国市场数据接口，这些通过确认的研究资产承载。

每次保存参数、可信计划、结果表、口径／缺失原因／来源、数据版本、权限版本及捕获时间。单位来自可信查询字典；不把未来供应当当前存量，不混租金种类，不把百分点当比例。无样本、容量或不支持字段明确失败；重要方法和排除样本保留为原生文字续页。连续趋势是逐季度统计，首版没有月／年重采样。

动态权限沿用当前**管理员专用可信查询**，还须明确 `export:internal`；成交再要求独立有效的成交读取／导出授权。Pitch 资格不会赋予数据资格。所有动态页面当前**仅内部导出**，管理员身份也不能绕过客户端导出限制。普通业务用户可使用授权正式资产；扩大动态数据人群或对客披露需后续明确治理配置。

## 版本、披露与撤权

新增三张 RLS 表：`pitch_business_profiles` 绑定资产版本，`pitch_business_templates` 保存业务配置历史，`pitch_business_generations` 保存参数、依赖与数据快照；既有资产增加 `generated_project_id`。浏览器无直接写权限；动态快照的原始表 GET 始终关闭（PostgREST 只读事务不执行可信授权所需行锁），只经受控服务端 POST RPC 验证当前授权后返回。唯一领域 RPC 原子保存及审计，默认试点仍关闭，迁移不填企业事实或给生产账号授权。

普通用户不读取含内部客户信息的原始 profile。匿名案例必须有维护者确认的完整展示内容，校验受限名称和 Unicode 规范化，剔除来源文件名、可泄露名称的 locator／version／recordId，保留 documentId、pageId 与原件哈希追溯。首版匿名案例不支持嵌入图片：像素内容无法通过名称过滤可靠去标识；允许单独维护正式可公开媒体资产。案例汇总字段也检查受限客户名。转匿名后旧实名版本仅维护者可读，不能再次生成或导出。备注、隐藏对象、自定义 XML 和工作簿不承载原始 profile；工作簿仅包含场景可见的统计数据。

快照在数据库更新后保持不变。刷新按原参数重新查询、生成新项目并建立 parent，**不会自动把所选历史季度改为最新季度**；需要新期间时在模板参数主动选择。比较返回前后实际数据表及 changed，读取 ID／捕获时间变化不算业务变化。历史恢复精确复制已有页面，不重新查数。原件、资产发布／可见／有效状态、动态授权指纹和会话在新生成、预览、RLS读取、文件领取及下载时重新核验；撤回发布／撤权后旧文件也拒绝。派生资产经旧接口重用、合并或复制不能绕过依赖；主题复制保留依赖。

## 验证与复现

全程仅使用明确隔离的合成企业、员工、客户及季度数据，不向正式素材库填测试事实，不调用外部模型。

```sh
# 无数据库：同一业务资产和配置生成两套实际可编辑 PPTX、场景 PNG 与清单
node scripts/verification/generate-pitch-business-fixtures.mjs

# 专用本机 PostgreSQL 17，口令 synthetic_ci_only，自动创建并销毁独立测试库
PITCH_TEST_ALLOW_LOCAL=disposable PITCH_TEST_PG_PORT=55437 node supabase/tests/pitch-studio/business.mjs
PITCH_TEST_ALLOW_LOCAL=disposable PITCH_TEST_PG_PORT=55437 node supabase/tests/pitch-studio/library.mjs
PITCH_TEST_ALLOW_LOCAL=disposable PITCH_TEST_PG_PORT=55437 node supabase/tests/pitch-studio/run.mjs

# 实际 GoTrue/PostgREST/Storage + 生产 Next；只接受 127.0.0.1 的专用隔离栈
# PITCH_AUTH_STATUS 指向 supabase status -o json 生成的 0600 本地凭据文件，不输出密钥
PITCH_TEST_ALLOW_LOCAL=disposable PITCH_AUTH_STATUS=/private/tmp/pitch-auth-status.json node scripts/verification/verify-pitch-studio-http.mjs
npm run verify
```

PG 回归使用真实生产权限／正式季度 SQL 和真实业务构建、解析与 PPTX 渲染。HTTP 回归经实际登录、上传、确认、原子生成、持久导出和撤权路径。CI 接入现有 PG17 与 Auth job。离线文件生成不是权限验收替代。输出目录默认 `tmp/pitch-business-offline` 和 `tmp/pitch-business-fixtures`，前者不需要任何环境密钥；SQL fixtures 明确合成，原生文件检查会扫描所有 XML 的匿名信息残留并验证统计图表节点。

首版上限和上述不可用能力是明确产品反馈；没有完美复杂历史 PPT 转换、外部 OCR／AI、地图许可或新增 Stacking 权限的隐含承诺。业务档案扩展、内容发布与渲染协议彼此独立，后续可在同一闭环内增加受控能力。

### 本地交付验证（2026-11-26）

- PostgreSQL 17：业务档案／全部开放适配器 13 组、基础／渲染权限 27 组、素材库兼容 18 组通过。使用实际迁移和规范身份上下文，无生产数据。
- 实际 GoTrue、PostgREST、私有 Storage 与生产 Next HTTP：18 个场景通过，含多种素材发布后混合生成、原生图表和撤权后的预览／下载／原始 RLS 拒绝。搜索 SQL 表达式及只读事务行锁问题均在实际回归中发现、复现并修正，不以 Mock 代替。
- 两主题各 27 页原生 PPTX 由相同业务输入生成，逐页文字一致；实际文件经 Office 兼容引擎打开、渲染检查中文、团队分页及原生图表。须配置仓库 Noto Sans SC 字体，缺字库的环境不能用于判断中文排版。
- 类型、改动 Lint（0 警告）、全项目 413 个文件／3,152 项测试、生产构建、数据字典生成一致性及焦点覆盖检查通过；全仓 Lint 沿用基线 975 条警告，0 错误。前序 PR #311 的远端工程浏览器回归失败，不能写成前序 CI 全绿；本阶段独立 PR 的最新 CI 状态另列，不推断生产已发布。
