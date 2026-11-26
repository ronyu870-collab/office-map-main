# Pitch Studio 3.0 并行开发接口

共同分支 `codex/pitch3-integration`。首次共享契约提交是七个专项的共同起点。已有提交的分支可以合入该起点并重跑自己的回归。

父提交为 [PR #323](https://github.com/ronyu870-collab/office-map-main/pull/323) 在 2026-11-27 核实的开放 HEAD `8c25b4deb5cfdbb29afc05660eab73f49574ec79`。当时 main 为 `4abcfc90923339a1c8f81a4be57ecd7a9471f350`。保留 #323 的可编辑画布、审阅提纲生成和 AI 修订入口。发布前以届时 main 和 #323 最终内容核对增量。

## 文件责任

| 专项分支尾缀（前缀 `codex/pitch3-`） | 负责 | 交接 |
| --- | --- | --- |
| `01-data` | `business/adapter.ts` 与新增业务数据读取模块。各数据域既有权限入口须协调 | 已授权的事实、原始来源、明确的缺失状态和 `BusinessDataBinding` |
| `02-visual-assets` | `visual-data/`。楼宇图片、地图与 Stacking Plan 来源读取 | `VisualAssetReference` 与服务端素材解析。与 03 协调渲染，与 06 协调复核 |
| `03-design-engine` | `design/`、`layout/`、`render/` 及内容／Scene 结构 | `SlideContent → SlideScene → 预览／可编辑输出`。现有场景可继续读取 |
| `04-proposals` | 商业页面、提案配方和组合。使用独立业务模块 | 从已授权事实和素材生成 `SlideContent`；给 05 提供稳定的 `pageKind` 目录 |
| `05-proposal-ai` | `ai/` 中的新提案解释与修订编排 | 解析输入、澄清，交付已确认的 `ProposalBrief`、`ProposalPlan` 或 `DocumentModificationPlan` |
| `06-document-workflow` | `workspace/` 服务端协议和工作流、`data/` 持久化与导出、相关 API 和迁移 | 按项目及页面版本执行和恢复任务、保存、更新绑定、回读和导出。与 03 协调原生渲染 |
| `07-workspace-ui` | Pitch 工作台前端、地图／AI 等入口的交互 | 使用 06 的命令收据，不重复执行任务；`AddToPitch` 打开可审阅的提案上下文 |
| 集成 | `integration-contracts.ts`、跨模块适配与最终运行验证 | 协调共同类型、依次合并、核对发布 diff 和交付 Demo |

专项路径以仓库 `src/lib/pitch/` 为默认根。涉及其他专项的共享文件时先确认接缝和修改方。新增类型可在各自模块扩展，经跨模块验证再调整共同契约。

## 契约用法

- [共享类型](../../src/lib/pitch/integration-contracts.ts) 用于模块交接，沿用现有工作台上下文、事实绑定、来源、披露、Scene 布局和保存类型。HTTP、持久化及 AI 输出边界继续使用现有或专项的运行时校验。
- Brief 的楼宇为已解决的目录 ID，比较顺序以用户选择为准。期间和筛选歧义应先解决。`period: null` 表示没有声明一个正式季度，数据适配层返回实际所用的正式期间或缺项。A 座、B 座属于同一项目时在空间资料中保留楼座关系，项目级租金、空置率保留原粒度。
- 数据绑定带政策、权限及版本。计划通过快照指纹锁定审阅内容，来源事实和实际披露范围由服务端复核。资料不足明确留缺，测试夹具沿用 `isTestData` 限制。
- 素材引用固定对象、版本、版本哈希、建筑归属、来源和披露。服务端负责访问、许可和内容复核；页面按实际获得的素材生成，缺失与授权撤回显式反馈。
- 计划按 `slides` 数组排序。`pageKind` 由业务组合方定义。缺项说明保留到工作台。修改计划绑定项目版本和原页版本，`pages` 为受控工作台页编辑；刷新参数引用经审阅的计划。并发冲突重新审阅，重复任务复用原收据。
- `AddToPitch` 只传已有业务对象标识和可选上下文。后端按活动会话解析并重新授权；追加操作走显式确认和持久化版本校验。

## 合并与证据

专项 PR 目标为 `codex/pitch3-integration`，提交时说明 HEAD、实际运行的相关回归、数据和导出限制。逐个整合并记录专项 HEAD 与整合提交。当前共享基线和已核实的 main 的 Verify 工作流均未列入此集成分支，专项 PR 需记录本地证据和实际检查状态。最终发往 main 的 PR 由当时工作流验证。

发布时核查 #323 的确切范围、已合入 main 的同等内容和后续地图、AI、CI 差异。保留部署配置；当前 main 的 Vercel Git 配置启用 `main` 和 `preview/**`。生产数据、素材对客披露及迁移分别按实际授权和来源核对。
