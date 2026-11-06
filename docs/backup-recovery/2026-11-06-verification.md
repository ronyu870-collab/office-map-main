# 2026-11-06 备份接入与恢复验证

本轮按用户明确范围执行 Supabase数据库+SupabaseStorage→CloudflareR2，不接入阿里云OSS。主线基线08af9bc42d5a67e80a421b4fe8458d521125576d，原备份325b377合入该基线；保留main已有所有业务回归，两个备份工作流仍由缺失的BACKUP_ENABLED阻止运行。

## 代码与回归

- 默认及工作流profile为supabase，仅要求Storage；旧full范围保留兼容，database-only仍为部分归档。范围、清单、完成标记及独立健康检查一致；旧full／部分／未完成归档不能替代supabase完成标记。
- 新增实际PG17的数据库+Storage备份恢复回归，以及相同bootstrap角色的原GRANTED BY／ADMIN／INHERIT／SET恢复回归；接入Verify必需执行路径。
- 13组unit与17组真实原生PG17合成恢复回归通过。Node22.13.0、本机PG17.11，真实源和容器为PG17.6。
- 最终npm run verify退出0：审计覆盖、类型、Lint（0 errors，809 warnings）、161文件／1080测试和生产构建通过。首次全量中一个未修改的成交关闭保护断言失败；同文件独立10/10和最终全量均通过，未改其实现或断言，首次失败日志保留。
- 不以合成恢复或本地verify代替精确PR head的远端CI，也不自动合并或开启定时。

## 真实云端与源读取

用户分别明确授权三个Cloudflare专用凭据、两个main专用Environment及Secrets、备份空前缀30天保留锁，以及数据库和Storage源凭据接入。全部按范围配置；恢复私钥未进入GitHub、Git或R2。数据库URL和官方CA经用户补充明确授权后写入production-backup，之前自动审批拒绝未绕过。

R2加密合成探针真实上传后以独立只读凭据回读，密文哈希与长度一致；重复写入返回409 ObjectLockedByBucketPolicy。未更改业务目录、CORS、生命周期或公开状态。源session pooler的官方CA及主机名严格验证通过，专用数据库登录／只读权限预检通过。Storage完整列举2桶431对象，合计357,320,294字节；服务凭据有写能力，程序仅列举和读取。

独立健康凭据在真实R2验证：只有database-only完成标记与进行中的supabase目录时，健康检查正确失败NO_RECENT_FULL_BACKUP，未误报完整备份。

## 首份真实数据库归档恢复

归档：backups/qhgxougfzzmgqjzzwudf/2026-11-06T11-12-58-903Z-d5a1ea40-3299-4f78-bfdf-79324bb3126d/。profile=database-only，不能据此宣称Storage文件已经恢复。

实际经过导出→age加密→R2上传及回读→独立只读下载→解密和明文哈希核验→全新隔离集群恢复。109张表、49,143行的同快照数量和规范JSON SHA256全部一致；http1.6、pg_stat_statements1.11、pgcrypto1.3、plpgsql1.0、supabase_vault0.3.1、uuid-ossp1.1及其schema一致。

镜像public.ecr.aws/supabase/postgres:17.6.1.155，sha256:3866d94d8426927e8db3f1c5d790752292bfbe27b5f1f46e199ae1b7d3c1710b；实际检查network=none、宿主挂载0、只读根、无生产凭据、丢弃ALL capabilities和no-new-privileges。生产dump未在宿主或共享开发库执行。

首次角色恢复因GRANTED BY supabase_admin没有ADMIN OPTION而失败。官方PG17规则确认bootstrap超级角色是例外，源OID10实际为supabase_admin；匹配该初始化身份并仅跳过已有角色的CREATE后，原角色属性和授权完整重放，恢复通过。没有吞错误或删GRANT；新增回归覆盖此问题。

真实副本另验：备份登录直接写入与高权限反馈RPC均拒绝；anon通过网关同类SET ROLE路径无法读取成交；authenticated管理员实际修改一项成交租金成功，审计仅一项变更、准确old/new和actor一致。所有业务探针回滚，未修改生产业务行。

全文件归档的独立下载、恢复及引用验收由操作者另附执行结果；本页数据库证据不自动代表全系统恢复完成。私钥独立离线副本、失败通知、最终CI与启用确认继续作为正式上线门槛。

## 首次完整运行及依赖隔离

首份完整Storage尝试在文件传输阶段失败，未写完成标记；第二次在列举阶段失败，继续诊断底层HTTP响应。已有数据库归档及恢复证据不变。

PR86首轮搜索覆盖检查失败：根package.json／lock加入备份SDK触发了所有搜索入口的全局回归要求。已将备份依赖及脚本独立到scripts/backup，根package.json／lock恢复主线原件，网页运行依赖不变；未修改覆盖门槛或登记表。隔离后真实执行覆盖检查，4文件／37项通过，全部必需案例通过。两个定时工作流与Verify统一安装该独立lock。

独立运行环境复验：13组unit、17组真实PG17合成恢复、完整npm run verify（161文件／1080项、构建）均退出0；搜索覆盖4文件／37项退出0。只读诊断重新成功列举2桶431对象，现有R2归档可读；尚未据此宣称文件传输错误已解决。

为保证最终合并路径一致，备份分支组合权限PR85的主线同步提交0e5f34e，保留双方记录和两组必需CI步骤。权限PR继续独立审阅，组合提交验证结果分别记录，未合并main。

## Storage中途断流修正

第三次真实完整归档在已复制192个对象后，下一源文件发生TypeError terminated，cause为SocketError／UND_ERR_SOCKET／other side closed；故障在HTTP响应体流中，未发布完成标记。新回归以同类中途断开的ReadableStream复现旧实现失败，原失败日志保留。

仅对已知临时网络错误、超时及408／429／500／502／503／504的只读列举／下载最多尝试3次（250ms、1000ms退避）。SDK包装的originalError同样识别；已有文件独占保护不变，只能截断本次保留的私有临时文件，从字节0重新读取，最终失败清理部分文件。权限、路径、磁盘及完整性错误不重试，R2条件写入不做此类重试。日志只记录固定重试代码与次数，不输出请求或密钥。

16组unit（含中途断流恢复、SDK列举断流／503、403不重试、已有文件保护及3次耗尽不发布完成标记）和17组真实PG17回归通过。完整verify与最终精确head CI继续单独记录。

只读重试修正的完整npm run verify退出0（161文件／1080项及构建）；最后HTTP状态优先级／取消清理微调后，check（审计覆盖、类型、Lint、161文件／1080项）、16组unit和17组原生PG17再次退出0。实际云端完整归档另行验收。
