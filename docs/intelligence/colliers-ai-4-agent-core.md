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

## 2026-11-19 P3 预算、成本与运行可观测性补强

- 新增 `agentCost.ts`，以官方 2026-11-19 定价生成保守美元成本计划区间；因没有精确输入缓存拆分和供应商计费事件，保留 `cost:null`，区间仅作为运营预算参考，不作为账单。
- `AGENT_LIMITS.maxTotalTokens=60000` 超额阻止下一工具/下一模型轮调用，保留调用轮次/次数/超时预算。已返回但 usage 超限的模型轮次只能计入失败而非合法完成。
- 单次 Agent 执行的 `durationMs` 与规划区间写入既有加密 accounting 事件，普通日志不写用户输入或密钥。
- 无数据库变更。未涉及真实流式、长期历史、第三方联网搜索与生产管理员会话验收。

## 2026-11-19 — P2 独立 SSE 工作批次

- 官方 DeepSeek SSE：modelStream.ts 处理 data:、[DONE]、分片文本与 tool_calls[index] 参数，含 stream_options.include_usage 的 choices: [] 计费尾帧；仅完整响应进入原 Agent Orchestrator 的正式模型结果。
- /api/intelligence/query/agent/stream 只接受已获权的 POST，并经原有 Agent 身份/预算/工具/来源与审计处理；工具状态来自真实 tool_started/tool_finished。模型增量逐段重核当前权限，撤权后禁止继续发送敏感结果。取消不会另开执行任务；幂等键仍绑定当前请求。
- 浏览器使用同一个受控 SSE Schema 和签名交付凭据，正文的部分文本在完成前不进入正式答复、不触发历史或授权导出。对失败/网络中断保持不确定状态，不将部分文本当作正式结果。
- 服务端 AI_AGENT_STREAM_ENABLED=false 可以回退原非流式 DeepSeek 接口；依现有 admin-only 能力返回标志，预览缺密钥时不自动暴露流式。
- 不新增 RLS、SQL、成交数据入口或对外公开搜索。单元测试使用合成协议字节，仅覆盖解码、序列、前端状态；真实供应商 API 的成功调用与端到端 HTTP 安全验收需另行提供证据。

## 2026-11-19 P1：结果证据与成果工具扩展

- get_source_evidence：模型可查本轮最近获权 QueryResult 的来源表、字段、期间、source ID、核验状态和是否有归档原件（不返回原件或原文）。
- prepare_chart：从该正式结果调用原 buildResultChart，对比／趋势／分布的统计、单位及来源完全按原正式引擎；仅返回最多 14 个值作模型说明，完整图表通过既有当前结果 UI/原正式导出路径查看。没有适配图表时明确 unsupported。
- prepare_map_selection：从当前正式结果的明细行和确实关联的 buildings.name 来源交叉识别已获权 UUID，生成仅含本轮 requestId 的原地图查询链接，地图重新验权；未关联有效楼宇 UUID 时不造地图标记。
- prepare_research_output：原 renderResultCopy(result,'summary') 构建确定性草稿，保留结果身份、研究主题、期间、单位、来源和限制；限量内容发回模型，不暗示文件已导出。
- 所有工具仅复用前序本轮完成的 QueryResult，不读独立数据库表、不引用模型自造的参数。模型对资料来源中的提示注入不得改变工具白名单。成功工具耗时及审计沿用原结构。
- 仍需用户额外授权的领域：历史租赁客户/合同详情、外部联网搜索供应商、付费额外模型。此版本不扩 AI 数据访问权限。
