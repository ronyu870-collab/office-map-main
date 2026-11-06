# 历史项目资料提取库

Supabase 的 public 默认 ACL 会向 service_role 授予 ALL。追加版本的权限契约必须先显式撤销该角色在两张提取表上的所有权限，再只授予 SELECT、INSERT；仅追加 GRANT 不会取消继承的 UPDATE、DELETE、TRUNCATE 或 MAINTAIN。部署按迁移顺序执行，包含 `20261102104720_enforce_material_library_append_only.sql`，并回读有效权限。PG17 回归先设置相同的默认 ALL ACL，再验证真实读写路径及修改、删除、清空被拒。

本库保存已获授权的历史项目资料提取结果，承接现有地图资料表不能容纳的无唯一楼宇、项目整体、设计方案、原文冲突和恢复副本。它不创建跟踪楼宇，不发布当前房源，也不将来源文字自动升级为已核实工程指标。

- `project_material_library`：原件SHA-256、原始文件名/目录、历史性质、人工核清的分项目参数与政策、待核范围以及不可变提取版本。一个原件可有多个提取版本；相同原件/相同payload不重复。
- `project_material_library_pages`：原生文字与OCR分层保存，页码关联到对应提取版本。OCR层必须保留未核实标志，不能直接生成前台事实。排除的非业务凭证只保留归类元信息，不入正文/签名/费用。
- 两表启用RLS，PUBLIC/anon/authenticated无直接访问；现有service_role仅可读取与追加，不能覆盖或删除。当前地图GET不扩大读取范围，不返回原始证据正文或未关联资料。
- 有明确active/tracked楼宇的已复核历史参数/政策继续使用`building_sales_materials`及现有共享schema。无法证实的归属保留在提取库，不借助虚构主键绕过ready限制；未知日期、原单位错误和范围冲突保持。
- 原件仍本地归档，以SHA引用。仅上传提取结果，不上传原始PDF/PPT，也不新增公共原件URL。

`library-batch.mjs`校验分项目内容、全部证据页覆盖与OCR性质；生成分段事务SQL，校验重复内容与回读一致，再写导入审计。元数据/页段中断可重试；只有最终页数和内容摘要核验全部通过，才可报告完整提取库入库完成。资料库入库、地图可见和当前适用是三个不同状态。

验证：`verify-library.mjs`执行导入边界校验；`supabase/tests/material-library/run.mjs`在真实PG17执行实际生成的导入SQL、幂等、不可变版本、角色允许/拒绝、源哈希/证据页、失败回滚与审计场景，随既有Verify CI运行。测试只用合成内容，真实业务资料不进Git。

SQL编译器不持有或建立服务端账号。外部维护工具实际执行时保留Codex工具来源，不把用户授权推定为某员工的操作身份；经正式`ingest.mjs --apply`入口导入仍按现有契约核验显式管理员UUID。本库新增的归档、逐页证据和楼书纠正动作均有专用中文审计文案与标签。
