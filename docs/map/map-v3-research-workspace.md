# 地图 3.0 / Goal 01 — CBD 研究呈现契约

## 范围

仅对已发布、结构化 CBD 研究启用新呈现（`data-submarket-featured`）。其他市场、旧版画像和未发布资料继续使用原有路径。数据获取、授权、地图实例、阅读位置、编辑器、研究版本、项目跳转及审计继续由既有工作区负责，不新增读取接口或数据库迁移。

## 后续 Goal 接入

- `model/submarketResearchPresentation.ts`：`ResearchReadingMode`、`ResearchMarketType`（office/park/mixed）、`ResearchTheme`、`ResearchFactVariant`、`SubmarketResearchPresentation`。`buildResearchPresentation(research, marketType)` 仅从已发布结构化研究编排；CBD 以供应支持的竞争观点为默认判断，其他市场后续应提供自己的选择策略，不以 CBD 的主题评分替代实地研究。
- `components/SubmarketResearchPresentation.tsx`：`ResearchCoreMetrics` 接受类型化指标、单位和范围；`OfficeResearchCoreMetrics` 从当前筛选的楼宇摘要与最新正式记录计算期间上下文；`ResearchQuarterPulse` 独立呈现完整子市场有效季度和变化；`ResearchLead` 用于摘要与普通阅读；`ResearchChapters` 接受主题编排，可选择 main/outlook。
- `SubmarketResearchData.tsx` 的 `part='composition'` 让存量构成／未来供应与 KPI 分离。后续图表仍在 `SubmarketResearchTrend` 入口接入，不复制季度事实、图表加载或等级状态。
- `SubmarketDetailPanel.tsx` 是现有模式、标签、项目及研究阅读的组合入口。快速摘要沿用原测量标记；普通模式不扩大面板；完整模式中指标占整行，趋势与构成按宽度并列，研究、代表项目及展望按主题顺序占整行。图表、构成、区域研究及项目各自是独立插槽，不能另建地图或另取一份正式数据。
- `SubmarketRepresentativeProjects` 继续接收真实筛选楼宇及 curated 项目 ID。客户版的旧研究文案在显示时保留公开市场研究的性质、去除外部机构署名；维护端的证据、来源、版本与原始研究 JSON 不变。PR #340 的原始文案改进可独立合并。

## 数据边界

当前筛选的楼宇最新正式值不等同完整子市场同季度聚合；KPI 仅在租金与空置率均有相同单一期间时共用日期，混合季度分别标注。项目数量属于当前筛选名录。季度变化取既有同季度市场契约，不从当前筛选值推导；同样本变化须存在至少两个有效共同样本。区域公开研究以其证据期间及独立样本性质标注，外部甲级空置率只进入研究章节，不与平台甲乙级核心指标并列作比较。未来供应继续使用既有接口并独立于存量。

## 工程验证

保留原有组件与浏览器验证，新增真实 CBD 研究 JSON 的选择与范围单元测试、组件顺序／编辑权限断言、既有地图浏览器用例中的结构化 CBD 路径。不使用历史截图中的数值作为生产常量。实际 CI 结果以对应 PR head 为准。
