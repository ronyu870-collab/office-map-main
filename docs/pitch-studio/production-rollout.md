# Pitch Studio 生产启用记录

日期：2026-11-26。目标数据库：`qhgxougfzzmgqjzzwudf`；应用：Vercel `colliersdata`，域名 [www.colliersdata.com](https://www.colliersdata.com)。本记录补充前六阶段的历史交付状态，不改变内容、身份、数据及披露协议。

## 已完成的数据库变更

用户已明确授权将六阶段合并 main，并继续执行必要生产迁移及功能启用。代码基线为 PR [#315](https://github.com/ronyu870-collab/office-map-main/pull/315)，main `52f1fe5a2858ddeef1a1baeb648a22b502f2ac41`。其应用代码树与已通过完整工程、PG17、真实 Auth／HTTP、浏览器功能及构建验证的集成提交相同。

通过 Supabase 官方 Management API 的 migration endpoint，按顺序原子应用以下七份仓库迁移。API 生成的生产版本号与源码时间戳不同；不能据此删除或重写已成功的历史。

| 源码迁移（`supabase/migrations/`） | 生产版本 | 名称 |
| --- | --- | --- |
| `20261125152942_ai_control_center.sql` | `20261126055657` | ai_control_center |
| `20261125165826_pitch_studio_foundation.sql` | `20261126055658` | pitch_studio_foundation |
| `20261125174626_pitch_studio_render_engine.sql` | `20261126055659` | pitch_studio_render_engine |
| `20261125182357_pitch_studio_material_library.sql` | `20261126055701` | pitch_studio_material_library |
| `20261125192547_pitch_studio_business_templates.sql` | `20261126055702` | pitch_studio_business_templates |
| `20261125201503_pitch_studio_workspace.sql` | `20261126055703` | pitch_studio_workspace |
| `20261126090000_pitch_studio_ai.sql` | `20261126055704` | pitch_studio_ai |

回读确认：25 张 public Pitch 表及 16 张 private Pitch 表均启用 RLS；`pitch-studio-private` 存储桶为私有，文件上限 24 MiB。未向正式素材库填入虚构公司、人员或客户案例。AI 控制中心迁移是共用运行时依赖，执行该迁移不代表启用外部模型。

## 启用范围与应用部署

数据库 `private.pitch_control.enabled` 已开启。仅为提出上线请求的现有管理员账号授予 `colliers-china / 华北 / 北京 / 研究` 的内部检索及生成权限，有效期至 2027-02-24；不新增账号，不改变原员工身份或普通业务数据权限。管理员维护能力来自其现有角色。对客导出、外部 AI 权限仍为 false；AI 任务配置保持默认关闭，也未创建资料外传授权。

Vercel Production 已添加 `PITCH_STUDIO_ENABLED=true`。开关变更须在新的 Production 构建后生效，不能把环境变量保存等同于上线成功。此记录的 main 合并沿用项目现有 Git 自动部署链路；必须回读实际生产入口及功能结果再对外报告完成。

入口：[/intelligence/pitch](https://www.colliersdata.com/intelligence/pitch)。须使用获权账号正常登录，匿名访问不能读取素材或私人项目。内部导出与对客披露是独立许可，不能以内部上线替代客户材料披露审批。

## 实际检查与限制

生产数据库已验证：本人生成授权允许；伪造 session、跨范围、无授权账号拒绝；对客及外部 AI 未授予；匿名表读取拒绝；service role 不能直接写入业务表，领域 RPC 仅供服务端执行。完整应用执行回归复用上述相同代码版本的隔离环境证据；它不代替生产部署后的在线冒烟检查。

Supabase advisors 比对无新增 ERROR、无新增安全 WARN。新增安全 INFO 为预期的 deny-all／RPC 专用 RLS 表提示；不能添加宽松策略消除提示。性能新增 24 项 `auth_rls_initplan` WARN，以及外键索引和新空表未使用索引的 INFO；目前未据此额外变更生产策略或索引，后续按实际查询性能优化。

- [RLS initplan 建议](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan)
- [RLS 无策略提示](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
- [迁移历史与部署说明](https://supabase.com/docs/guides/deployment/database-migrations)

企业素材库初始为空，需导入、确认并发布真实获权素材。动态模板继续服从已有正式数据和导出权限；地图、Stacking Plan 等未开放能力仍按业务模板目录显示，不因上线而伪造数据。未进行真实付费模型调用，也未向外部模型发送私有材料。

## 停用与后续维护

紧急停用优先关闭数据库 Pitch control，服务端后续操作会重新验证；应用开关关闭并重建可同时移除导航入口。撤销具体 grant 可停止对应用户后续读取、生成和下载，不删除其历史审计及原件。保留迁移及存储，不通过 DROP TABLE 或删除迁移记录回滚上线。

未来部署应先读取远端迁移历史并按上表识别已应用名称；不可仅按源码时间戳判断七份迁移未运行。扩大账号／区域、对客披露或外部 AI 范围时分别核对相应授权，不默认继承本次内部启用。
