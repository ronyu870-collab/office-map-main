# R2 加密备份与恢复操作说明

日期：2026-10-27｜当前：本地实现与合成数据真实恢复验证通过，待审阅、未上线；生产归档恢复与云端接入未验收。

本专项负责备份来源、加密、完整性、定时检测与恢复验收。授权、真实执行与提交门槛继续执行 ARCH-03、VERIFY-03 和仓库 AGENTS。上传成功不能作为系统可恢复的证明。

## 范围与当前证据

| 项目 | 实现与边界 |
| --- | --- |
| 数据库 | 原生 PG17 custom archive；与行级校验共用只读 repeatable-read snapshot。全部非系统表的数量和规范 JSON SHA256 在同一快照采集；没有 RLS 绕过权限即失败，不导出被 RLS 过滤的部分数据冒称完整 |
| 角色 | 单独 `pg_dumpall --roles-only --no-role-passwords`；角色全局配置与数据库不是同一个原子快照；角色密码另行保护 |
| 文件 | Supabase Storage 全桶递归分页、OSS 当前对象分页及流式读取；前后清单一致才完成。空 Storage 桶也记录。对象版本历史、OSS 桶权限／CORS 等配置需要单独保护 |
| 加密与存储 | age 公钥加密；独立运行目录和随机对象名；条件创建禁止覆盖；逐对象下载核对密文 SHA256／字节数，全部必要项目成功才写 complete.json |
| 检测 | 每日备份工作流、每 6 小时独立新鲜度工作流，均默认关闭；超过 30 小时无 full 完成标记即失败。新鲜度不代替恢复演练 |
| 测试恢复 | 合成数据恢复到全新 PG17 集群，独立私有 Unix socket；回归检查准确行值、角色、RLS、允许／拒绝、触发器、审计与文件。原生入口拒绝生产配置 |
| 生产恢复 | 尚未实现自动恢复入口；真实归档必须在独立、无生产访问能力的环境中演练并记录。禁止把生产 dump 当可信脚本直接放入开发机或共享测试数据库执行 |

12 组无网络单元／协议回归已通过，使用已安装的 AWS、Supabase、OSS SDK 和真实 age；数据库导出在该套测试中明确为替身。原生 PG17 集成回归起初被共享内存权限和两次自动审批超时阻断；服务恢复后已完成 15 组执行测试，包括实际快照导出、加密／下载、全新集群恢复、数据与角色／RLS／触发器／审计／文件核对，扩展版本不匹配时阻止演练成功，以及候选备份账号的直接写入拒绝／PUBLIC 高权限函数间接写入风险与显式调用授权保护。已接入 Verify，尚未取得精确 head CI 证据。合成测试不替代真实生产归档恢复。

目标账户与桶的六项管理面 GET 已实际核验：r2.dev 关闭、无自定义域、无桶锁，生命周期仅中止未完成分片；CORS 允许业务域的 GET／PUT／HEAD。对应预检遇到公开、未知响应或缺锁均失败退出，目前缺锁应阻止首次上传。Worker／应用代理、真实 S3 对象读写、源数据库导出权限、Storage／OSS 凭据和生产归档恢复均未验证。未修改桶规则或公开状态。

## 备份内容与恢复依赖

数据库包含 pg_dump 可导出的业务表、Auth 数据、自定义权限／函数／触发器、迁移表及旧季度 schema；默认不主动排除托管 schema。表级权限不足、服务端版本不是 17、锁等待或导出错误都会阻止完成。数据库扩展需要匹配的 Supabase／PostgreSQL 目标；普通 PG17 不一定能够恢复托管扩展。

以下不因数据库 dump 成功而变为已保护：Supabase 项目设置、SMTP／OAuth／JWT／API 密钥、角色密码、Vault／加密列的根密钥、外部平台配置、对象历史版本。当前只读盘点 Vault 为 0 行；后续快照若有相关密文，仍须另行证明可解密。完成标记均为 `recoveryReady: false`，实际恢复验证独立记录；不能简单删除该标记来宣称闭环。清单同时记录同快照的扩展名称／版本／schema，恢复时核对一致性。

数据库和两个对象服务之间没有原子快照。清单保存采集窗口并检测可观察的文件变化；这不保证并发写入下的应用级时间点恢复。真实演练须验证业务引用与对应文件；必要时经授权安排短暂业务静默窗口。

## 安全配置与启用顺序

