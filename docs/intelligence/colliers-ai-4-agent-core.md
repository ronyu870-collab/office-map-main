# Colliers AI 4.0 — DeepSeek 原生 Agent 首批核心交付

## 当前实现范围

基于 2026-11-18 main 版本 01e4dc00932cbb594befd2afbcd5dd5dbea58e30。首页普通提问通过 /api/intelligence/query/agent，旧的地图楼宇选择、历史恢复和原请求重做继续沿用受信任查询接口。原 AI 3.0 工作空间、地图、图表和数据库数值算法保持不变。

前端向已授权的 capabilities 接口取得模型配置可用性标记，生产有 DeepSeek 密钥时默认发送 Agent；未配置供应商的预览环境保持原可信查询接口，避免让预览历史和真实 Auth 测试误调用无模型的 Agent。此标志不是数据授权，服务端在两条路径上仍重新验证资格和权限。

服务端依次进行有界输入接收及加密审计、真实身份与同源校验、现有 admin-only 独立查询资格校验和模型预算 RPC。DeepSeek 通过官方 Chat Completions（DEEPSEEK_CHAT_MODEL 优先，兼容原 DEEPSEEK_MODEL，默认 deepseek-v4-flash）负责理解、自然语言回答与原生 Tool Calling，明确禁用 Thinking 以确保工具调用上下文协议简单一致。

Agent 注册只读的 query_verified_real_estate 工具，可自主连续调用多次。服务端将请求交给既有 semanticExecution、QueryPlan、snapshotReader、executePlan 完成获权楼宇及季度市场数据计算，再仅向 DeepSeek 发送有限、去原始记录的事实摘要；正式结果保留不可变审计、字段来源和独立授权恢复。模型不能自写 SQL、访问未注册函数或修改数据库。

有界 Agent 最多执行六轮、六次工具调用，具有去重、超时、使用量审计、授权刷新和错误分类。继续同一当前会话时，服务端仅从加密、权限和本人会话绑定的历史事件恢复至多四轮摘要，不信任前端提供的历史正文。

## 已验证与未验证

新增回归覆盖：自然对话直接交给模型、连续原生 Tool Calls、模型对工具结果二次总结、禁止未注册 SQL 工具、去重、工具预算、会话加密与撤权、模型 401/402/404/429 错误、无权限 API 主机拒绝、正式结果恢复的原有权限校验。编译、全量测试和 CI 的通过状态以本次提交、PR 实际执行日志为准。

仅证明模型协议兼容和逻辑正确，不等于已有真实 DeepSeek API 成功。生产端供应商联通与真实授权 admin 用户调用须分别核实。配置项存在或 Vercel READY 不表示模型回答成功。

## 本轮有意保留的限制

- 当前尚未实现真正逐字流式响应、运行中逐个工具状态前端展示、跨会话 Agent 对话的完整历史列表与恢复。
- 历史租赁成交与当前填报成交尚未作为 Agent 独立开放工具；普通租金不得写成净有效租金。外部公共检索需单独确保披露与引用安全。
- 当前 Agent 对话的 historySaved=false；现有旧查询的原始历史及导出路径不删除或迁移。Agent 业务查询结果的恢复沿用受信任结果机制。
- 用户本次要求压缩不必要的人工 UI 评审；仓库规定的必要 Verify、精确 PR head 检查及安全回归仍不得伪称通过。


## 2026-11-19 P0/P1 增量：专业工具分流与模型配置核验

