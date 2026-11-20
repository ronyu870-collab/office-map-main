# Colliers AI 5.0 阶段 03 — 有界 Agent 编排、可信工作集和结构化工具协议

日期：2026-11-20。开发分支：`codex/ai5-p0-agent-orchestration`。

## 范围、权威和版本前提

- 复用现有 DeepSeek 原生 Tool Calling、SSE POST、审计链、身份核验、查询预算、`ai_query_snapshot_read` 和单次可信快照的确定性 `QueryPlan` 执行。
- 本阶段仅更改 Next.js/TypeScript 应用。无 Supabase SQL 迁移、不写生产数据库、不扩大现有业务字段、子市场、楼宇或角色的查询权限，不读取敏感租赁成交明细，不实现 PDF/Excel。
- 阶段 01 的季度正式/待核验数据来源合约已进入 `main`。阶段 02 的权限清单与 CBD 排序修复原 PR #232 在本阶段建立基线时尚未合并；本 PR 不声称已包含该 PR 的变更。后续须按最新 main 对 #232 做显式集成和独立回归。

## 1. 新的模型工具契约

DeepSeek 仅能提出注册的函数名和 JSON 参数；**无 SQL、表名、任意代码或调用者角色输入**。入口 `toolRegistry.ts` 使用严格 Zod schema 重新验证所有模型参数，不依赖模型遵守描述。

| Tool Calling 名称 | 必需结构化参数 | 受控执行 |
| --- | --- | --- |
| `search_buildings` | `scope`；可选 `nameContains` | `list`，可对获权结果执行名称包含匹配 |
| `get_building_profile` | `buildingIds`；可选 `fields`、`period` | 指定楼宇 `list` |
| `query_quarterly_metrics` | `scope`、`period`、`metric` | `aggregate`，可选多个已注册指标 |
| `rank_buildings` | `scope`、`field`、`direction`、`limit`；可选 `period`、`filter` | `rank`，末位并列及有效记录继续遵守原引擎 |
| `compare_market_segments` | `submarkets`、`period`、`metric` | `group_aggregate`，当前目录的子市场组口径 |
| `analyze_market_trends` | `scope`、`start`、`end`、`metric` | `trend` 或 `group_trend`，可指定样本模式 |
| `summarize_result` | `resultId` | 全表总行数、全表列有效/缺失统计及可信摘要 |
| `read_result_page` | `resultId`；可选分页、指定现有列排序/过滤 | 服务器端全表分页，不仅前几行 |
| `check_data_coverage` | `resultId` | 按全部结果行统计 valid/missing/invalid/conflict/unverified |
| `compare_result_sets` | `resultIds`（2–8 项） | 多结果并列的确定性证据对照，不重算市场均值 |
| `get_source_evidence`、`prepare_chart`、`prepare_map_selection`、`prepare_research_output` | 可选 `resultId`，默认最后一个结果 | 仍走原来源/图表/地图/摘要程序；早期结果不会覆盖最终结果 |

`scope` 只支持 `inventory: tracked|all_authorized`、已注册子市场和经查找取得的楼宇 UUID。期间为 `{year,quarter}`。分值、单位、未知和原始值不能由模型直接提交。

**迁移**：`query_verified_real_estate({question})` 保留供“最新有数据季度”、复杂消歧和历史会话；旧版专业工具已发送的 `{question}` 在服务端暂时受严格限制地兼容，新的模型工具规格不再向它们宣传 `question`。后续阶段须在调用统计确认旧用法为零后删除兼容入口，不能提前移除旧会话能力。

## 2. 执行阶段与有限恢复

`runAgentLoop` 跟踪 `understanding → tool_selection → executing → verification → synthesis → completed`；每步经过工具名白名单、严格参数校验、服务端身份与权限版本再检查、模型/工具预算及执行日志。执行阶段通过新的 SSE `phase_changed` 和原有 `tool_started/tool_completed` 传播；最终响应包含 `agent.phases`、`executionStatus`、`unresolvedFailures` 和工作集清单。所有执行状态并入最终加密审计事件，避免逐阶段写入过多事件导致原会话 16 事件读取窗口溢出。

