# 楼宇字段补齐 V5｜2026-11-25

- 生产项目：`qhgxougfzzmgqjzzwudf`；批次：`ai_building_field_backfill_20261125_v5_100`。
- 新增字段：**100/100**，31个楼宇/项目，33种业务字段，全部在 `building_brochure_data`。不计入此前批次成果。
- 分批正式提交：22、20、22、17、19；累计22、42、64、81、100。每批先执行事务性预演并回滚，再正式提交并独立读回。
- 内部来源39：审阅档案原页34、明确既有字段提取5；外部双来源交叉校验61。来源记录166：内部39、外部127。外部交叉校验指不同公开来源共同支持相应字段，不等同于独立现场测量。
- 回退预演：事务内恢复100个字段为NULL、写入100条临时回退审计、当前批次来源临时停用为0；最终ROLLBACK。再次独立查询：100条字段全部保留，166条当前来源保留，持久回退审计0条，其他批次重复审计0条，验证失败0条。
- 数据口径：档案历史值与实际现时状态不混同；未来供应项目参数按规划资料记录（包括Z3、懋源曜中心），不宣称已建成/已交付。懋源曜中心电梯分区为档案中可明确匹配的配置摘要，不是完整梯数表；不得将该字段用于推算全楼梯数。历史认证不代表当前仍有效；WELL记录为明确可交叉支持的历史取得信息。公开招商资料存在转引可能，未把双站交叉校验当成双重独立实测；对有明显口径差异的楼层、车位划分、面积等字段跳过。面积与使用率存在来源约数的保留该口径。
- 已写入的来源、审计采用真实工具身份；无非空覆盖、无历史成果重复计数。未修改数据库结构、权限、业务逻辑或前端，未部署，未合并main。

## 字段分布

| 字段 | 数量 |
|---|---:|
| 轨道交通 (`metro_access`) | 7 |
| 总车位 (`parking_total`) | 7 |
| 幕墙 (`facade_type`) | 6 |
| 英文名称 (`name_en`) | 6 |
| 使用率 (`efficiency_rate`) | 5 |
| 地下楼层 (`floors_below`) | 4 |
| PM2.5净化 (`hvac_pm25_purification`) | 4 |
| 地下车位 (`parking_underground`) | 4 |
| 电源配置 (`power_source`) | 4 |
| 标准层面积 (`standard_floor_area`) | 4 |
| 建筑高度 (`building_height`) | 3 |
| 净高 (`clear_height`) | 3 |
| 无柱设计 (`column_free`) | 3 |
| 交付标准 (`delivery_standard`) | 3 |
| 货梯 (`elevator_freight`) | 3 |
| 层高 (`floor_height`) | 3 |
| 地上楼层 (`floors_above`) | 3 |
| 总建筑面积 (`gfa_total`) | 3 |
| 地上车位 (`parking_above`) | 3 |
| 进深 (`depth`) | 2 |
| 客梯 (`elevator_passenger`) | 2 |
| 电梯分区 (`elevator_zones`) | 2 |
| 办公楼板承重 (`floor_load_office`) | 2 |
| 办公建筑面积 (`gfa_office`) | 2 |
| 备用发电机 (`power_backup_generator`) | 2 |
| 供电系统 (`power_system`) | 2 |
| 运营商 (`telecom_provider`) | 2 |
| 地址 (`address`) | 1 |
| 柱距 (`column_spacing`) | 1 |
| 开发商 (`developer`) | 1 |
| 绿色建筑标准 (`green_building_standard`) | 1 |
| 24小时冷却水 (`hvac_cooling_water_24h`) | 1 |
| WELL认证 (`well_certification`) | 1 |
| 合计 | 100 |

## 交付

- [批次01](batch-01.sql) / [批次02](batch-02.sql) / [批次03](batch-03.sql) / [批次04](batch-04.sql) / [批次05](batch-05.sql)
- [核验SQL](verification.sql)
- [安全回退预演SQL](safe-rollback.sql)（默认ROLLBACK；实际撤销需另行授权）
- [字段审计及证据引用](manifest-references.csv)（不含原始Broker数据；仅引用记录ID、页码或公开URL）
