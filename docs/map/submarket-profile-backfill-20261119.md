# 2026-11-19 子市场概况资料生产补齐记录

## 范围和版本

- 仓库：`ronyu870-collab/office-map-main`；功能代码已合并 PR #212，合并 SHA `1a04fb2e7e5da8833660d9c20452cbe9dd55aa10`；Vercel production `dpl_B6mUFjeFiSYZZ4JUKSPxYCRe7Y6N` 已显示 `READY`（并不等同已操作生产登录界面）。
- Supabase 生产项目：`qhgxougfzzmgqjzzwudf`，PostgreSQL 17；使用 main 已有 `supabase/migrations/20261119122000_map_submarket_profiles.sql` 同内容执行生产建表，管理端记录迁移版本 `20261119060156`（名称 `map_submarket_profiles`）。**仓库文件版本和管理端执行版本不同**；日后引入自动 `db push` 前应核对迁移历史，避免混淆重复执行。现有 DDL 包含 `create table if not exists`、RLS 和权限声明。
- 覆盖 `MAP_SUBMARKETS`（排除“其他”）与 `MAP_SUBMARKETS_SECONDARY` 16 个具名子市场。生产库核对：16 条 profile、20 条区域量化事实、17 条政策/规划或政府项目资讯、16 条 AI 研究提示；无任一具名子市场缺档、无空白概况/产业/交通/政策/观点段落。
- 16 条数据写入由独立 SQL 原子批次完成；每批同时向 `audit_logs` 插入审计，用户 ID 标记 `tool:chatgpt_submarket_research`，`details.operation=ai_public_source_backfill`，每条 `new_values` 保留完整入库值和 `source_urls`。注意：现有 `audit_logs_snapshot_actor` 触发器将此类未知外部工具 ID 的 `actor_kind` 规范为 `unknown`，但保留 `user_id` 和 AI 操作标记；**不可冒称 actor_kind=tool**。
- 写入遵循 `on conflict do nothing`：不覆盖已有人工作业结果；本批实际新增16行，没有覆盖其他存量业务字段。撤回必须首先查审计与后续人工更新，严格核对 `updated_at` 和最新内容，**不得直接批量删除**；审计须保留。

## 内容口径

- `overview`：地理与功能定位、行政边界和本平台内部子市场统计范围的区别。
- `industries`：官方报告所反映的产业特征、适用业务场景和需要确认的局限；不声称已掌握全市场租户名单。
- `transport`：通勤与楼宇核验框架；在建工程不写作已投运。
- `demographics`：每个档案至少一条**明确标注行政区级、非子市场级**的人口参考事实，包含统计时间、空间范围、官方来源；CBD、丽泽、亚奥、金融街另补有来源的区域产业或客流事实。严禁将区级人口伪装为办公室商圈常住人口。
- `policies`：全部有 https 公开来源、发布机构、日期与适用条件。部分是官方工作报告、政府项目资讯或规划解读而**非具有直接补贴效力的正式政策**，内容已明确说明，不允许业务人员以其承诺优惠。
- `insights`：全部署名“AI公开资料研究（待业务团队复核）”，不是公司研究部门已审批的正式观点；不插入未经核实的租金预测或成交量。
- 地图已有租金、空置率及甲乙级数量由动态业务记录计算，本次**没有覆写** `buildings`、`building_metrics`、`quarterly_submissions`、租赁成交或未来供应数据。

## 子市场与主要可追溯来源

