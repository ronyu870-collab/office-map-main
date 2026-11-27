# Colliers AI 可靠性评测

本轮基线为执行时取得的最新 `origin/main`：`9e0c33ababc40140675c6ad13674e4aeb636a6ba`。历史 `4833df3` 只用于调查线索。复用干净的 AI 工作区，分支 `codex/ai-reliability-evaluation`；未带入其他地图／销控工作区的修改。成果、失败证据和未验证范围见 [本轮报告](report.md)。

## 冻结支持契约

正式产品仍仅真实 admin 本人及其独立资格可用。评测不新增资格、数据域或生产配置。正常业务入口与首页定位不变；自然语言仍由原模型和受控工具处理，新增有界查证防线不能被解释成完整自然语言分类器。

| 任务族 | 承诺与边界 | 预期处理／证据 |
| --- | --- | --- |
| 普通交流 | 问候、概念、工作思路、通用写作不强迫查数 | 自然回答；混合实际查数仍取证 |
| 当前能力 | 当前字段／范围／导出资格，不等于数据覆盖；工具允许 `{}` 或合法 `question` | 实时权限快照；禁止仅凭模型声明 |
| 楼宇／季度 | 获权总体、明确期间、指标、单位、正式来源与版本；保留缺失、冲突和未核验 | 可确定则完成；影响答案的歧义才澄清 |
| 报告／研究 | 一个季度可聚合；两个以上季度趋势；北京时间已结束季度与最近有数据季度分开 | 不改写期间、不放宽全局趋势协议 |
| 多轮 | 明确改期间或地域时保留其余条件、楼宇限制及筛选 | 重新授权；无上下文的指代澄清 |
| 表／图／地图／文件 | 完整正式结果，同源单位／期间／来源；Excel、CSV、PNG、SVG等实际产物 | 逐项核对；最多三个归档快照及既有容量，缺项partial |
| 分析并导出 | 文件与可信原分析均属交付义务 | 保留原分析快照；不把自由生成因果当事实 |
| 历史／恢复／下载 | owner、session、权限版本及所有来源重新核验 | 允许与拒绝均验证；撤权不能复用旧授权 |
| 成交／业务／知识 | 复用独立领域工具和资格；成交不当季度租金，楼书不当季度面积，私有正文隔离 | 目录、聚合与证据能力按现有正式工具执行 |
| 不支持／依赖 | OCR、任意公开搜索、新供应商、任意叙述“第二点”的持久claim引用不在本轮扩展范围 | UNSUPPORTED或依赖阻断，不能伪装完成 |

核心合成数据固定 `synthetic-v1`、2026Q3、CBD获权总体 A–D：季度面积 10000/30000/20000/10000，净有效租金100/200/null/150，空置面积1000/6000/null/15000。租金有效样本3栋，面积加权170 CNY/m²/月；空置率同记录联合有效样本2栋，7000/40000=17.5%。高度210/198/null/冲突，不补零。报告季度另冻结北京时间时钟；生产自然时钟没有改变。独立验收使用另一组合成数据与手算期望，见[冻结包](independent/frozen-plan.md)。

排行在筛选后排序，保留末位并列；百分比水平与百分点差值分开；样本、分母、数据版本与来源不可省略。文件回读检查完整行、顺序、中文、数值类型、单位和未知。评测器故障注入包括错季度、错单位、空值变零、丢附件、limited冒充completed、来源版本错误、合成禁止泄漏标记。

## 已运行的入口

需要仓库依赖与 Node 22.13+（`node:sqlite`）。从仓库根执行。默认不启用真实模型；离线入口覆盖fetch、原始Node网络、回退、Node子进程和Worker，拒绝非Node原生子进程。真实本地Auth回归另用系统沙箱，避免构建工具需要启动原生进程时扩大联网范围。

```sh
npm run ai:eval -- plan
npm run ai:eval -- offline
npm run ai:eval -- offline --case data,budget
npm run ai:eval -- replay
npm run ai:eval -- live
npm run test:ai-eval
node docs/intelligence/evaluation/independent/run.mjs
```

`--case` 同时接受 `cases.mjs` 的案例ID或语义族，可按失败簇最小复测。`replay --trace <已有轨迹文件>` 仅在完整输入、工具schema、fixture、业务时钟、权限契约哈希完全匹配时回放，未匹配立即停止。省略轨迹时录制脚本模型轨迹并回放；这不是真实模型通过。只记录合成环境允许字段，不保存密钥、私有原文、continuation或原始思维链。

每次命令生成新的UUID批次和只写一次的JSON／日志，默认在被Git忽略的 `verification/ai-evaluation/`。记录精确commit、全部受版本控制／未忽略文件的内容哈希、已跟踪差异哈希和dirty状态，不覆盖旧失败。`report --batch <已有批次>`生成派生报告；`--auth-evidence <既有Auth结果JSON>`可合并真实本地Auth证据，保留其原版本声明和文件哈希，不能升级为生产证明。`resume --ledger <已有SQLite路径>`只检查持久台账，不重发未知请求、不清零费用。

`auth-http` 在普通offline批次保留NOT_RUN，单独运行仓库已有 `scripts/verification/verify-ai-query-auth.mjs`。它要求独占disposable栈、PG17、真实密码登录及Data API，模型被脚本化，真实文件及下载鉴权保留。该脚本初始化要求空库；失败后不能直接在同库重跑CREATE迁移。本轮仅重置本任务新建的测试栈，没有修改其SQL或生产数据库。既有CI会为每个PR创建独占环境。

## 总预算与后续真实验证

本轮明确授权金额为0，真实供应商请求0，费用估计0，未结算0；账单未核对。测试台账中的金额是合成夹具，不是消费。`live` 无预算时不读取模型密钥、不导入供应商执行器、不创建付费台账；写出的BUDGET_BLOCKED不是通过。

