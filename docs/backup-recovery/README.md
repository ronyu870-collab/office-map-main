# Supabase → Cloudflare R2 加密备份

日期：2026-11-06。用户明确本次范围为 **Supabase数据库和Supabase Storage → Cloudflare R2**。定时仍关闭，合并与启用分别确认；真实执行证据见[本轮记录](2026-11-06-verification.md)。

## 备份范围与完成条件

默认 BACKUP_PROFILE=supabase：原生PG17 custom archive、pg_dumpall --roles-only --no-role-passwords，以及当前项目Storage全部桶和当前对象。全部非系统表的数量、规范JSON SHA256与dump共用只读repeatable-read快照；没有完整RLS读取能力即失败。Storage前后清单一致才完成，空桶配置也保存。

明文仅在私有临时目录处理，使用age公钥加密后写入R2独立随机目录。逐对象上传后回读校验密文SHA256和长度；数据库、角色、全部Storage文件与清单成功后才写complete.json。条件创建和备份前缀锁保护已有对象，程序无覆盖或删除入口。

新清单为profile=supabase、coverage=database-and-supabase-storage，缺Storage清单或对象即拒绝。database-only仍是部分归档。旧full profile仅为原含OSS方案兼容保留；本次工作流不传递OSS凭据，健康检查不接受旧full或database-only替代supabase标记。完成标记始终recoveryReady=false，只证明完整存储；真实恢复验收独立记录。

## 当前接入与权限

- Supabase项目qhgxougfzzmgqjzzwudf，PostgreSQL17.6；当前盘点2桶431对象，357,320,294字节。
- R2账户4440a5c01319452ed211b43521a5bd4f，桶colliers-reports-data；仅backups/qhgxougfzzmgqjzzwudf/设置30天Age锁，业务目录与生命周期未改。
- r2.dev关闭，无自定义公开域。每次管理面预检检查公开状态和锁；公开、未知或缺锁即失败。早期账户Worker盘点为空，不能仅凭CORS推断应用代理。
- 三个独立Cloudflare凭据分别为指定桶对象读写、指定桶对象只读、R2配置元数据读取。对象读写本身有删除能力，保留锁提供期内保护；管理员仍能改锁，并非不可撤销WORM。
- colliers_backup具备pg_read_all_data/BYPASSRLS以完整读取，默认只读、连接上限2，非超级用户／建角色／建库／复制角色，不继承应用身份、不拥有业务对象。严格TLS登录和有效权限预检已通过。

账号预检检查全部非系统schema的有效写权限和可调用高权限函数，仅允许四个正文、owner、语言、类型、search_path一致的稳定只读帮助函数；权限或函数漂移即拒绝，不自动修源库权限。九项PUBLIC EXECUTE前置修复在独立PR#85，已按授权实际执行并回查，函数正文和明确业务授权未变；代码合并与迁移历史对齐分别记录。默认只读不是账号级不可写保证，不能省略该预检。

## GitHub配置

两个Environment仅允许main。健康检查环境不含数据库、Storage或恢复私钥。

| 位置 | 配置 |
| --- | --- |
| production-backup Secrets | BACKUP_DATABASE_URL、BACKUP_PG_CA_PEM、BACKUP_STORAGE_SERVICE_KEY、BACKUP_CF_CONFIG_READ_TOKEN、BACKUP_R2_ACCESS_KEY_ID、BACKUP_R2_SECRET_ACCESS_KEY |
| production-backup Variables | BACKUP_DB_ALLOWED_HOSTS、BACKUP_AGE_RECIPIENT |
| production-backup-health Secrets | BACKUP_CF_CONFIG_READ_TOKEN、BACKUP_HEALTH_R2_ACCESS_KEY_ID、BACKUP_HEALTH_R2_SECRET_ACCESS_KEY |
| repository Variable | BACKUP_ENABLED，当前缺失；最终验收和用户确认后才设true |

数据库使用session pooler、sslmode=verify-full，主机白名单与用户名项目后缀均校验。官方CA由客户端和pg_dump检查证书与主机名，CI将CA写入临时0600文件，结束移除；不关闭TLS校验，不重置业务密码。Storage服务凭据本身有数据写能力，用户明确允许存入专用Environment，备份只列举和读取。