1. 先通过本地原生恢复回归和精确 PR head 的 Verify，再按用户确认合并。本地恢复回归已通过；提交审阅与精确 head CI、生产启用仍分别判断。
2. 登录 Cloudflare，核对账户 `4440a5c01319452ed211b43521a5bd4f`、桶 `colliers-reports-data` 的用途与访问现状。程序预检覆盖 r2.dev 与自定义域，还须核对 Worker／应用代理是否公开提供桶内容。若桶公开，不能直接改为私有影响现有资料；需用户确定专用私有目标。不要因目录名叫 backups 就认为公开桶中的目录是私有的。
3. 在可信的独立保管环境生成 age 身份：`age-keygen -o backup-age-identity.txt`。私钥保持 0600，进入组织密码库或其他受保护托管，并有独立恢复副本；不要放 Git、聊天、R2 或日常备份作业的 Secrets。公钥用 `age-keygen -y backup-age-identity.txt` 提取。本次已按用户选择存入 Mac 钥匙串并完成回读解密自测；用户自行保存的离线副本尚未确认。不要因重新运行接入流程而另生成密钥或覆盖已有恢复项。
4. 通过 GitHub Settings 的受保护 environment 配置下表所需凭据。不要在聊天中粘贴连接密码或密钥；不要用 `NEXT_PUBLIC_`。备份作业只拿公钥；独立恢复操作临时拿私钥。
5. 只读审查目标桶现状，单独确认备份前缀的保留规则。程序要求覆盖 `backups/qhgxougfzzmgqjzzwudf/` 的至少 30 天 Age Bucket Lock；不自动设置、更改或删除规则。现有文件前缀不应被误锁或误删；先审阅再配置。
6. 首次运行只读源库／文件并向目标新增密文。使用只读 R2 恢复凭据执行下载、解密和哈希检查；再在隔离环境做真实恢复和关键业务验收。未通过前，不启用每日作业，也不解除业务修复上线门槛。
7. 验收通过后单独确认把 repository variable `BACKUP_ENABLED` 设为 `true`。该开关同时启用每日备份与独立新鲜度检测；未配置或不为 true 时作业跳过。首次启用前确保有近期 full 完成标记，以免检测立即告警。

桶锁规则不会由代码上传。Cloudflare 管理员可以改锁规则；它不等于不可撤销的合规 WORM。R2 对象读写凭据通常具有桶级读写／删除能力，不能仅凭代码没有 DELETE 就称凭据无删除权限。使用专用桶、最小授权和独立管理权限；备份前缀锁提供保留期内的额外保护。

## 数据库账号接入前置条件

当前没有可用的原生数据库连接凭据；不能把管理面 OAuth 当作 pg_dump 密码，也不重置现有业务密码。候选备份身份尚未在生产创建。

`pg_read_all_data`、BYPASSRLS 与默认只读足以支持完整读取，但并不构成账号级不可写保证：已有 PUBLIC SECURITY DEFINER 函数仍可能允许间接写入，原生连接还可以设置自定义应用身份变量。三组真实 PG17 合成测试已复现此风险，验证仅从单个账号 REVOKE 不能抵消 PUBLIC 授权；限制为明确应用角色后，备份身份被拒绝而允许的调用方仍可执行。测试只证明该保护方式，未改变生产函数权限。

