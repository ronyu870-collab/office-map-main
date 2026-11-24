# 2026-11-24｜高力国际北京区楼宇 AI 补齐：100 个生产空字段

## 执行状态

- **环境：**生产 Supabase 项目 `qhgxougfzzmgqjzzwudf`（PostgreSQL 17），已执行正式 COMMIT。
- **批次：**`ai_brochure_submarket_20261124_100_v1`。
- **GitHub：**`ronyu870-collab/office-map-main`；独立工作分支 `codex/ai-building-field-20261124-100`；未合并 `main`，未修改前端、业务逻辑、RLS 或数据库结构。
- **实际新增正式业务字段值：**100 条；覆盖 **100 个唯一 `building_id`**。
- **目标字段：**100 条均为 `public.building_brochure_data.submarket`（楼书项目子市场分类）；不是 100 栋楼宇的全部参数，也没有新录入开发商、竣工日期、建筑面积、停车位等字段。
- **来源拆分：**内部已存在分类同步 **100**；本次新从公开互联网收集并独立核验 **0**。
- **字段级来源新增：**100 条 `building_data_field_provenance`；**AI 审计新增：**100 条 `audit_logs`（`action_type=AI_FIELD_FILL`）。
- **生产独立回读：**100/100 全部一致，0 条发现值或来源冲突；回退预演成功、**未正式回退**。

本批处理的是已有楼宇主表到**独立业务用途**的楼书数据表之间缺失的同一「子市场」分类。其必要性来自实际运行中的楼书后台 `src/components/admin/DatabaseManagerEntry.tsx`：`building_brochure_data.submarket` 在楼书数据管理表中是单独显示／编辑的「子市场」字段。它不会替代对外独立确认的项目物理参数。本批价值限定为楼书分类完整性，不能被描述为新增了 100 条高价值楼宇技术参数。

## 生产对象、候选筛选与保护

审查了最新主分支 `AGENTS.md`、`docs/standards/README.md`、`04_数据与内容规范.md`、`05_工程验证与交付规范.md`，以及生产库当前约束、字段溯源表、审计触发器、2026-11-13 的既有 AI 补齐批次。生产表初查：`buildings` 775、`building_brochure_data` 433；历史 `building_data_field_provenance` 约 9,045 条。

入库前共识别出 135 条候选满足如下条件：

1. 同一个既有 `building_id` 连接两表，`buildings.name` 与 `building_brochure_data.name_cn` 经去除首尾空格后完全一致；不做名称相似匹配、跨项目或模糊楼座映射。
2. 源楼宇为启用、`tracking_scope=tracked`、未被合并、`project_type=stock`、`is_entered_market=true`。
3. 目标楼书 `submarket IS NULL`；主表源 `submarket` 非空，且不是宽泛的「其他」。
4. 目标字段没有另一条标记为 `is_current` 的既有溯源记录；正式更新还要求目标值仍为 `NULL`、源值及源楼宇身份仍一致。
5. 对不同子市场轮流取样，按稳定的楼宇 UUID 排序，选取恰好 100 个不同源记录；不因重复写两张表、复制审计或二次同步重复计数。

楼座口径严格以原始主表的 `building_id` 及名称（若含楼座则沿用）为准，没有凭空补造未收录的楼座或将综合体拆成楼座。

**12 个子市场覆盖分布（共 100）：**

| 子市场 | 字段数量 |
| --- | ---: |
| CBD | 13 |
| 东城商务区 | 13 |
| 中关村 | 12 |
| 亚奥 | 12 |
| 望京-酒仙桥 | 12 |
| 燕莎 | 12 |
| 金融街 | 11 |
| 通惠河传媒走廊 | 5 |
| 上地 | 4 |
| 亦庄 | 4 |
| 北清路 | 1 |
| 四季青 | 1 |
| **合计** | **100** |

## 来源质量、治理与审计

每条 `building_data_field_provenance` 关联目标楼书记录 ID 和唯一楼宇 ID，记录 `field_name=submarket`、JSONB 新值、内部来源名称、检索和写入时间、可靠性等级、状态及 `evidence_note`。注释包含 `batch`、源表 `public.buildings`、源记录 UUID、源字段、目标记录 ID、楼宇名称、楼座边界、原始 `NULL`、分类单位、当前分类（非季度业务事实）及核验方法。内部来源没有公共 URL，文件发布日期未知则为 `NULL`，不伪造时间。

