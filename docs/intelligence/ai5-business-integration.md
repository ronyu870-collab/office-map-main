# AI 5.0 阶段 08：业务资料与地图联动

本阶段增加只读业务研究入口，复用现有 Agent、正式结果、加密归档、来源、导出、楼宇卡片与地图。没有重做地图、季度引擎或 Stacking Plan，也没有生产业务写入、生产迁移或默认资格授予。人工浏览器、截图与独立人工视觉审查按本轮用户要求未执行；保留工程、真实数据库、Auth／HTTP、地图逻辑、权限、审计与文件回读回归。

## 工具与字段

| 工具 | 输入与返回 | 来源及口径 |
| --- | --- | --- |
| `query_building_dossier` | 1–20 个正式楼宇 UUID，选择最多 26 项资料字段；名称由后端绑定 | `buildings`、`building_brochure_data`；非草稿季度存在性来自 `building_metrics` |
| `query_submarket_profile` | 1–8 个子市场的已发布静态简介 | `map_submarket_profiles`；复用地图的完整发布校验（包括事实／观点数组中的内部标记），不交付草稿 |
| `query_future_supply` | 1–8 个子市场；目录、明确季度提交或最新所属季度提交 | `future_supplies` 与 `future_supply_submissions` 分列；预测目录、填报提交均不冒充正式季度统计 |
| `query_stacking_plan` | 1–20 个楼宇的真实楼座、楼层、单元及来源状态 | 现有 towers／floors／spaces／sources；真实管理员、只读、不含租户、合同阶梯、备注、联系人、原件路径 |
| `prepare_map_selection` | 本次正式结果或其楼宇 ID 子集；定位单栋、选择多栋或只看选中 | 仅接受来源绑定的楼宇主键，最多 500 栋；超限拒绝，不再截成 20 栋 |

来源面板与 manifest 使用真实物理列名；季度清单逐条绑定真实指标记录 ID、原始年／季度、记录版本，服务端去重排序，不把楼宇 ID 冒充指标记录 ID。楼宇资料字段采用以下固定物理映射，不因同名而跨源回填：

| Agent 字段 | 物理字段 |
| --- | --- |
| district / submarket / grade | `buildings.district / submarket / grade` |
| completionYear / leasableArea | `buildings.completion_year / leasable_area` |
| address / brochureDistrict / completionDate | `building_brochure_data.address / district / completion_date` |
| gfaTotal / gfaOffice / standardFloorArea | 楼书 `gfa_total / gfa_office / standard_floor_area` |
| height / floors / floorsAbove / floorsBelow | 楼书 `building_height / building_floors / floors_above / floors_below` |
| parking / metro | 楼书 `parking_total / metro_access` |
| leed / well / greenStandard | 楼书 `leed_certification / well_certification / green_building_standard` |
| propertyManagement / delivery | 楼书 `property_management / delivery_standard` |
| elevators / telecom / hvac | 楼书 `elevator_passenger / telecom_provider / hvac_system` |
| availablePeriods | `building_metrics` 非草稿记录的去重季度；不读取或保证该季度数值有效 |

共 26 个可选择资料字段，名称自动添加。数值保留精确十进制与零；缺失、非法数值、负面积／计数、候选冲突及部分候选缺失分别保留未知状态。目录可租面积、GFA、办公建筑面积、标准层面积与季度总面积互不替代。目录建成年份、楼书竣工日期分别交付。

楼书当前没有“正式当前有效版本”的可靠优先级。本工具读取所有候选，不把上传／更新时间最新的一条冒充已核验版本。数值一致也不证明现实仍然有效；来源标记为未核验，回答和文件保留此限制。缺失参数不补齐。未独立治理的业主、电话等字段不开放。

## 授权与来源

AI 沿用当前真实管理员本人有效会话的准入，不扩大到 viewer、editor、demo 或模拟身份。新增 `private.ai_business_research_grants` 默认关闭、无初始授权：模块、资料字段、楼宇／子市场范围、季度提交读取、内部导出分别明确授予，和原 AI 资格取交集。Stacking Plan 无论有无新资格，都不绕过现有 Admin-only 约束；现有编辑／提交／管理路径不变。