创建生产备份身份前，须单独盘点实际可调用的高权限函数与继承权限，确定允许调用方并执行真实业务回归；任何必要的函数 ACL 修复须独立审阅、确认及发布。不得在备份配置中悄悄收紧业务权限，也不得把管理员密码替换成所谓只读连接来跳过此条件。权限迁移在独立 [PR #85](https://github.com/ronyu870-collab/office-map-main/pull/85) 审阅，不能由本批自动应用。

导出程序已加入实际账号预检，在源库只读快照中检查：直接登录、默认只读、非超级用户／建角色／建库／复制权限、必要RLS完整读取能力、角色继承、业务表／序列拥有权、表／列／序列写权限、schema创建权。可调用的高权限函数只允许四个已审阅的SQL稳定只读帮助函数，正文、owner、类型及search_path必须匹配。新增可调用高权限函数或配置漂移即失败，预检不自动修源库权限。真实PG测试覆盖实际导出路径的通过／拒绝、函数和search_path漂移、列写、序列推进及角色继承。

## 受保护配置

`production-backup` environment：

| 名称 | 类别／含义 |
| --- | --- |
| BACKUP_DATABASE_URL | Secret；源库直连或 session pooler URL。密码按 URL 编码，使用 `sslmode=verify-full`；不用 transaction pooler |
| BACKUP_PG_CA_PEM | Secret；从源平台核实的 CA 链。运行时写入临时 0600 文件，结束移除 |
| BACKUP_DB_ALLOWED_HOSTS | Variable；明确允许的完整主机名，逗号分隔；项目直连域名或 pooler 用户还须匹配 project ref |
| BACKUP_AGE_RECIPIENT | Variable；age 公钥，不能是私钥 |
| BACKUP_CF_CONFIG_READ_TOKEN | Secret；只读查询桶公开配置和锁，不能改管理设置 |
| BACKUP_R2_ACCESS_KEY_ID / BACKUP_R2_SECRET_ACCESS_KEY | Secrets；只限指定备份桶的对象读写。回读校验需要读权限；不能扩大到所有桶 |
| BACKUP_STORAGE_SERVICE_KEY | Secret；可完整读取目标项目 Storage 的服务端凭据；因平台权限模型可能同时具有写能力，须严格限制任务接触面 |
| BACKUP_OSS_ACCESS_KEY_ID / BACKUP_OSS_ACCESS_KEY_SECRET | Secrets；只读列举／读取指定源桶对象，不授予删除、上传或桶管理权限 |
| BACKUP_OSS_REGION / BACKUP_OSS_BUCKET | Variables；源 OSS 实际 region／桶。不能把 R2 同名桶误认作源 OSS |

`production-backup-health` environment 只配配置查询 token 和只读 R2 凭据：`BACKUP_HEALTH_R2_ACCESS_KEY_ID`、`BACKUP_HEALTH_R2_SECRET_ACCESS_KEY`。不要复制数据库、Storage、OSS 或恢复私钥到检测任务。

`BACKUP_ENABLED` 是 repository variable；两个工作流的 job gate 在进入 environment 前读取。首次启动前核对 environment 分支限制仅允许 main，保护工作流修改；人工 approval 若要求每次审批会阻止无人值守定时任务，需根据实际审批流程明确设置。

## 执行与失败处理

生产入口 `npm run backup:create` 仅支持创建加密备份，没有 synthetic 标志、删除、改权限或生产恢复命令。命令仅输出状态、运行 ID、profile 和脱敏错误码；不上传 Actions artifact，不输出 SQL／明文文件／连接字符串。正常结束和捕获错误会删除私有暂存；强制杀进程或机器掉电时仍依赖受保护临时盘及一次性 runner 清理，不能承诺安全擦除。

定时草案为北京时间每日 02:00（UTC 18:00），GitHub 定时任务可能延后。作业失败会在 GitHub 显示失败及脱敏 summary；需实际配置并验证维护者的 GitHub Actions 通知。外部邮件／Slack 告警未接通，用户给出的 Cloudflare 联系邮箱没有被用于发送通知。

`node scripts/backup/health.mjs` 要求 30 小时内存在 full 完成标记；database-only 不计入。`npm run backup:inspect -- '<完整 run 前缀>'` 用只读 R2 连接与 `BACKUP_IDENTITY_FILE`（仅私钥文件路径）下载、解密并核对全部归档／对象哈希，然后清理明文；它不执行 SQL，也不标记恢复成功。

失败后保留已有快照；同一 key 不能覆盖，重试产生新的运行 ID。中途中断的无完成标记对象不是恢复点，不会自动清理。排查错误码时不扩大权限、关闭 TLS、停用 RLS 或把错误吞掉以求成功。

## 保留与定期演练

当前没有任何自动删除和覆盖逻辑。初期保留全部；至少 30 天锁规则确认后，可另外讨论近 30 天每日与长期月度快照的容量／生命周期方案。生命周期只在取得实际配置与删除范围确认后另行实施，不使用 AWS S3 versioning／Object Lock API 代替 R2 原生机制。

CI 的每次合成数据恢复是防代码回归；定期从真实 R2 快照恢复的演练仍待首次真实接入后实施。建议每月及高风险发布前演练，准确记录版本、run ID、角色、数据／文件引用、Vault 解密、业务动作、耗时和缺项。恢复演练环境必须与生产隔离，归档 SQL 不能接触生产凭据、生产网络或宿主机敏感目录；不能直接复用共享测试库恢复 globals.sql。

完整验收应同时具备：近期加密备份、可信的独立私钥副本、实际下载解密、隔离真实恢复、权限与审计业务回归、文件引用核对、失败通知、保留规则检查，以及明确的生产恢复决策与回退步骤。任何一项缺失均继续记录，生产恢复始终独立人工授权。

## 验证入口

- `npm run test:backup:unit`：真实 SDK 的序列化／签名／分页、age 加解密、校验、错误密钥、损坏、失败无完成、覆盖保护、清单缺项、源变化与新鲜度；传输层是替身，不连接真实云端。
- `BACKUP_TEST_PG_BIN=<PG17 bin目录> npm run test:backup`：必须有 initdb、pg_ctl、pg_dump、pg_dumpall、pg_restore、psql 以及 age／age-keygen；使用自有临时集群，不接收已有数据库地址。
- `npm run verify`：应用既有门槛；Verify 工作流另外执行两套备份回归。所有必需证据通过前不得合并。

官方依据：[pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html)、[Supabase 备份范围](https://supabase.com/docs/guides/platform/backups)、[Supabase 恢复依赖](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)、[R2 S3 兼容](https://developers.cloudflare.com/r2/api/s3/api/)、[Bucket Lock](https://developers.cloudflare.com/r2/buckets/bucket-locks/)。API 实际连接证据单独保存，文档链接不等于本账户已验证。
