# 新增成交：企业关系的静默验证与提示

最终对照基线：`main` 的 `be4756246e5c8e64671fae4efd4a66ab537e65fa`，包含 F6 到期线索与管理员项目台账修复。本次只在「租赁成交填报 → 新增成交」增加后台判断和候选标注。企业名称依然可手填，候选只有在用户明确选择时才回填。近期成交沿用原读接口，按选中的记录名称精确查询最新五笔。关系预测不修改成交、公司归属、草稿、查重、报表或原始名称。

- 现有联想先返回。输入停止且联想可发起判断时，等候额外 900ms 再发后台请求。继续输入、中文组词、关闭候选或换公司会取消尚未发起的判断。后台返回不会刷新候选或移动焦点；以后重新查询时才能看到已验证的提示。
- 服务端只在有效编辑者或管理员的非模拟会话中接受判断请求。先用关键词、疑似全称和有限的单字符模糊匹配，从现有可读成交中找候选。只有查询名称、候选名称和临时序号发给 DeepSeek。没有候选就不调用；每次最多 4 对，每 UTC 日全站最多 120 对。词面毫无交集且没有别名线索的企业可能搜不到。
- 数据库按规范化后的无序名称对和当前判定版本认领，跨实例与并发均去重。成功、否定、不确定和失败均不自动重试；执行中断的认领也保留，以免在无法确认上游状态时重复调用。确需重新评估时按新策略版本走独立校准。读取建议时重新检查候选是否在当前成交来源可见。
- 模型只返回关系类型及强／不确定分档，模型的自报判断不构成 95% 准确率。每个版本、每类正向关系分别用最早完成的 100 个强判断组成固定复核样本；全部有人工结论，且至少 95 个与模型分类一致才通过。无法核实的样本计为不正确；人工否定过的单对始终不提示。两类提示用不同文案，普通词面匹配仍可用。这里的 95% 是该组样本的实测精确率，不是单条判断的概率。
- 这是内部衍生表。浏览器角色无直接访问权限，应用的服务角色只能认领、读和写回模型结果，不能写人工复核结论。服务端走原有身份及来源判断。无公开模型分数、查询样本或人工依据接口。

## 静默验证与启用

1. 在已授权目标应用 [企业关系迁移](../../supabase/migrations/20261111084119_lease_company_ai_assessment.sql)。在 Vercel 环境变量复用服务端的 `DEEPSEEK_API_KEY`；`LEASE_COMPANY_AI_MODE` 默认关闭。先在允许发送企业名称的环境设置 `shadow` 并部署。静默模式只积累样本，常规候选不显示关系。
2. 管理人员通过授权数据库会话查样本。先核对当前模型版本对应的 `policy_key`。按批次复核两类样本，不跳过困难条目；用工商登记、集团正式披露或已核实的内部资料判断。同一主体才标记 `same_company`，可证实的集团、子公司等关系标 `related_company`，确认无关标 `unrelated`，证据不足标 `uncertain`。记录足够追溯的依据，复核材料留在授权环境。
3. 核对报告，至少一类达标后才考虑将环境改为 `hints` 并部署。数据库仍逐类核对门槛，另一类保持静默。纠正样本后低于门槛会自动隐藏该类提示；更换模型、端点或判定版本要重新静默取样。需要立即停用时切回 `off` 并部署；普通搜索及历史入口仍可用。

授权数据库会话中的复核查询（示意，替换版本和行号）：

```sql
select policy_key, max(created_at) as last_seen
from public.lease_company_ai_assessments
group by policy_key order by last_seen desc;

select * from public.lease_company_ai_review_sample_v1('<policy_key>', 'same_company');
select * from public.lease_company_ai_review_sample_v1('<policy_key>', 'related_company');

-- 审核单条，按真实结论填写依据。
update public.lease_company_ai_assessments
set reviewed_relation = 'uncertain', review_evidence = '<来源与无法确认的原因>'
where id = <assessment_id> and policy_key = '<policy_key>';

select r.kind as relation,
       count(s.assessment_id) as sample,
       count(s.reviewed_relation) as reviewed,
       count(*) filter (where s.reviewed_relation = r.kind) as correct,
       count(s.reviewed_relation) = 100
         and count(*) filter (where s.reviewed_relation = r.kind) >= 95 as can_hint
from (values ('same_company'), ('related_company')) as r(kind)
left join lateral public.lease_company_ai_review_sample_v1('<policy_key>', r.kind) as s on true
group by r.kind;
```