SQLite台账是本任务本地评测工具，未建设生产计费平台。金额以十亿分之一币种单位的整数保存。一次任务固定一份配置与同一路径；重启／阶段／worker共享事务。诊断workflow先锁住完整执行上界；每请求从workflow池划拨，不能同时计整任务和子请求两份预留。验收hold只能原子转验收workflow；buffer只能显式分配。发送状态转换在同一事务内再次核对停发标志。

发送前按完整消息、工具目录、原生上下文与输出上限预留；usage可靠时结算、释放余量，cache是prompt子集、reasoning是completion子集，不重复计费。超时／中断／崩溃保留预留，只有可证明未发送的reserved请求可释放。未定价返回模型、异常usage或超预留立即全局停发；未结算workflow不能关闭。供应商账单始终单列null／未核对，本台账不限制共享key的其他消费。

官方计价于2026-11-22重新读取：[DeepSeek价格](https://api-docs.deepseek.com/quick_start/pricing/)。Flash请求别名 `deepseek-flash`，官方模型版本 `DeepSeek-V4.1-Flash-1017`；旧v4-flash由同版处理。USD／百万token峰时上界：未缓存输入0.30、缓存输入0.006、输出1.20。预留不假定缓存命中或谷时优惠；没有换币。上线实际配置、返回标识与实际usage本轮没有付费核验，执行付费前仍需重核价格和环境。

已准备的最小包：独立的概念解释作诊断校准；锁定能力查询、明确季度统计两个未用于调优的模型语义任务作验收。一个完整workflow按既有60000累计token与最高费率预留最多USD0.072；诊断0.072、验收0.144、缓冲0.020，合计保守上限USD0.236，预算不需花完。该包验证真实模型＋合成工具接点；真实Auth/DB/HTTP证据另列，不能冒称生产端到端。最值得随后追加的产品HTTP验证是“CBD 2026Q2净有效租金Top10→Excel→实际文件回读”，待能逐次拦截或确认完整产品请求硬上界后纳入同台账。

带预算的执行接口已实现，但本轮未发付费请求。它要求 `live` 的 `--budget`、`--ledger`、`--phase diagnostic|acceptance`；[零预算模板](../../../scripts/intelligence/evaluation/budget.example.json)故意total=0。金额授权后才能按批准总额填写，不能拿模板中的预留额当授权；价格确认超过24小时、币种／模型不符、备用供应商开启或验收／缓冲不足时拒绝。模型按原DeepSeek配置，thinking disabled，并发1，54秒总期限，既有token／输出／轮次／工具限制继续生效。CLI仅凭协议结果最多给PARTIAL，正式PASS还需独立核对最终正文、数字、范围与因果表达。

## 证据判读

案例族PASS只表示该层断言通过，不是生产支持任务成功率。完整状态集合为PASS、PARTIAL、FAIL、EXPECTED_DENIAL、UNSUPPORTED、INFRA_BLOCKED、BUDGET_BLOCKED、NOT_RUN。分母包括冻结底表，拒绝题不提高支持任务完成率。脚本模型、轨迹回放、真实模型、真实本地Auth、生产分别统计；供应商输入缓存仍属于新模型请求。首批独立失败和修复后的同题回归永久分开，见[独立说明](independent/README.md)。

新预算、回放与独立回归进入现有Verify；日常CI不产生模型费用。产品修复测试仍由既有Vitest／真实Auth矩阵执行。未授权生产写入、生产权限修改、部署或合并，本PR不自动合并。

## AI 6.0 三档对照

```sh
npm run ai:eval -- compare-plan
# 经明确批准后，在对应的干净候选提交运行
npm run ai:eval -- compare-live --budget /absolute/path/to/approved-ai6-comparison.json
```

四组已获权的合成快照分别发给 Flash 快速、Flash Thinking low 和 Pro Thinking high。每组每档只请求一次。程序核对事实、来源、样本和建议工具，工具的实际执行与鉴权另由隔离 HTTP 验收验证。台账记录供应商 usage 和请求耗时。该对照为非流式，首份可用结果与请求完成同时取得。结构断言通过的结果记录为 `PARTIAL`，待复核正文、缺值、业务范围和陈述依据。估算费和未结算预留分别记录，实际账单待核对。

获批后的 JSON 需包含 `taskId`、`runDirectory`、`commit`（获批候选的完整 SHA）、`currency`（`USD`）、`totalNanodollars`（最高 `250000000`）、`pricingSource`（官方价格页完整 URL）、`pricingCheckedAt`（24 小时内重新核价的 ISO 时间）和 `rates`。`rates` 以 `deepseek-flash`、`deepseek-v4-pro` 为键，每个模型填写每百万 token 的峰值 `{ "input": 0.30, "output": 1.20 }` 或对应 Pro 费率。运行目录使用绝对路径，父目录须已存在，末级名称须等于 `taskId`。整次授权使用同一份审批文件、任务 ID 和目录。以 `COLLIERS_AI6_EVAL_DEEPSEEK_KEY` 提供独立评测密钥。

启动时一次性预留全部 12 项，每项以 5,000 输入及 8,000 输出 token（含推理）计价。供应商拒绝、缺失 usage、未定价模型或超出预留均停止剩余试验。中断时保留 SQLite 预留及 `comparison.jsonl`，可用 `resume --ledger` 检查各模型台账。审批消费凭证保留在运行目录的父目录。移动、归档或删除结果目录后，同一审批仍无法再次执行。对照只发送合成证据，应用生产配置无需变更。[DeepSeek 官方价格](https://api-docs.deepseek.com/quick_start/pricing/)
