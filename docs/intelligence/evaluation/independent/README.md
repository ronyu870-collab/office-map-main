# 独立验收（离线）

冻结基线：`9e0c33ababc40140675c6ad13674e4aeb636a6ba`。验收者未参与产品修复，场景与人工期望先冻结，再接线执行。原始哈希见 `freeze-manifest.json`，冻结计划见 `frozen-plan.md`。移入仓库时仅适配导入／输出路径，未改断言、夹具值、问题或 oracle。

首批独立结果：H1–H5 PASS，H6 FAIL；H7 的 5 个预算机制断言 PASS。H6 明确期间纠正后返回澄清，未保留原指标／范围形成可执行计划。该题已通知实现者，后续修复只计回归，不能覆盖此批原始失败。原输出完整保存在 `initial-results.json`、`initial-budget-results.json`。

本包覆盖合成数据的实际 TypeScript 聚合、排序、权限函数、真实 XLSX bytes、时间／多轮语义、SQLite 持久化和两个 Node worker 的并发预留。全部离线，无真实模型、真实 Auth、数据库 RLS 或生产成功证明。权限题同时含允许与预期拒绝，不能拿拒绝增加支持任务完成率。

可重跑入口（每次默认新建独立临时证据目录，不覆盖原批次）：

```sh
node docs/intelligence/evaluation/independent/run.mjs
```

主验收支持任务 5/6 完整通过；预算机制 H7 PASS。各结果不能合并成生产总体成功率。真实模型任务全部 BUDGET_BLOCKED，本任务无金额授权，实际请求 0、费用估计 0、未结算 0；账单未核对。

H6 修复后的同题回归已通过，重跑 H1–H7 全部通过，见 `regression-results.json`、`regression-budget-results.json`。这不把原H6失败改写为独立验收通过。独立代码审查另发现停机后已预留请求仍能sent的竞态及通用方法讨论被强制查数，具体处置见 `review.md`。

新增审查缺陷的独立回归入口（不并入原批次评分）：

```sh
node docs/intelligence/evaluation/independent/review-regressions.mjs
```