新 RPC 仅服务端可执行，固定模板投影，private definer 空 search_path；客户端不能直读授权表或调用 RPC。授权维护沿用既有 policy-change 触发器，记录前后差异与 revision；不提供用户自行扩大权限的界面。

新结果绑定计划、授权版本、完整来源快照哈希。每次模型调用、工具步骤、最终交付、对话续轮、历史恢复、卡片／地图、下载均重新检查身份与资格；源记录或来源关联变更也使旧结果失效。导出还要求原 `export:internal` 与新模块 `allow_export`。混合季度／成交／业务任务的最终档案保留所有研究资格绑定。

正式表格只包含获权字段。模型仅接收明确标示的少量预览，完整表格和导出不依赖预览行数；Stacking 单元明细连分页、来源和制图工具观察也不发送模型，只交付获权管理员的正式表格与原模块链接。资料文本视为不可信数据，不能成为模型指令。此阶段业务资料 PDF 组合明确不支持，不让它落入季度报告引擎。

## 身份、地图与模块兼容

楼宇卡片沿用原组件、来源按钮、季度标识、照片权限与地图详情。业务资料字段直接来自本次正式结果。Stacking 增加现有 `/stacking-plan/{buildingId}` 入口；单元 ID 不充当楼宇 ID。

地图操作保存在加密结果的 `agentMap`，只有打开后通过原卡片 API 重新核对权限，才交给现有 MapClient。单栋详情链接可显式选择同一正式结果中的楼宇；整组操作按已准备的 ID 子集恢复。反向地图“分析项目”继续使用原受控楼宇选择和身份治理，同名、项目与楼座歧义仍须原流程确认。

模型不提交坐标。定位读取原地图目录的现存坐标，沿用原 AMap 数据流及坐标体系，不新增坐标转换或根据名称猜测点位。不在当前地图目录或缺坐标的项目显示限制。未额外核验历史坐标本身的测绘来源，不能把本轮逻辑测试宣称为实地点位核验。

未来供应只按明确 `building_id` 关联已获权楼宇，不按同名或最近点关联、不把供应 ID 塞进存量地图。未唯一关联保留空值；与历史项目映射规则一致，不自动把项目当单栋。最新提交按记录所属季度选取，同期多个候选保留冲突，不取上传最新覆盖。Stacking 结果按单元组织，没有单元的楼层／楼座不作为行，不表示不存在，完整结构见原模块；来源跨楼关联直接拒绝；状态是来源快照，未知日期／待审核／拒绝保留；重复展示的楼层面积不能逐单元相加。

现有 `get_building_profile`、租金／地图搜索、季度填报、Stacking 编辑和导出菜单保留原路径。新读取不回写生产业务表，也不新增公共文件 URL。

## 限额与验证入口

单个结果最多 5,000 行、每行 1,000 条证据、总计 20,000 条证据；结果工作集、审计和文件大小继续受既有限额控制。超限明确失败，不交付静默截断的表格。大批楼宇详细资料需分批获权查询，不能将模型预览当全量。

- `src/lib/intelligence/business/research.test.ts`：字段、面积／日期、缺失／冲突、发布校验、模型边界、25 栋地图无截断、真实 XLSX 中文／数值／公式防护、撤权。
- `supabase/tests/ai-business-research/run.mjs`：匹配生产主版本的隔离 PG17，允许／拒绝、会话、字段／模块／范围、来源身份、默认关闭、审计及超限；使用脱敏合成数据。
- `scripts/verification/ai5-business-scenarios.mjs`：真实 GoTrue、PostgREST、生产构建 HTTP 的 Agent、卡片／地图、归档、文件回读与审计；仅模型规划脚本化，无外部模型或生产客户数据。
- 两种回归均接入既有必需 Verify，不跳过旧成交、季度、图表、PDF、地图或审计回归。具体运行结果见对应 PR 的精确提交检查。

生产启用仍需单独执行已审阅迁移及有记录的显式资格配置；本次代码交付与合并不代表生产数据库已开放这些模块。
