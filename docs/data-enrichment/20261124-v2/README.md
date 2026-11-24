# 2026-11-24 第二批：楼宇技术字段生产补齐

## 交付与边界
- 生产项目：`qhgxougfzzmgqjzzwudf`。批次：`ai_technical_fields_20261124_v2`。
- 实际提交：14 个原为 SQL NULL 的正式业务字段，11 栋既有楼宇；目标 100，尚差 86。本批不计前批 100 个子市场字段。
- 全部目标为 `public.building_brochure_data`，不新建楼宇、不覆盖非空、不复制子市场或同一字段到其他表凑数。
- 字段分布：building_floors 6、parking_total 1、floors_above 2、floors_below 2、building_height 1、developer 1、gfa_total 1。
- 内部来源计算 7 个字段，外部 7 个字段。后者每字段保存两项来源，共 21 条 provenance；每业务字段 1 条 AI_FIELD_FILL 审计，共 14 条。
- 原始内部值由 SQL 在生产库读取并与对应原始 provenance ID 比对；本公开仓库不包含 Broker 原始填报、个人信息、密钥或内部资料正文。
- 阅读最新 main AGENTS V2.6、数据规范 04 V2.3、既有来源记录、历史讲盘归档及审计身份规范。生产预检 775 楼宇，669 tracked active，381 tracked 既有楼书记录。本批只纳入 active/tracked/stock/已入市且未被合并的目标。

## 证据、取值与保留事项
`apply.sql` 内固定目标 ID、字段、来源 URL 或内部来源记录 ID、口径、单位、可确定来源日期。未知发布日期不伪造。内部计算使用 other / legacy_backfill，未宣称新增独立交叉核验；内部历史资料不代表当前运营数量经过实地确认。外部字段用两来源组及 cross_verified；主楼地上、地下分别入库，既有总楼层字段未覆盖。新动力金融科技中心以两个公开来源一致的约 10 万平方米填总建面，来源注明约数；未把 101793.76 平方米改造批复规模视为精确产权测绘值。居然大厦仅记集团层级开发主体，保留具体法人后缀及当前产权待核。

公开来源：
- 中信大厦：北京市建筑设计研究院项目案例 + 中国中冶全过程监理；两独立工程参与机构一致。
- 致真大厦：北航中湾智地物业官方项目说明 + 易创地产详细项目技术参数；另有公开商业资料相互印证。24 层为主体地上层数，不包含第 25 层设备层。
- 居然大厦：金环建设施工工程案例 + 独立招商项目资料，均指居然之家集团投资兴建。
- 新动力金融科技中心：国际科技创新中心网络服务平台 2024 年资料 + 西城区政府转载新京报报道，两者均称约 10 万平方米。

暂不写入：居然大厦不同资料地上楼层及已有总楼层不一致；英蓝国际金融中心等项目楼层、面积口径冲突；业主法人/实际产权不清；LEED 申请中或预认证不能当成已认证；停车位及电梯数量商业资料互相转载或缺少独立印证；仅计划竣工或历史建成年月不自动填主表实际入市年份。未逐栋核实的其余 86 个目标不计为成功。对中信及致真既有总楼层值使用地上层数的历史口径保留原值，后续需产品层统一字段含义。本次只做补空，不进行历史数据纠错。

## 实际执行证据
1. 从本分支 `apply.sql` 读取原文，将末尾 COMMIT 改为 ROLLBACK；生产事务内返回 audit_fields=14、buildings=11、expected_provenance=21、internal_fields=7、internet_fields=7。预演后独立查询 batch_after_dryrun=0。
2. 从 GitHub 重新读取同一 apply.sql 原文，正式 COMMIT。返回相同 14/11/21/7/7。
3. 独立 `verify.sql` 回读：business_fields=14, buildings=11, originally_null=14, verified=14, provenance_matched=21, internal_fields=7, internet_fields=7, unknown_actor_kind=14。字段、原值、新值、楼宇身份、更新时间、逐字段证据组及核验状态一致。
4. 生产 `rollback-preview.sql` 先逐字段验证所有原审计、当前值、目标更新时间、当前来源、无后续目标审计及来源修订，随后事务内逆向恢复、停用批次来源、追加补偿审计。返回 tested_fields=14, restored_nulls=14, compensating_audits=14, retired_evidence=21。事务末尾 ROLLBACK，未真实撤销。
5. 回退预演后的再次独立回读仍为 14/14/21，committed_rollback_audits=0；正式业务字段完整保留。
6. 将来实际撤销必须获得独立授权并重新预演；任何后续人工修改或来源变更都会阻断整批回退，不允许直接覆盖。原审计保留，真实回退应追加补偿审计，不删除历史证据。

## 审计身份限制
AI 执行者如实记录 user_id=chatgpt、request_source=chatgpt_mcp、action_type=AI_FIELD_FILL、details.executor=ChatGPT MCP；现有触发器将 actor_kind 归类为 unknown（14 条），不冒用 Codex 或用户身份。需要系统后续支持 ChatGPT MCP 执行者分类。本批没有更改权限、触发器、审计规则、业务逻辑、部署或 main。

## 文件
- [正式入库 SQL](apply.sql)
- [独立核验 SQL](verify.sql)
- [回退预演 SQL](rollback-preview.sql)

仅独立工作分支保存上述文件与报告，未合并 main。