| 子市场 | 主要官方或政府转引资料 | 提示 |
| --- | --- | --- |
| CBD | [北京CBD重点产业（2025）](https://www.beijing.gov.cn/fuwu/lqfw/ztzl/bjshwzhx/zhdchyyfw/202510/t20251020_4232021.html) | 总部经济/金融/传媒 |
| 金融街 | [北京金融街园区介绍](https://open.beijing.gov.cn/html/park/financialStreet.html) | 金融管理与金融机构 |
| 丽泽 | [丽泽全域场景化行动计划（2026—2028）](https://www.bjft.gov.cn/xwdt/jcdt/bmdt/202607/t20260722_219939.shtml) | 新金融与科技 |
| 东城商务区 | [东城“十五五”产业布局政策解读](https://invest.beijing.gov.cn/zwgk/zcjd/202610/t20261028_4922022.html) | 东二环总部经济发展带 |
| 中关村 | [中关村“十五五”建设规划](https://www.beijing.gov.cn/zhengce/zhengcefagui/202609/t20260916_4866420.html) | 科创与科技服务 |
| 上地 | [上地三年行动计划（2026）](https://kw.beijing.gov.cn/xwdt/kcyx/xwdtshgg/202610/t20261014_4900938.html) | 软件/AI/工业软件 |
| 北清路 | [北清路医药健康产业项目资讯](https://fgw.beijing.gov.cn/gzdt/fgzs/mtbdx/bzwlxw/202502/t20250211_4007889.htm) | 科研中试/产业园 |
| 四季青 | [四季青镇产业发展工作信息](https://zyk.bjhd.gov.cn/jbdt/auto4555_51851/auto4555_57653/auto4555/auto4555/202511/t20251126_4794517.shtml) | 园区更新；非资金补贴文件 |
| 亚奥 | [奥林匹克中心区“十五五”发展规划解读](https://www.beijing.gov.cn/ywdt/gqrd/202610/t20261015_4903627.html) | 会展/体育/科技商务 |
| 望京-酒仙桥 | [数字视听产业专项行动计划（2026）](https://www.beijing.gov.cn/ywdt/gqrd/202601/t20260127_4469823.html) | 国际研发/文化科技 |
| 燕莎 | [燕莎蓝港商圈融合发展名单](https://www.bjwmb.gov.cn/wmdt/cyq/10113780.html) | 涉外商务及商业配套 |
| 通惠河传媒走廊 | [朝阳数字视听专项行动计划](https://www.beijing.gov.cn/ywdt/gqrd/202601/t20260127_4469823.html) | CBD—定福庄文化传媒产业走廊 |
| 通州 | [城市副中心“十五五”开放型经济政策解读](https://www.beijing.gov.cn/ywdt/gqrd/202609/t20260903_4849279.html) | 财富管理/绿色金融 |
| 亦庄 | [北京经开区2025年度工作报告](https://kfqgw.beijing.gov.cn/zwgkkfq/ghjh/zfgzbg/202605/t20260526_4666777.html) | 先进制造/研发 |
| 丰台科技园 | [丰台园高质量发展若干措施（2026）](https://www.bjft.gov.cn/xxfb/ftzcwj/ftbmwj/202610/t20261019_227653.shtml) | 科技服务/产业园 |
| 玉渊潭 | [玉渊潭公园改造工程2026合同公示](https://ggzyfw.beijing.gov.cn/jyxxgcjshtgs/20260918/5717770.html) | 公共空间更新项目，非招商优惠 |

人口的行政区级数据依据首都之窗2026年公开的对应区政府概况（朝阳、海淀、丰台、东城、西城、通州和大兴〔含经开区〕）；**这些行政区数字不等于办公子市场人口**。完整逐条来源和修改前后快照存于生产库各条 `demographics/policies` JSON 与对应 `audit_logs`。

## 验证与边界

- 生产回读 16/16；区域概况、产业、交通、政策、观点均非空；37 个 JSON 事实/政策链接格式均使用 HTTPS，16 条批量导入审计具有完整 `target_id` 和 `new_values`。
- 生产表启用 RLS，撤销 `anon/authenticated` 对资料表的直接权限；`service_role` 允许查询与写入。页面 API 还需对 `viewer/editor/admin` 执行原有会话认证；管理员编辑按现有服务端权限保护。
- 数据库 `pg_notify('pgrst','reload schema')` 已发送，生产 Vercel 对应 PR #212 代码状态 READY。**尚未以真实登录用户完整执行浏览器内查看与编辑闭环**，不宣称该项通过；用户可直接用地图子市场气泡验证阅读，并由管理员维护信息。
- 安全 Advisor 出现 RLS 无 policy 的 `INFO` 是**刻意的 service_role-only 表设计**：匿名和已登录 PostgREST 直读均被撤权，不要为了消除此提示创建对客户端开放的策略。实际安全与性能仍须按上线后业务观察。
