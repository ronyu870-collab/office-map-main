# Pitch Studio 3.0 AI Proposal Director

基线为 PR #323 后的共同提交 `820a793a`。现有单页配置、素材搜索、固定提纲和已授权文字修订继续走原入口。

## 服务端入口

在现有 `POST /api/intelligence/pitch/ai` 中使用以下动作。

| 动作 | 入参 | 返回 |
| --- | --- | --- |
| `proposal_plan` | `input` 包含 `question`，可附当前 `projectId`、明确选择的 `buildingIds`、期间、语言及 `analysisResultId` | 已审阅范围的 Brief、按顺序排列的 ProposalPlan、逐页证据引用与缺项，或明确的待确认状态 |
| `proposal_generate` | `confirmation` 包含实际项目版本、`taskId`、`planId`、`contextFingerprint` 及原请求 `request` | 现有业务生成链路的私人子项目凭据，须已回读实际页面 |
| `proposal_revision` | `input` 包含项目、预期版本、用户原话和明确选择的当前页／页面／对象 | 匹配项目和页面版本的结构化审阅计划，或具体修改意图及可用性 |

标准生成使用现有可信查询模板，在原业务生成提交点核对数据。重复提交同一请求及任务 ID 可读取相同授权下的已生成子项目。原项目仅作为作用域、版本和主题来源。专项工作流可通过 `submitConfirmedProposal` 的 `ProposalGenerationPort` 接管任务领取、取消和恢复。

常见请求零模型调用。复杂请求只在现有 AI 开关、本人权限、项目外部处理资格及运营配置均允许时进入一次无工具结构化调用。发送内容限本次用户问题和有界槽位协议，不发送业务数据、原件、已读楼书、照片或历史案例。供应商选择、预算预留及实际用量继续由 Colliers AI 运行时管理。缓存只保存通过校验的解释槽位，区分操作者、会话、权限与模型配置。每次生成仍重查当前来源和正式季度。

在 Colliers AI 请求目录中注册 `pitch_plan_proposal`。普通模型观察仅含计划标识、场景、页面类别、缺项类别和工作台入口。项目名、业务正文、素材标题和客户名只通过当前身份授权的 Pitch 工作台接口交付。

## 集成接口与验收范围

- `directProposal` 使用共享 `ProposalBrief`、`PitchContextSnapshot` 和 `ProposalPlan`。`ProposalDirectorPorts` 负责目录、期间和业务页面的授权读取。`composeUnifiedProposalPages` 接收统一数据投影和获权素材，调用四套专业 recipe 并保留必要页面及业务依赖。业务与视觉适配器提供真实身份、期间、来源和版本，业务 recipe 提供实际 `SlideContent`。策划器只选有来源的组合，并保留有待确认项。
- `previewProposalRevision` 生成带原页版本的 `DocumentModificationPlan`。文本和可用主题可经 Agent 06 的 `apply_modification` 审阅后执行。正式季度变更先重查数据并返回独立审阅的刷新计划。竞品、照片、重新定位、语言与图表等意图已有结构化枚举，其正式事务需由相应数据、素材及工作流接缝提供。
- 本专项的基础数据适配沿用 #323 信任边界和已有动态模板。完整四套业务 recipe、楼宇别名、对客披露、照片／地图／Stacking Plan 与可恢复事务依赖 Agent 01、02、04、06 的集成。已有可信分析可通过当前本人获权的归档请求 ID 构建计划，正式生成依赖归档交接路径。
- 四个旗舰请求、缺失或同名楼宇、未授权、未完成季度、缺图、季度修订、模型超时／非法响应以及取消均使用本地合成夹具。四个请求均经过 Agent 04 的业务 recipe，代表页由现有渲染器生成 PPTX 并回读原生表格或图表。预提交守卫专项执行既有业务生成路径，核对证据变化时不进入持久化操作。没有真实供应商请求。
