# 统一AI查数、对话与审计开发索引

Pitch Studio 的可选智能辅助复用本模块运行时、工具及费用协议；指定素材版本的独立处理授权、任务运营与限制见 [Pitch AI](../pitch-studio/ai-intelligence.md)。既有知识正文出站保护与 admin 本人限制保持不变。


运行时继续受默认关闭的配置开关、当前角色与独立资格共同约束；实际生产状态以对应发布记录为准。P0 对话与结果展示已随 PR #199 合并；本次 P1 的实现、验证及发布状态见下方专门记录。现有管理员业务智能、方案及 F6 路线继续保留。

当前用户决定：**所有AI功能仅供admin本人使用**，仍需对应独立查询/数据/导出/审计资格。普通角色或模拟身份不可使用，旧公开预览开关不能扩大范围。以前工作包允许持资格viewer/editor的证据仅是历史行为，已被本包替代。见[admin专用限制与验证](admin-only-access.md)。

| 责任 | 当前入口 |
| --- | --- |
| Colliers AI 可靠性评测、预算台账、确定性修复与独立验收 | [评测入口与分层证据](evaluation/README.md) |
| Colliers AI 6.0 执行路径、统一预算与结果恢复 | [执行效率重构与验证](ai6-efficient-runtime.md) |
| Colliers AI 6.0 结构化回答、交互表格、附件与工作空间 | [实施与验证边界](ai6-workspace.md) |
| Colliers AI 5.0 阶段 12 实际能力矩阵、成果完成判定、分页预算与最终回归 | [最终工程收口](ai5-final-hardening.md) |
| Colliers AI 5.0 阶段 11 官方 Responses／DeepSeek 统一协议、有界恢复与成本治理 | [模型运行与运营治理](ai5-model-operations.md) |
| Colliers AI 5.0 阶段 10 受控多步骤研究、可恢复工作集及 Word/PPT/PDF/Excel 共享成果 | [专题研究与综合成果](ai5-deep-research.md) |
| Colliers AI 5.0 阶段 06 中文内部 PDF、正式结果组合及可信交付 | [PDF 研究报告](ai5-pdf-reports.md) |
| Colliers AI 5.0 阶段 03 结构化 Agent、授权多结果工作集、分页与执行追踪 | [Agent 5.0 结构化执行协议](ai5-agent-orchestration.md) |
| Colliers AI 5.0 P0 季度正式/待核验来源隔离、去重与质量状态 | [季度来源契约及回归](ai5-quarterly-source-contract.md) |
| AI 38 项体验修复：Markdown、连续历史、复制、侧栏与输入 | [逐项实施与验证](ai-experience-38-fixes.md) |
| Colliers AI 4.0 DeepSeek-Native Agent 核心首批 | [Agent 交付记录](colliers-ai-4-agent-core.md) |
| Colliers AI 3.0 P2 对话、历史与研究结果视觉精修 | [P2 视觉整合记录](colliers-ai-3-p2-visual-polish.md) |
| Colliers AI 3.0 P1 紧凑输入、专注与全屏的单实例空间切换 | [P1 专注工作空间记录](colliers-ai-3-p1-focus-transition.md) |
| Colliers AI 3.0 P0 首页紧凑输入与综合业务工作台 | [P0 紧凑首页记录](colliers-ai-3-p0-compact-home.md) |
| Conversational Experience 2.0 P2 主页视觉与研究阅读层级 | [P2 体验记录](home-query-experience-p2.md) |
| Conversational Experience 2.0 P1 双模式、全屏过渡、历史与研究工作空间 | [P1 体验交付记录](home-query-experience-p1.md) |
| Conversational Experience 2.0 P0 个性欢迎、短对话与输入体验 | [P0 体验记录](home-query-experience-p0.md) |
| P2 楼宇卡片、地图、成果操作、本人历史与恢复体验 | [P2 集成交付记录](home-query-p2.md) |
| P1 继续实施：子市场×等级跨季度、多指标与共同样本 | [双维趋势交付记录](home-query-p1-cross-trends.md) |
| P1 后续多指标、完整条件继承、字段实查及隔离验证缺口 | [P1 后续交付记录](home-query-p1-followup.md) |
| P1 多轮上下文、真实可用期间、受控模型意图、趋势／质量／样本与发布状态 | [P1 交付记录](home-query-p1.md) |
| P0 对话布局、单指标 KPI、自动同源图表与当前页问答回看 | [P0 交付记录](home-query-p0.md) |
| 提问审计页面、同源问答/来源查看与客户端隔离 | [审计页面](audit-console-ui.md) |
| 主页受控问题、能力开关、结果表格及本人恢复 | [主页查数](home-query.md) |
| HTTP输入、拒绝审计、真实身份、幂等和交付边界 | [HTTP与真实Auth](trusted-query-http.md) |
| 历史结果状态/恢复HTTP、当前来源授权和分块完整性 | [结果恢复](result-recovery.md) |
| 会话/资格、同一数据库快照、真实来源与字段范围 | [权限与完整读取](trusted-query-authority.md) |
| 数值/来源/公式、表图导出、加密事件基础 | [基础实施记录](trusted-query-foundation.md) |
| 实际字段与公式版本 | `src/lib/intelligence/query/registry.ts` |
| 当前结构化查询边界 | `src/lib/intelligence/query/plan.ts`、`http.ts` |
| P1 结构化语义与查询路由 | `src/lib/intelligence/query/semanticPlanner.ts`、`semanticExecution.ts` |
| P1 确定性研究分析及资源预算 | `src/lib/intelligence/query/researchAnalysis.ts` |