密钥不能进入聊天、公开变量、前端包、SQL源码、命令参数或日志。Supabase管理登录不是pg_dump密码。

## 密钥保管与真实恢复

日常作业只持有age公钥。恢复私钥保存在本机受保护目录与Mac钥匙串，不进入Git、GitHub或R2；用户的独立离线副本仍待确认，同机两份不等于异地保管。不要因重跑接入而重新生成或覆盖恢复身份。源连接和Cloudflare专用凭据另有age加密的本机恢复副本。

生产归档含可执行SQL，必须在无生产网络、无生产凭据、无敏感宿主挂载的容器恢复，不能直接放入共享开发库。本轮使用现有public.ecr.aws/supabase/postgres:17.6.1.155，六项扩展版本一致；network=none、只读根文件系统、仅临时内存目录可写、丢弃ALL capabilities、no-new-privileges。

PostgreSQL17要求GRANTED BY指定grantor有ADMIN OPTION，bootstrap超级角色例外。源OID10为supabase_admin，恢复集群须匹配该初始角色。原角色脚本只跳过已有bootstrap角色的CREATE声明，全部ALTER、关系、ADMIN／INHERIT／SET和grantor保留；不得吞SQL错误或删除授权。新导出记录bootstrapRole，合成回归覆盖原授权来源恢复。

使用独立R2只读凭据下载，age解密并逐文件核对密文与明文哈希；恢复后核对全部表数量／内容、扩展、权限允许与拒绝、真实成交编辑审计和Storage文件引用。写入探针只在副本中回滚执行。生产恢复始终单独授权。

## 执行与验证

- npm --prefix scripts/backup run create：创建加密归档，无生产恢复或删除命令，不上传明文Actions artifact。
- npm --prefix scripts/backup run inspect -- '<完整run前缀>'：以只读R2及BACKUP_IDENTITY_FILE下载、解密、校验后清理，不执行SQL。
- node scripts/backup/health.mjs：默认要求30小时内supabase完成标记，不能证明可恢复。
- npm --prefix scripts/backup run test:unit：真实age／SDK协议、范围、加密、完整性、分页、覆盖保护及健康检查；云传输为替身。
- BACKUP_TEST_PG_BIN=<PG17目录> npm --prefix scripts/backup run test:postgres：一次性真实PG17导出／恢复、授权来源、RLS、触发器、审计和错误保护；全部合成数据，原生恢复入口拒绝生产配置。

## 调度与恢复边界

计划每日北京时间02:00备份，每6小时独立检测；GitHub调度可能延后。首次真实完整备份、隔离恢复、离线私钥副本及失败通知验收后，再由用户确认main合并和BACKUP_ENABLED=true。新鲜度失败不会自动恢复或改生产。

失败在GitHub Actions及脱敏summary可见，维护者的Actions通知仍需实际确认，没有接通外部邮件／Slack。失败重试使用新目录，不删旧快照；没有完成标记的对象不是恢复点。当前没有自动删除策略，后续生命周期单独审阅。

临时明文权限0600、目录0700，结束清理；强制终止或掉电不保证安全擦除，依赖受保护磁盘及一次性runner。数据库和Storage没有跨服务原子快照，前后清单不能保证任意并发下的应用时间点一致性。平台OAuth／SMTP／JWT／API密钥、角色密码、外部设置、对象版本历史及Vault根密钥需要单独保护；当前Vault0行，未来密文须另证可解密。本次不接入其他云文件源。

官方依据：[pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html)、[GRANT](https://www.postgresql.org/docs/17/sql-grant.html)、[Supabase备份](https://supabase.com/docs/guides/platform/backups)、[恢复依赖](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)、[R2兼容](https://developers.cloudflare.com/r2/api/s3/api/)、[Bucket Lock](https://developers.cloudflare.com/r2/buckets/bucket-locks/)。

备份依赖独立锁定在scripts/backup/package.json及package-lock.json；安装使用npm ci --prefix scripts/backup --ignore-scripts，不修改网页应用的依赖或脚本。CI与定时备份使用同一独立运行环境。