硬限制：最多 9 次模型轮次、12 次工具调用、全程 60000 token、每工具 12000 字符预览；对同一工具重复失败最多容许 2 次受控修正，第三次终止；不可将上限耗尽视为任务完成。无权限/修订版本改变绝不重试或静默扩权，立即拒绝。可恢复的错误明确返回受限错误码及建议；未完成结果会被标为 `partial` 或 `limited`，并在回答正文添加执行限制说明。模型只能读取工具真实返回的数据，不能自行伪造来源或图表。

## 3. 多结果工作集与服务端全量操作

`AuthorizedResultWorkset` 仅存在于**单次已认证 HTTP 请求的内存中**，不存在进程级或跨会话缓存。每个完整 `QueryResult` 绑定 `requestId`、`actorId`、`effectiveUserId`、`sessionId`、`policyVersion`、`permissionRevision`，结果本身保留 `resultId`、`snapshotId`、`dataVersion`、`scopeFingerprint` 与来源。每次读取先由 HTTP 处理器重新取授权，再核对工作集归属。结果数量限 8、合计 50000 行、单页最多 100 行，超限明确失败，不静默驱逐前序结果。页面返回 `totalMatched`、`hasMore`、`nextOffset`，确保模型不会把前 6/8 行误当全集。

多结果对照仅使用各 QueryResult 原有正式数值及单位、样本和来源，不随意拼接数值或重新计算加权租金。原地图跳转目前仍仅指向本轮最终归档结果，禁止把早期结果伪装为最后归档结果。结果工作集未跨请求持久化；响应中仅包含清单，跨轮追问从加密、本人、同会话及同权限版本的历史计划继承条件，必须重新执行授权查询，不能恢复旧结果ID读取。

## 4. SSE、审计、权限与交付边界

保留原 POST + 终态签名凭据 SSE 协议。模型流式草稿可能在末尾变为工具调用，因此本阶段在确认该轮没有工具请求之后才向客户端发送文本增量，避免中间的未经验证文本被误展示为正式结论。最终签名回复和来源恢复沿用原 `prepareDelivery`、`response_generated`、`succeeded` 与 `recoverOwnResult` 路径；源数据权限修订变化后既不返回旧工作集页也不交付最终结果。加密审计收纳有限的工具轨迹、状态和工作集清单，历史回复仍按既有权限与原始来源校验。

当前 HTTP 终端响应只归档并提供一个完整 QueryResult（本轮最后一个正式结果），多个前序结果仅在请求存活时可用于工具编排、比较与摘要；**不代表已实现跨请求持久化多个完整结果或多文件交付**。早期单次展示型工具可指定前序 resultId，但后续打开地图仅能使用最终归档结果。

## 5. 验收与发布

必需回归覆盖结构化参数拒绝、正常问候、多步工具、独立结果 ID 与大于摘要行数的分页、全表覆盖、纠正条件、权限撤销、异常原因、有限重试、签名 SSE、加密审计、历史上下文与无虚构成功。测试源数据仅合成 A–D 楼宇，不含生产业务原件。实际 CI/PG/Auth/HTTP 执行结果须以提交对应版本检查记录为准，本说明不预先宣称通过。

本轮按用户明确授权豁免**人工浏览器、截图、独立人工视觉审查**（未执行），不能扩大为豁免静态检查、类型检查、构建、权限/审计、实际 Auth/HTTP、SQL 或 GitHub 精确 PR HEAD 的 Verify；未通过时不得合并。生产 DeepSeek 响应、真实账号与权限、Vercel Preview 和最终发布分别报告，不以测试模拟或创建 PR 冒充生产可用。