各工作包的evidence仅证明其对应源码、环境和路径；后续包更新状态，不将旧包未完成说明覆盖新的证据。新接口改动须同步其契约和实际执行回归；身份/权限、资料业务日期、图表同源和审计保护仍遵循现有规范，不在此建立另一套长期规则。

P1 在既有楼宇／季度授权范围内接入结构化多轮追问、可点击澄清、真实数据期别和受控语义模型候选，并以同一来源快照补充趋势、样本与异常说明。常用表达走确定性快速路径；模型只提出有界语义槽位，不能执行 SQL 或生成正式数值。代码、数据库迁移、精确 head CI 和生产部署分别登记，本地实现不能代替线上可用证明。

楼龄／建成年份、GFA、报价、成交价格及未获权数据域仍不开放。多指标分组／趋势已随 PR #201 发布；固定子市场×等级的跨季度能力以本轮 [双维趋势记录](home-query-p1-cross-trends.md) 的实际实现、验证和发布状态为准。跨设备长期会话、历史市场全集和完整费用对账仍有明确限制。同季度租金与空置率关系等已有能力继续复用。P1 的直接合并与人工视觉／浏览器视觉／手机豁免须另行绑定具体 PR，工程、权限和真实执行门槛保留。

以下文档保留各工作包当时的实现和证据，其“未合并／未启用／未实现多轮”等历史状态不覆盖 P0、P1 的较新明确记录。

- [同源图表与内部下载](query-artifacts.md)：本地部分实现，独立导出资格、原快照制图与文件、主页按需操作；并非全部图种或生产启用。

客户端交付报告本地检查点：[语义、实现、实际验证与限制](query-delivery.md)。


入口与原文原子保存：[单事务加密入口、重试与缺失区分、升级边界](query-intake.md)。

审计检索与查看接口：[独立资格、全文检索、历史正文及查看留痕](audit-console.md)。

当前人员识别与检索：[姓名目录语义、同名区分与受控筛选](audit-people.md)。

受控审计下载：[独立导出资格、JSON问答档案、文件凭据与客户端报告](audit-export.md)。


多季度趋势：[连续期间、全期间共同样本、同源折线和导出](quarter-trends.md)。

区域与等级分组：[同一快照、各组独立样本、共同纵轴折线与分组来源](grouped-quarters.md)。

双维交叉分析：[子市场 × 等级、热力表、逐格来源和 Excel 矩阵](cross-quarter.md)。

- [同季度租金与空置率关系](rent-vacancy-relationship.md)：联合有效样本、精确矩与近似Pearson、同源散点和文件；本地验证不代表生产开放。

- [楼宇分布与分位数](building-distributions.md)：Type 7分位、离群标记、直方/箱线与同源导出；本地能力，未生产启用。

相对季度与比较：[旧受控语法的北京时间锚定、明确滚动区间、跨季幂等与同源输出](relative-quarters.md)。P1 对“最新有数据”“最近N季度”“今年”及上下文“去年同期”的新语义，以 [P1 时间说明](home-query-p1.md#3-时间筛选和真实数据范围)为准；原绝对计划和历史结果保持不变。
- [企业名称 AI 匹配 admin 权限补漏](lease-company-admin.md)：旧成交入口不再允许 editor 发起模型或读取 AI 缓存；后台各边界实时核对 admin/会话，普通企业检索保留。此包不是 Q15 完成，旧路径统一审计和模型费用治理仍待建设。

- [AI 5.0 阶段 04：自然语言 Excel／CSV 导出](ai5-intelligent-export.md)：工具、完整文件、授权恢复与持续回归契约。

- [AI 5.0 阶段 05：专业图表工作区](ai5-chart-workspace.md)：结构化建图／改图、坐标、真实 PNG／SVG 和授权来源回归。

- [AI 5.0 阶段 08：楼宇、地图与业务模块联动](ai5-business-integration.md)：固定资料口径、独立资格、管理员 Stacking、子市场发布、未来供应及原地图双向交互。

- [AI 5.0 阶段 09：文档证据检索与公开研究](ai5-knowledge-retrieval.md)：本地解析、逐段引用、当前文档授权／版本失效与独立公开搜索配置。