- `source_type='other'`：说明**内部记录同步**，不是公开联网搜索。
- `source_tier='legacy_unknown'` 与 `verification_status='legacy_backfill'`：表示保留内部历史分类的既有证据局限；即使两表值一致，也**没有取得两份独立权威资料**，不写为 `cross_verified`。
- `audit_logs` 每项记录 `target_id`、`old_values={submarket:null}`、`new_values`、目标更新时间、`provenance_id`、来源、`batch_id`、`ai_assisted=true` 和执行者说明；`event_id` 对本批的楼宇与字段唯一。
- 采用 `user_id='chatgpt'`、`request_source='chatgpt_mcp'`、`details.executor='ChatGPT connected Supabase tool'` 留存工具执行事实。**生产审计身份触发器优先从受保护账户目录解析，最终 100 条记录均为 `actor_kind='unknown'`、`actor_name=NULL`**，不可把这些记录冒称为数据库已识别的 `tool` 身份。这是需要运维复核的身份快照限制，未修改审计触发器、权限或人员目录。

## 实际验证与回退证据

| 步骤 | 实际执行 / 回读结论 |
| --- | --- |
| 生产缺失字段普查 | 先取得 135 个合格独立楼宇候选，选取 100；100 个原值均为 SQL `NULL`，名称均一致 |
| 生产事务预演 | 执行与正式脚本相同的 100 次条件 UPDATE、100 条 provenance INSERT、100 条 audit INSERT；最后以 `ROLLBACK` 结束；预演后无持久化记录 |
| 正式生产 COMMIT | 同一份保存的 SQL 不再替换 `COMMIT`，事务成功 |
| 首次持久化回读 | `audit_count=100`, `distinct_buildings=100`, `values_provenance_and_source_consistent=100`, `provenance_count=100` |
| 逐字段进一步验证 | `old_was_null=100`, `timestamp_matches=100`, `exact_three_way_matches=100`, `integrity_violations=0`；未发现不一致记录 |
| 独立 GitHub SQL 查询再次回读 | `audit_rows=100`、`unique_buildings=100`、`provenance_rows=100`、`originally_null=100`、`complete_validated_rows=100`、`identity_pending_actor_rows=100`、`externally_verified_source_rows=0` |
| 回退预演 | 对 100 条逐项检查原值、新值、来源、目标行更新时间、之后的审计和同字段来源记录；执行 100 个逆向更新、100 个 provenance 失效操作和 100 个补偿审计 INSERT；最后 `ROLLBACK` |
| 回退后再读生产 | `original_audit_count=100`、`values_still_live=100`、`erroneously_reverted=0`、持久化补偿回退审计 **0** |
| 代码或安全边界修改 | **无** DDL、应用代码、数据库权限/RLS、前端部署或合并 main |

回退脚本第一次预演触发了审计事件 ID 拼接时的 SQL 优先级错误，该事务报错并未回退生产。修正加括号后完整执行回退预演成功，正式 100 条值至今仍在生产库。回退 SQL 只提供有条件的逆操作及 `ROLLBACK` 预演；**未来若真的需要撤销，仍应先重新检查每个字段没有人工后续修改，并另外明确批准实际 COMMIT**。

## 产物与再现路径

- [01_production_apply.sql](01_production_apply.sql)：原子事务生产入库脚本，正式版本包含 `COMMIT`，**禁止无脑重复执行**；本批的重跑保护会拒绝重入。
- [02_rollback_preview.sql](02_rollback_preview.sql)：对原批 100 条全部进行逐字段安全检查的回退预演脚本，末尾始终 `ROLLBACK`，**不会直接撤销生产数据**。
- [03_verify_and_manifest.sql](03_verify_and_manifest.sql)：从生产库按批次实时读取 100 条逐字段来源、旧值、新值、楼宇 ID/名称、状态、审计 ID 的**只读验证与清单 SQL**；清单本体不上传公开仓库。
- 本报告即正式的交付与验证记录；`CHANGELOG.md` 在该独立分支登记本次生产数据作业。

## 仍需进一步核验

1. **来源独立性：**本轮 100 条是内部既有子市场分类，尚未使用政府／业主／权威公开资料对全部分类逐栋独立核验；如需外部核验，应逐个子市场检查具体边界。不能以本次内部双表一致性代替其事实真实性。
2. **优先高价值参数：**竣工／入市时间、开发商、业主、物业管理、建筑与标准层面积、停车、电梯、绿色认证、空调等仍有缺失。本轮没有将不同口径混写。尤其 `buildings.completion_year` 被现行规范定义为**入市年份**，不得直接由楼书 `completion_date`（竣工日期）推算；内部等级 A/B/P/BP 与楼书中文等级并非一一对应。
3. **审计执行者目录：**`actor_kind=unknown` 的 100 条工具执行记录可能出现在“需关注”。应按现有审计身份治理流程核验工具执行身份来源，不可修改历史快照或冒用人员账号。
4. **后续回退：**回退保护以本次预演时的生产快照为依据；任何之后的人工编辑都要求重核验、必要时重新设计单条恢复，而不是在未检查的情况下执行整批 COMMIT。

本仓库**不**包含 Broker 填报、私人联系信息、内部原件、数据库密钥或本批 100 条的实际数据库明细；仅保存针对生产库的受控 SQL、记录定位方式和汇总结果。