- Agent 新增 `search_buildings`、`get_building_profile`、`query_quarterly_metrics`、`compare_market_segments`、`analyze_market_trends` 五个注册工具，并保留 `query_verified_real_estate`。它们是具名只读能力入口，**全部复用**当前 `prepareSemanticExecution → readQuerySnapshots → executeQueryPlan` 的获权事实查询引擎，尚非独立的租赁成交、外部搜索、全文资料检索工具；遇到目前查询引擎尚不支持的条件应返回受限或澄清。
- 模型默认 ID 更新为 DeepSeek 2026-10-17 官方 `deepseek-flash`，保留旧兼容别名 `deepseek-v4-flash` 和 `deepseek-v4-pro` 的已注册环境配置；对退役模型名称直接判为配置问题。生产变量 `DEEPSEEK_MODEL` 需按实际配置核验，不因存在而视为支持。
- 当前继续保留最多六轮/六工具预算；审核序列添加真实调用开始、结束及复用标识，供应商原生响应提供 ID 时加密审计记录。并未新获管理会话或供应商请求成功记录，不得声明完成生产端到端验收。
- 本批不修改数据库／权限，长期流式、完整历史与成交安全封装仍待后续阶段。人工视觉、浏览器及真实手机验证按 2026-11-19 当前用户指令豁免，PR 标注范围，不得将未执行称为通过。

## 2026-11-19 P2 增量：历史索引与有界连续上下文

- 本批将加密存储的 Agent 上下文最多保留八轮，延续原有 credential-redaction／authority-revision／session 校验。高频长期聊天仍缺真正的结构化摘要与 token 计算。
- Agent 成功后会调用已有 `recordHistorySubmission`，成功显示 `historySaved: true`；数据库未应用 `20261115173338_ai_query_own_history.sql` 时会按代码契约明确返回 false，不将成功答复当作已归档。
- 统一历史列表现可识别 `colliers-agent-conversation/1` 首次提问并验证收到的真实计划，但原生 Agent 的回答在历史「打开并继续」路径尚不能按全部来源重新恢复，不能宣称完成跨会话研究历史。
- 不修改原业务数据与 RLS。现有仓库内的历史迁移不代表生产已安装，需要通过隔离真实 PostgreSQL/Auth 验证后方可单独发布。

## 2026-11-19 P2 增量：Agent 历史恢复和续接

- `restoreOwnAgentAnswer` 只从当前账号可读、哈希审计链验证通过的归档解密。无业务数据的模型消息与加密摘要交叉验证；包含业务结果的回复仍通过 `recoverOwnResult` 的来源、模型计划及权限重新检查。
- 统一历史打开接口现在可以重开 Agent 已成功回答，并签发绑定当前用户/会话/权限和短期时间的 resume token；只有验证 token 且重查上轮数据访问权限后才允许 DeepSeek 继承旧上下文。
- 用户变更账号、审计加密不一致、RLS 撤销或来源无权均拒绝历史续接。本批未接入实时流式或取消后断线续传。

### 2026-11-19 历史续接路由补漏

- 之前 `HomeQuery` 凡带 `resumeToken` 均回退旧查询服务，即使历史来自 DeepSeek Agent。现在历史 API 仅在真实已归档的 Agent 请求中返回 `isNativeAgent` 标记；前端将该标记作为路由提示，且服务端依然独立验证身份、签名、会话、权限和来源。
- 已增加真实组件回归：Agent 历史打开后追问走 Agent；旧受控查询历史保持旧路由。历史目录未安装时仍不能宣称已经有可用跨设备恢复。

## 2026-11-19 历史数据库生产发布复核

- 仓库 `20261115173338_ai_query_own_history.sql` 已在生产 Supabase `qhgxougfzzmgqjzzwudf` 应用，Supabase 迁移记录 `20261119070020`／`ai_query_own_history`。此前“生产尚未安装历史迁移”的阶段描述已过时，此段为最新状态。
- 生产应用前事务 dry-run 后回滚，三张表和 RPC 均未遗留；正式应用后核验 private 三表存在且均开启 RLS、public/private RPC 存在。仅 service_role 可执行公开 RPC，anon 和 authenticated 不可执行；authenticated 不可 SELECT 私有会话表。
- 数据库结构和权限已上线，但需要 PR #216 应用发布及真实登录的历史保存/列表/恢复/撤权验证后才能宣称 AI 4.0 业务功能正式可用。现有历史表无初始记录；不会回写已有业务成交或季度租金。