## 验证记录

- 对齐 `be47562` 后 `npm run verify` 通过（182 个测试文件，1,173 项通过，Lint 零错误，Next.js 16.2.12 生产构建通过）。首轮本机夹具地址不满足既有 Auth 测试的 `supabase.co` 条件，切回合成域名后通过。楼宇成交抽屉旧测试在 `f09abcc` 独立复现：读到结果后立即按 Escape 时，抽屉尚未在下一动画帧聚焦。补上关闭按钮的焦点就绪断言后通过，保留关闭和焦点恢复断言，产品代码未改动。
- 搜索焦点门禁对比 `be47562`：19 个文件、174 项通过。实际新增表单覆盖首字符回包、继续编辑和词中删除、光标和中文组词、过期回包、静默判断取消、两类标签、明确选中后才加载精确历史。
- 隔离 PostgreSQL 17.11 执行实际迁移，核对并发与反向组合去重、单次与全局上限、失败状态不重试、样本不足及 94% 不提示、95% 达标、类别独立、校准可撤销、浏览器角色无表及 RPC 权限。F6 的 20 组既有 PostgreSQL 回归也通过。持续回归由 [Verify workflow](../../.github/workflows/verify.yml) 在真实 PostgreSQL 17 中运行。
- 实际生产构建经 Supabase JS 2.111.0、PostgREST 16.5 和本机 PostgreSQL 17.11 跑通。使用本机的合成认证和 DeepSeek 响应；故意延迟模型，实际 POST 在模型完成前返回 202，重复和并发的错别字组合只调用一次。静默模式即使有通过的合成样本也不显示关系；提示模式只返回当前身份可见候选，普通编辑与管理员归档范围分开，选中企业后的历史不包含其他企业。
- 延迟对照在相同的本机网关与数据库下交替请求两个构建；复测 3 轮，每个版本、每个入口每轮 60 次。普通联想中位数基线 5.5–6.6ms、静默 5.4–7.2ms，同轮差值 −0.1–0.6ms；近期成交同轮中位差 0–0.4ms。两端长尾受本机负载波动。另让模型等待 1,300ms，每轮在同一等待窗口并发 6 次基线与 6 次静默联想；静默版三轮全部在模型返回前完成，最慢 74.2ms。此处为隔离夹具的接口计时，不代表生产登录会话的网络延迟。
- Chrome 157.0.8103.50 检查了实际构建的 1280×900、390×844、320×844 表单。键盘与触控可完成选择并展开所选企业历史；连续编辑、中文组词事件、焦点、触控高度及横向边界均核对。390px 也验证了草稿保存／回读和重复成交确认：明确确认前没有写请求，确认后只写一次，企业名称及手填字段正确，历史明细未带入。提交写入使用合成夹具。详见[操作记录](lease-company-ai-images/browser-results.json)。
- 隔离验收未使用生产成交或实际 DeepSeek 账户；生产发布见 PR 和部署记录。真实样本校准、iOS Safari 和 Android Chrome 真机验收未执行。合成样本只验证门槛机制，不代表实际匹配准确率。

视觉复核（VERIFY-05）：Codex 查看了同一编辑角色、同一组合成成交、同一浏览器和表单滚动位置下的对照画面。桌面和两个手机视口均通过：静默模式的候选布局和顺序与基线一致；达标后关系文字紧邻对应名称、沿原列表左边界对齐，320px 下仍完整可读；选择后列表收起，历史区域和底部提交操作清楚可达。页面无新弹窗或横向溢出。

| 实际视口 | 基线 | 静默模式 | 两类提示 | 选中后查看 |
| --- | --- | --- | --- | --- |
| 1280×900 | [基线](lease-company-ai-images/baseline-1280.png) | — | [提示](lease-company-ai-images/hints-1280.png) | — |
| 390×844 | [基线](lease-company-ai-images/baseline-390.png) | [静默](lease-company-ai-images/shadow-390.png) | [提示](lease-company-ai-images/hints-390.png) | [历史](lease-company-ai-images/selected-390.png) |
| 320×844 | — | — | [提示](lease-company-ai-images/hints-320.png) | — |
