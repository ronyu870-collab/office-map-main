# 楼宇字段补齐 V6｜2026-11-25

批次 `ai_building_field_backfill_20261125_v6_100`；生产项目 `qhgxougfzzmgqjzzwudf`。生产库正式入库100个原NULL业务字段，46个楼宇/项目，27类字段，全部在building_brochure_data。独立数据库核验100/100，157条当前来源、100条审计，既有非空字段覆盖0、其他批次重复0、持久回退0。此核验是数据库及证据记录一致性验证，不等于现场事实的最终确认。

## 执行结果

| 子批 | 新增 | 累计 | 来源 |
|---|---:|---:|---|
| 1 | 25 | 25 | 内部地图快照与楼宇点位计算 |
| 2 | 20 | 45 | 已审阅历史项目原页 |
| 3 | 21 | 66 | 外部资料交叉比对 |
| 4 | 18 | 84 | 外部资料交叉比对 |
| 5 | 16 | 100 | 外部资料交叉比对 |

内部45，外部55（外部112条证据、内部45条证据）。每批均预演ROLLBACK、正式COMMIT及独立回读。最终回退预演在事务内恢复100个NULL，生成100条临时回退审计，停用本批来源至0；随后ROLLBACK，独立回读确认100字段和157来源完整保留、0持久回退审计。独立验证重新计算25个地图距离、从20个档案原页重新提取，另外55个逐一比对公开来源清单及数据库记录。

## 字段数量

| 字段 | 数量 |
|---|---:|
| 地铁区位 (`metro_access`) | 25 |
| 楼书公开定位 (`grade`) | 14 |
| 幕墙 (`facade_type`) | 8 |
| 空调系统 (`hvac_system`) | 6 |
| 开发商 (`developer`) | 5 |
| 办公楼板承重 (`floor_load_office`) | 4 |
| 地下楼层 (`floors_below`) | 4 |
| 客梯 (`elevator_passenger`) | 3 |
| 层高 (`floor_height`) | 3 |
| 总建筑面积 (`gfa_total`) | 3 |
| 总楼层数 (`building_floors`) | 2 |
| 使用率 (`efficiency_rate`) | 2 |
| 货梯 (`elevator_freight`) | 2 |
| 地上楼层 (`floors_above`) | 2 |
| 地上车位 (`parking_above`) | 2 |
| 可拆卸楼板 (`removable_floor`) | 2 |
| 标准层面积 (`standard_floor_area`) | 2 |
| 通讯运营商 (`telecom_provider`) | 2 |
| 净高 (`clear_height`) | 1 |
| 电梯分区 (`elevator_zones`) | 1 |
| 办公建筑面积 (`gfa_office`) | 1 |
| 商业建筑面积 (`gfa_retail`) | 1 |
| 24小时冷却水 (`hvac_cooling_water_24h`) | 1 |
| 总车位 (`parking_total`) | 1 |
| 地下车位 (`parking_underground`) | 1 |
| 地下停车层数 (`parking_underground_floor`) | 1 |
| 备用发电机 (`power_backup_generator`) | 1 |
| 合计 | 100 |

## 质量边界和复核事项

- 25条地铁区位由已有楼宇标注点与2026-04-03地图快照（public/data/beijing_map_data.json，blob 865e84fee5ae5cf088e30228ab8a2e1501304734）计算，四舍五入至100米。只是直线距离至站中心，不声称步行距离、出入口位置、当前开通状态或现场验证。
- 20条档案数据保留历史及未入市项目规划属性。荷载按1kgf=9.80665N换算整kgf/㎡；未来项目面积、梯数等为原页规划值，非现状实测。楼书grade为公开定位，不写入主表市场分级；季度总面积不复制到可租面积。
- 外部渠道交叉一致不代表来源均独立实测，尤其招商网站可能转引。跳过当时发现的同口径明显冲突候选。**追加复核事项**：第四批中关村国际创新大厦客梯2部，原入库两源一致（北京写字楼信息平台及北京商业地产楼宇信息）；之后检索到[办公网](https://www.bangongwang.cn/building/11853.html)列客梯6部、[猩猩找房](https://www.xxzf.com/fy/xxfy_6513)列总电梯8部（总数不是客梯数），存在历史/改造后口径差异可能，需业务核实。该字段已入库，审计ID 16150，未授权覆盖或真实撤销，保持原记录并标明复核事项。本批100字段数据库回读通过，但不把这一争议字段宣称为已最终消除事实冲突。其他公开字段也不能视为现场复测。
- 未修改数据库结构、权限、业务逻辑、前端，未部署或合并main。源资料以记录ID、页码、哈希或公开URL引用；清单不含内部Broker原始业务数据。

## 交付

[批次1](batch-01.sql) · [批次2](batch-02.sql) · [批次3](batch-03.sql) · [批次4](batch-04.sql) · [批次5](batch-05.sql) · [验证SQL](verification.sql) · [安全回退预演](safe-rollback.sql)（默认ROLLBACK） · [引用清单](manifest-references.csv)
