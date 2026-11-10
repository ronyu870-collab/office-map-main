# Supabase → Cloudflare R2 加密备份

生产范围为 **Supabase 数据库和 Supabase Storage → Cloudflare R2**。11 月 9 日已验证完整归档作为周备份切换基线，原 30 天防删锁继续适用。历史隔离恢复和接入验收见[执行记录](2026-11-06-verification.md)。

## 备份范围与完成条件

默认 BACKUP_PROFILE=supabase：原生PG17 custom archive、pg_dumpall --roles-only --no-role-passwords，以及当前项目Storage全部桶和当前对象。全部非系统表的数量、规范JSON SHA256与dump共用只读repeatable-read快照；没有完整RLS读取能力即失败。Storage前后清单一致才完成，空桶配置也保存。

明文仅在私有临时目录处理，使用age公钥加密后写入R2独立随机目录。源对象已知大小（含Supabase metadata.size）须与下载长度一致。源列举与下载发生已知临时断流／超时或可重试HTTP错误时，最多3次从头读取；权限、磁盘、路径及哈希错误即失败，部分文件不会发布。逐对象上传后回读校验密文SHA256和长度；数据库、角色、全部Storage文件与清单成功后才写complete.json。条件创建和备份前缀锁保护已有对象，程序无覆盖或删除入口。

新清单为profile=supabase、coverage=database-and-supabase-storage，缺Storage清单或对象即拒绝。database-only仍是部分归档。旧full profile仅为原含OSS方案兼容保留；本次工作流不传递OSS凭据，健康检查不接受旧full或database-only替代supabase标记。完成标记始终recoveryReady=false，只证明完整存储；真实恢复验收独立记录。

## 当前接入与权限

- Supabase项目qhgxougfzzmgqjzzwudf，PostgreSQL17.6；首次完整恢复验收2桶481对象，383,567,820字节；导入后只读盘点531对象、396,535,718字节。每份归档以自身清单为准。
- R2账户4440a5c01319452ed211b43521a5bd4f，桶colliers-reports-data；仅backups/qhgxougfzzmgqjzzwudf/设置30天Age锁，业务目录与生命周期未改。
- r2.dev关闭，无自定义公开域。每次管理面预检检查公开状态和锁；公开、未知或缺锁即失败。早期账户Worker盘点为空，不能仅凭CORS推断应用代理。
- 三个独立Cloudflare凭据分别为指定桶对象读写、指定桶对象只读、R2配置元数据读取。对象读写本身有删除能力，保留锁提供期内保护；管理员仍能改锁，并非不可撤销WORM。
- colliers_backup具备pg_read_all_data/BYPASSRLS以完整读取，默认只读、连接上限2，非超级用户／建角色／建库／复制角色，不继承应用身份、不拥有业务对象。严格TLS登录和有效权限预检已通过。

账号预检检查全部非系统schema的有效写权限和可调用高权限函数，仅允许四个正文、owner、语言、类型、search_path一致的稳定只读帮助函数；权限或函数漂移即拒绝，不自动修源库权限。九项PUBLIC EXECUTE前置修复在独立PR#85，已按授权实际执行并回查，函数正文和明确业务授权未变；代码已随PR85合并，且仅对齐已执行迁移20261027155909历史。默认只读不是账号级不可写保证，不能省略该预检。

## GitHub配置

两个Environment仅允许main。健康检查环境不含数据库、Storage或恢复私钥。

| 位置 | 配置 |
| --- | --- |
| production-backup Secrets | BACKUP_DATABASE_URL、BACKUP_PG_CA_PEM、BACKUP_STORAGE_SERVICE_KEY、BACKUP_CF_CONFIG_READ_TOKEN、BACKUP_R2_ACCESS_KEY_ID、BACKUP_R2_SECRET_ACCESS_KEY |
| production-backup Variables | BACKUP_DB_ALLOWED_HOSTS、BACKUP_AGE_RECIPIENT |
| production-backup-health Secrets | BACKUP_CF_CONFIG_READ_TOKEN、BACKUP_HEALTH_R2_ACCESS_KEY_ID、BACKUP_HEALTH_R2_SECRET_ACCESS_KEY |
| repository Variable | BACKUP_ENABLED，true启用、false暂停；按批准的启用／故障处理清单维护 |

数据库使用session pooler、sslmode=verify-full，主机白名单与用户名项目后缀均校验。官方CA由客户端和pg_dump检查证书与主机名，CI将CA写入临时0600文件，结束移除；不关闭TLS校验，不重置业务密码。Storage服务凭据本身有数据写能力，用户明确允许存入专用Environment，备份只列举和读取。

密钥不能进入聊天、公开变量、前端包、SQL源码、命令参数或日志。Supabase管理登录不是pg_dump密码。

## 密钥保管与真实恢复

日常作业只持有age公钥。恢复私钥保存在本机受保护目录与Mac钥匙串，不进入Git、GitHub或R2；用户已确认独立离线副本保存，同机两份不等于异地保管。不要因重跑接入而重新生成或覆盖恢复身份。源连接和Cloudflare专用凭据另有age加密的本机恢复副本。

生产归档含可执行SQL，必须在无生产网络、无生产凭据、无敏感宿主挂载的容器恢复，不能直接放入共享开发库。本轮使用现有public.ecr.aws/supabase/postgres:17.6.1.155，六项扩展版本一致；network=none、只读根文件系统、仅临时内存目录可写、丢弃ALL capabilities、no-new-privileges。

PostgreSQL17要求GRANTED BY指定grantor有ADMIN OPTION，bootstrap超级角色例外。源OID10为supabase_admin，恢复集群须匹配该初始角色。原角色脚本只跳过已有bootstrap角色的CREATE声明，全部ALTER、关系、ADMIN／INHERIT／SET和grantor保留；不得吞SQL错误或删除授权。新导出记录bootstrapRole，合成回归覆盖原授权来源恢复。

