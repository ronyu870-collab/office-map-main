# Colliers AI 5.0 P0 — 季度来源与质量状态契约

版本：quarterly-source-coverage/1；适用范围：已获 AI 独立查询资格的管理员。**此文档、迁移和测试不等于生产数据库已迁移或生产代码已发布。**

## 业务依据

- public.buildings：楼宇实体及当前子市场/是否活跃/跟踪范围/合并标识；当前目录筛选不是历史楼宇全集。权限继续调用 private.map_building_visible，叠加 AI 获权地区/楼宇名单。
- public.building_metrics：每楼宇每季度一条指标；is_draft 表示草稿，is_locked 表示季度内部锁定。lock_quarter 管理 is_locked、locked_at、locked_by；created_at/updated_at 是数据库写入、修改时间，不是原始报告的核验时间。AI **仅选 is_locked IS TRUE AND is_draft IS NOT TRUE** 作为正式统计候选，字段有效性仍按原正数/有限数/面积条件校验。锁定本身不证明原始资料的独立真实性。
- public.quarterly_submissions：经提交路径写入的原始季度填报，可能存在同楼宇多条；没有正式已发布/核验状态字段。v2 的 quarterly_submission_provenance.source=user_confirmed_submission 只证明操作者通过提交接口确认，不等于市场研究部门审核。旧记录不一定有该证明。
- public.view_latest_quarterly_submissions：按楼宇、年份、季度取 created_at 最晚的提交，原视图仅以 created_at 排序，时间相同不稳定。本次诊断 RPC 单独用 created_at DESC、updated_at DESC、id DESC 确定唯一最近提交，不改现有视图和地图口径。
- private.ai_query_snapshot_read / private.ai_query_available_periods：共同服务原 AI 正式事实链与可用期间；修复前只排除草稿，修复后必须同时要求锁定。只通过 service_role 的 public RPC 包装读取，不向 AI 暴露直接 SELECT。

## 服务端数据契约

ai_query_quarterly_coverage 接受：已核验 actor/effective/session/permission_revision、季度字段白名单、一个明确合法季度、inventory/submarket/buildingIds 获权范围。权限使用 private.ai_query_authority 的当前 admin-only/1 资格和 private.map_building_visible。仅 service_role 有 EXECUTE；不新授 RLS、表权限或匿名权限。

返回：version、permission_revision、read_at、database_snapshot、查询年季/字段及以下**汇总数量**；不返回提交 ID、提交人、楼宇原始行或业务明细。

| 状态字段 | 定义 |
| --- | --- |
| formal.buildings | 已锁定且非草稿的不同楼宇数（正式候选） |
| formal.valid_buildings | 在上述候选中满足所选字段有效性要求的不同楼宇数；正式市场统计仍由原查询引擎计算 |
| formal.unlocked_rows / draft_rows | 尚未进入正式来源的指标行 |
| formal.incomplete_lock_evidence / locked_draft_conflicts | 锁定证据不完整、已锁定却标记草稿，供人工质量核查，不自动更正 |
| submitted.rows / buildings | 本季度的全部提交次数 / 按 building_id 去重的楼宇数 |
| submitted.latest_rows / superseded_rows | 一楼一条最近提交 / 被最新版本替代的提交次数；重复提交绝不叠加样本 |
| submitted.latest_field_complete | 最近提交中按所选字段具备有效数值的楼宇数，**不代表已核验** |
| submitted.zero_area_latest / missing_rent_latest | 最近提交的零面积、缺失租金质量线索；不补零、不复制上季度 |
| submitted.submitted_outside_calendar_quarter | 北京时间提交时间落在数据季度之外的记录数；可能是补报，不自动判定填错季度 |
| overlap.buildings / conflicting_values | 同楼宇同时存在锁定指标和最近提交 / 这些来源存在非空数值差异；不自动选取覆盖 |
| catalog_buildings | 当前获权目录基数；没有正式指标的目录楼宇属于正式覆盖缺口，不等于该楼宇不存在 |

状态的适用对象不同：正式指标的 locked/draft，提交数据的 unreviewed，以及数值缺失/异常/来源冲突，不能折算为单一“已核验”布尔值。错误季度只能对输入年份/季度合法性进行校验；仅凭创建时间无法推断业务填报年度是否错误，不自动跨期挪动。

## 查询策略与语义

1. 明确季度统计：原 engine 只使用正式快照及原公式（FIELD_REGISTRY_VERSION、FORMULAS），从不将提交写入官方租金、空置率加权公式。存在数值但未锁定仍不能当作正式样本。
2. 最新正式季度：ai_query_available_periods 只从获权且锁定、非草稿、满足所选指标有效性条件的 building_metrics 推导；多指标继续沿用原各自样本交集规则，最大 40 季度索引必须保留截断声明。
3. 对请求的季度缺少正式有效期间：额外调用上述获权覆盖 RPC，报告“正式口径缺失/提交覆盖存在/重复数量/质量与来源冲突”，并给出目前最近正式有效期间；客户端数据快照和审计结构保留。
4. 字段级最小披露：仅对本次已授权的指标字段统计缺失及来源差异；未经授权的租金或面积质量项返回 NULL（非 0），冲突数量不比较未授权字段，不得通过聚合旁路泄露数据。
5. 退化处理：RPC 缺失、权限版本变动、越权、返回结构冲突则关闭诊断，不降级为 service-role 直读明细。正式数值绝不能偷偷改走提交表。

## 2026-11-20 生产只读现场证据（不硬编码）

| 期间 | building_metrics 行数 | 锁定、非草稿行数 | quarterly_submissions 行数 | 提交的不同楼宇 |
| --- | ---: | ---: | ---: | ---: |
| 2026Q2 | 594 | 594 | 1,139 | 581 |
| 2026Q3 | 6 | 0 | 732 | 385 |

CBD 2026Q3：69 次提交，36 栋楼，最新版本中 36 栋面积和净有效租金均正。该数值不能证明独立审核或真实最新市场租金。以上是本次查询快照，与之后实时数据库变化无关。现有 Q2 锁定记录 locked_at/locked_by 均存在；现有 Q2 data_source 均为 NULL，不能据此补写来源。

## 验证、部署和回退

- 新 PG17 回归：在升级前复现“未锁定 Q3 被列为正式可用期”，升级后验证 Q2 不退化、Q3 无正式样本但提交存在、唯一楼宇去重、字段/地区/角色/资格拒绝、错期、两来源冲突和恢复。
- 现有 p1-periods、snapshot-fixture 合成正式数据明确锁定，防止原有测试只通过“非草稿”掩盖缺陷。
- CI 加入 Real PostgreSQL 17 AI query audit regressions；仍须执行仓库 verify、精确 PR head CI，人工浏览器与视觉验收按此次指示豁免，记录“未执行”，非“通过”。
- 迁移包含 CREATE OR REPLACE 的原两个 private 函数及只读聚合 RPC；**本次不得在生产应用迁移，不得写生产业务行，不得改变任何 RLS 权限**。如生产未部署此迁移，前端/服务端使用新 RPC 会失败关闭；必须先获独立生产迁移和发布批准并完成隔离 PG17 回归，再决定合并和部署。
- 回退必须通过后续迁移恢复原函数定义，保留业务记录、来源审计和提交历史；不能删除季度数据或者把未核验当正式记录。

本阶段不涉及租赁成交查询、PDF/Excel 导出、首页 UI 重构或地图现行统计口径。
