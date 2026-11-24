# 北京区楼宇 AI 数据补齐 · 第四批次（v4）

- 生产项目：`qhgxougfzzmgqjzzwudf`
- 独立批次：`ai_building_field_backfill_20261124_v4_100`；不计前次 v3 等历史批次。
- 执行结果：100/100 个原 SQL NULL 业务字段，44 个楼宇/项目（39 存量、5 未入市未来项目），31 类字段；存量字段 87、未来项目字段 13。
- 目标表：`building_brochure_data`，不改变已有非空业务值、业务逻辑、持久 schema、权限、审计规则、前端或部署。独立分支不合并 main。

## 批次执行

| 子批 | 实际提交 | 累计 | 来源 |
|---|---:|---:|---|
| 01 | 24 | 24 | 已有楼书确定性计算15、显式电源配置提取5、存量分类4 |
| 02 | 25 | 49 | 审阅过的原始项目资料页 |
| 03 | 24 | 73 | 审阅过的原始项目资料页 |
| 04 | 13 | 86 | 审阅过的原始项目资料页 |
| 05 | 14 | 100 | 审阅过的项目事实5、与未来供应表一致的目录分类9 |

每批先在生产事务中预演并 ROLLBACK，再 COMMIT，独立回读累计分别为 24、49、73、86、100。来源汇总：内部 100（审阅原始页 62、审阅项目事实 5、计算 15、明确配置提取 5、目录分类 13），外部新采集入库 0。

## 字段分布

| 字段 | 数量 |
|---|---:|
| `address` | 1 |
| `building_height` | 2 |
| `column_free` | 4 |
| `column_spacing` | 4 |
| `delivery_standard` | 1 |
| `depth` | 3 |
| `district` | 5 |
| `efficiency_rate` | 3 |
| `elevator_vip` | 1 |
| `elevator_zones` | 2 |
| `facade_type` | 1 |
| `floor_height` | 1 |
| `floor_load_office` | 2 |
| `gfa_total` | 1 |
| `green_building_standard` | 2 |
| `hvac_cooling_water_24h` | 2 |
| `hvac_fresh_air_capacity` | 3 |
| `hvac_pm25_purification` | 5 |
| `hvac_system` | 1 |
| `leed_certification` | 2 |
| `metro_access` | 2 |
| `parking_above` | 16 |
| `parking_total` | 2 |
| `parking_underground` | 2 |
| `power_backup_generator` | 3 |
| `power_source` | 5 |
| `power_system` | 9 |
| `raised_floor_cm` | 3 |
| `submarket` | 8 |
| `telecom_provider` | 3 |
| `well_certification` | 1 |
| 总计 | 100 |

## 完整性与安全验证

实际生产独立查询：100 审计、100 不同字段、100 匹配来源、100 唯一当前来源、100 完整回读、100 重新从来源计算后相符，持久回退审计 0。所有新数据原值为 SQL NULL，不覆盖已有值；未将历史补齐字段重新计数。审计身份为工具执行，未冒充用户。来源页按页码、来源记录 ID 和 SHA256 查验。内部来源及来源类型、层级和状态按现有约束记录，全部采用 legacy_backfill，不标记 cross_verified。

实际回退预演：在事务内还原 NULL 100，生成回退审计 100、当前来源 0；最终 ROLLBACK，之后重新独立核验正式入库的 100 字段及当前来源均保留，持久回退审计 0。回退脚本检查业务值、后续修改/审计、来源唯一性与记录更新时间，不满足保护条件时整批终止。将来正式回退需另行授权。

## 质量边界

- 历史楼书不等于实时现场勘验；保留历史认证口径（如 LEED-EB/CI 及 WELL 中期认证），不承诺当前有效或最终认证。约数保留来源说明。
- 15 条地上停车位为同一历史楼书、同一目标的总停车数减地下停车数，计算结果为 0；不是现场新采集。未合并口径冲突的楼座数据。13 条分类为同一 canonical ID 的有效系统分类，其中未来项目还要求未来供应表一致；不作为新现场勘验。
- 13 个未来项目字段仍属于未入市项目，其中 Z3 的建筑面积/使用率为历史设计约数，通信为规划配置；维晟中心 WELL 中期认证非最终证书。未更改入市状态、实际入市日期或将计划当作完工事实。
- 跳过来源冲突、不同楼座或面积口径、楼层区间无法存入单值、预认证与最终认证混淆的候选。无独立外网认证声明。
- 清单仅保存 ID、字段、来源定位和审计引用，不输出 Broker 原始业务数据、个人信息或密钥。

## 文件

- [引用清单](manifest-references.csv)
- [子批1](batch-01.sql) · [子批2](batch-02.sql) · [子批3](batch-03.sql) · [子批4](batch-04.sql) · [子批5](batch-05.sql)
- [独立验证 SQL](verification.sql)
- [安全回退预演 SQL](safe-rollback.sql)

生产入库时间：2026-11-24 15:57:44.773111+00 至 2026-11-24 16:05:51.663029+00。独立分支仅保存执行记录，不合并 main。