使用独立R2只读凭据下载，age解密并逐文件核对密文与明文哈希；恢复后核对全部表数量／内容、扩展、权限允许与拒绝、真实成交编辑审计和Storage文件引用。写入探针只在副本中回滚执行。生产恢复始终单独授权。

## 执行与验证

- 生产 `npm --prefix scripts/backup run create` 只在 main 的备份 Actions 工作流执行。工作流串行运行，不从本机并行调用生产写入；不上传明文 artifact。
- npm --prefix scripts/backup run inspect -- '<完整run前缀>'：以只读R2及BACKUP_IDENTITY_FILE下载、解密、校验后清理，不执行SQL。
- `node scripts/backup/health.mjs`：独立核验周完成标记、加密清单哈希和 R2 对象列表摘要，并生成只读轮换预览。它不能证明已做恢复演练。
- npm --prefix scripts/backup run test:unit：真实age／SDK协议、范围、加密、完整性、分页、覆盖保护及健康检查；云传输为替身。
- BACKUP_TEST_PG_BIN=<PG17目录> npm --prefix scripts/backup run test:postgres：一次性真实PG17导出／恢复、授权来源、RLS、触发器、审计和错误保护；全部合成数据，原生恢复入口拒绝生产配置。

## 调度与恢复边界

- 北京时间周一 02:00 主备份、12:00 同周补跑；同一个周次以周一 02:00 为边界。补跑如果已找到可验证的本周归档则只读退出；否则重新备份。GitHub 可能延迟，时间是计划而不是 SLA。独立健康仍每 6 小时运行，周一 12:00 后缺本周归档或最新快照已超过 7 天即失败。11 月 9 日成功归档以固定标记、清单哈希和对象列表指纹接入首周，无需重复上传。
- 源文件和数据库先在私有临时目录生成并加密，核对源前后清单后才准入上传。5.80 GB（十进制）准入、6.00 GB 备份硬预算；计入该前缀所有已提交对象、失败残留、持久未结预留和本次加密文件及标记。预留对象写入和回读后才上传数据，失败的预留不会因任务退出而释放；仅完整标记或经过批准的清理能释放未用预留。账号其他内容的 4 GB 预算及 10 GB-month 免费额度独立核对。
- 新周归档成功且至少 6 份有效周归档时，健康作业只预览最老一份；只考虑对象全部满 30 天的批次，保留最近 5 份和 11 月 6 日已演练归档。失败、无本周完成、清单不一致或候选未解锁时不生成可执行轮换。历史日备和失败残留不混入每周计数；按另行审阅的名单在解锁后处理。
- `node scripts/backup/retention.mjs preview` 使用现有 R2 只读和配置只读凭据生成完整名单和 SHA256。首次生产删除按名单另行确认；获批后本地 `retention.mjs apply <完整run前缀> <预览摘要>` 重新验证当前状态、计划、精确 30 天锁及对象年龄。需要临时 R2 session（`BACKUP_ROTATION_ACCESS_KEY_ID`、`BACKUP_ROTATION_SECRET_ACCESS_KEY`、`BACKUP_ROTATION_SESSION_TOKEN`）仅覆盖这一归档；不得用长期全桶凭据，不能在 Actions 中 apply。操作端固定使用同一私有 0700 目录 `BACKUP_ROTATION_JOURNAL_DIR`；本周审计文件写入并同步后先删完成标记、核对消失，再删其余对象。中断保留清单与本周排他记录，剩余对象只按原批准名单人工核对续做。自动删除尚未启用，直到第一份实际候选和限权凭据通过核验。
- 失败在 Actions 和脱敏 summary 可见，沿用维护者已开启的失败通知。备份上限不足会告警且不上传；不为腾空间降低防删锁或移除受保护恢复点。没有设置覆盖整个前缀的到期删除策略。

临时明文权限0600、目录0700，结束清理；强制终止或掉电不保证安全擦除，依赖受保护磁盘及一次性runner。数据库和Storage没有跨服务原子快照，前后清单不能保证任意并发下的应用时间点一致性。平台OAuth／SMTP／JWT／API密钥、角色密码、外部设置、对象版本历史及Vault根密钥需要单独保护；当前Vault0行，未来密文须另证可解密。本次不接入其他云文件源。

官方依据：[pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html)、[GRANT](https://www.postgresql.org/docs/17/sql-grant.html)、[Supabase备份](https://supabase.com/docs/guides/platform/backups)、[恢复依赖](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)、[R2兼容](https://developers.cloudflare.com/r2/api/s3/api/)、[Bucket Lock](https://developers.cloudflare.com/r2/buckets/bucket-locks/)。

备份依赖独立锁定在scripts/backup/package.json及package-lock.json；安装使用npm ci --prefix scripts/backup --ignore-scripts，不修改网页应用的依赖或脚本。CI与定时备份使用同一独立运行环境。

## R2回读与失败诊断

GET响应体流失败发生在SDK返回响应之后，SDK的请求重试不能覆盖这一步。回读仅对已知临时网络错误限3轮从字节0重读（每轮SDK请求最多2次，总请求尝试上限6次），目的文件先以wx／0600独占保留；已有文件不发送GET、不覆盖。失败清理本次部分文件，403、路径／磁盘／大小／哈希错误不重复读取。PUT仍使用条件创建，回读耗尽不得发布完成标记。

CLI失败JSON含固定stage及允许的code、httpStatus、transportCode、ioCode；不输出原始message、stack、请求、SQL、路径或业务对象名。阶段区分源下载、R2上传／回读、清单复核和完成标记写入；新增诊断不把历史BACKUP_FAILED自动解释为已修复。
