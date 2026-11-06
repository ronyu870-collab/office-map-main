# 备份身份函数权限修复回归

日期：2026-10-28｜本地实现；生产应用、备份接通与真实生产归档恢复分别验收。

现有 `PUBLIC EXECUTE` 允许独立读表身份通过反馈高权限函数间接写入。补丁只从九个已核实函数移除 PUBLIC EXECUTE，保留所有明确角色授权；不改函数正文、表／列权限、RLS、触发器、默认授权、用户角色或业务数据。四个只读权限／期间帮助函数保持原样，不用宽泛的全库 REVOKE。原有反馈接口的 anon／authenticated／service_role 授权均保留，匿名请求仍受函数内部身份检查。

| 函数 | 现有调用／保护 |
| --- | --- |
| public.feedback_mark_read(uuid) | 反馈前台和管理页已读；保留 authenticated 明确授权和归属校验 |
| public.feedback_admin_reply(uuid,text,text[],text) | 管理员回复／状态；保留管理员校验、嵌套已读与状态／活动触发器 |
| public.feedback_reopen(uuid,text) | 原反馈人重开；保留原归属、状态、备注与历史 |
| public.feedback_comment_touch_activity() | 既有评论 INSERT 触发器；只改公共函数执行授权 |
| public.feedback_prepare_status_change() | 既有状态 UPDATE 触发器；保留解决／重开字段处理 |
| public.feedback_record_status_change() | 既有状态历史触发器；保留系统评论与活动时间 |
| private.audit_lease_transaction_update() | 既有成交 UPDATE 审计；保留前后快照、准确字段计数及原子失败 |
| private.fill_update_draft_identity_period() | 既有草稿 INSERT／UPDATE 触发器；保留用户与期间填充 |
| private.handle_new_user() | 既有 Auth 用户 INSERT 触发器；保留 viewer 默认资料创建 |

迁移带5秒锁等待／30秒语句超时，校验函数存在、owner、SECURITY DEFINER、函数类型与已审阅正文摘要；三个业务 RPC 必须已有 authenticated 的明确授权。定义或授权漂移即整笔回滚。正文摘要是版本前置条件，不是加密安全校验；后续改变函数正文时应重新审阅，不删除前置检查来强行应用。重复应用不新增权限差异。

`function-baseline.json` 与 `security-baseline.json` 是目标的13个相关函数定义／ACL元数据，不含业务行、用户身份或凭据；测试会核对历史迁移加载的反馈／审计函数正文与盘点一致，缺失依赖使用合成结构。它们不是全库恢复副本。主版本 PG17、PostgREST16.5；生产网关版本与真实用户会话仍未由此证明。

`node supabase/tests/backup-permissions/run.mjs` 复用 localhost-only PG17 专用临时数据库入口，要求CI或 `LEASE_TEST_ALLOW_LOCAL=disposable` 与专用 `LEASE_TEST_PG_PORT`。结束删除合成数据库与临时角色；不接受生产 URL 或 ambient PG 凭据。实际 PostgREST 必需，从 `POSTGREST_PATH` 或 PATH 加载，没有跳过开关。

16组执行回归覆盖：原错误真实复现；正文漂移／业务授权缺失时整笔回滚；迁移前后业务行、函数正文／owner、表权限／RLS和触发器不变；九项PUBLIC撤销且明确授权不变；真实原生备份身份无法调用、提权、直接写或绑定高权限触发器；完整读取保持；普通用户已读、其他人／匿名拒绝、管理员回复／解决、原用户重开、嵌套函数和三类反馈触发器；失败数据保持；注册资料、草稿和成交审计；重复应用；真实Supabase SDK→JWT验证→PostgREST→PG的回复／已读／重开／回读及越权／错误JWT拒绝。

Verify 已接入本命令。Linux网关来自官方固定v16.5发布资产，先验证官方API读取的SHA256再解包；下载／摘要不符／启动失败即CI失败。应用verify与精确head CI分别记录，不能以静态SQL或现有绿色检查代替本命令。

## 生产接入与回退

应用前重新读取九个函数正文／owner／ACL与触发器，核实前置条件和全部正常调用方；保存权限前像、业务行集合摘要及回退内容，取得生产权限变更确认。不得用未授权生产写入测试替代隔离回归。备份身份还须核对继承、表／列、schema创建权限与其他可执行高权限入口，不能称本补丁保证所有未来角色和函数永远不可写。

若确需回退，先停用新增备份身份登录并停止使用其凭据，按权限前像仅恢复本批九项PUBLIC EXECUTE；不重置业务密码、不覆盖业务行、不删除审计或触发器。回退会恢复已知间接写入边界，只作紧急兼容撤回，不是日常备份方案。不能在备份凭据仍可使用时先恢复PUBLIC授权。

生产备份／恢复、GitHub启用和密钥配置均为后续独立步骤；真实归档须在匹配扩展、无生产写入通道的环境恢复，最终由用户确认上线。

2026-11-06：用户已明确授权实际生产ACL修复，9项PUBLIC EXECUTE撤销已执行并核验；函数正文与明确角色授权不变。该事实不代表PR已合并或迁移历史已记录，定时备份仍关闭。此次同步main保留全部必需CI，直接Node入口避免改变网页根脚本。

最新主线合并后，16组真实PG17及SDK／PostgREST执行回归再次通过；生产业务行未参与该合成测试。完整verify与精确CI结果在本轮交付记录中分别保留。
