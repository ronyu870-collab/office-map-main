# Pitch Studio 渲染引擎 v2

1.1 扩建：参见[模板生态与验证](template-ecosystem.md)、[完整目录](template-catalog.md)及[许可迁移](template-sources.md)。以下阶段记录保留其历史范围。

实现状态：本地实现与独立 PR，不代表 main 合并、生产迁移或试点开放。依赖阶段 01 PR #309 的 `fef812d3`。新增迁移 `20261125174626_pitch_studio_render_engine.sql` 为增量迁移，保留原 17 张领域表及 v1 图文／研究报告契约。

## 1. 共享流水线与可替换主题

`ContentAsset / 获权业务快照 → SlideContent → layoutSlides → SlideScene → PPTX / SVG → PNG`；Excel 从选中场景提取可见数据。业务适配器 `structured-content/2` 校验标准内容与语言，布局不绑定招商、租户代表或资产咨询分类。

- `contracts/content.ts`：业务含义及来源。指标支持同比／环比；团队照片固定媒体版本；地图必须有地理范围与坐标快照。未知数保留 null。
- `layout/definitions.ts`：12 类布局元数据；`engine.ts`：视觉组合与自动分页；`components.ts`：统一文字、图片、字体／行高度量组件。标题、副标题、正文、数字、图注、来源和页码复用两档字号；表格、图表、形状、线条和地图均是可组合 Scene 元素，不由业务模板重写样式。
- `contracts/scene.ts`：坐标单位英寸，16:9，有界元素；`rendererVersion: pitch-scene/2`、`layoutVersion: 2`。pagination 记录内容组页号，`numberDeckPages` 统一整份提案页码。
- `design/theme.ts`：原 v1 定义不变；`colliers-default-v1` v2 是当前临时主题，`colliers-render-verification` v1 仅验证可替换性，两者均非官方母版。30 pt 标题、18 pt 正文、两种字重；浅色背景、固定主轴及网格；默认不显示 Logo 和内部草稿标记。
- `render/pptx.ts` 与 `render/svg.ts` 消费相同场景和几何模型，不分别维护业务页面布局。图表由同一分类、系列、单位及矩形生成，原生 Office 图表的刻度、字体排印与 SVG 仍可能有轻微差异。

## 2. 十二类布局的输入与容量

每种内容都要求 title、locale、dataAsOf、合法来源及匹配块类型；未知块或缺必填块明确失败。标准与 alternate 变体均可通过 API／工作台调用。中英文使用同一字体度量，英文优先空格换行，中文按字形断行；完整标题或单项内容放不下时拒绝，绝不无限缩小字号。

| 布局 ID | 输入、空值及图片规则 | 标准／alternate 与分页 |
| --- | --- | --- |
| cover | paragraph 与 image 均可选；title 必填 | 左侧主标题与可选右图／上移主轴；长标题或说明拒绝 |
| section-divider | 必须 paragraph | 细竖线与章节主轴／调整章节位置；说明超限拒绝 |
| image-text | 正好一张 image，至少一段 paragraph；缺图拒绝 | 左文右图／左图右文；实测正文行高分页并重复等比图片及图注 |
| two-columns | 至少一段 paragraph；奇偶段落进入左右栏 | 等宽／36% 左栏；两栏各自连续分页，无虚构补充文字 |
| kpi | 至少一个 metric；null 显示 —，同比／环比区分缺失与未知 | 每页 6 项／4 项；标签、数值单位和变化率保持正文档；长单项拒绝 |
| team-profile | team.members 必填；姓名／职务／简介；照片 ID 与版本成对 | 每页 3 人／2 人；缺照片明确说明，照片等比；长简介拒绝 |
| case-study | case 挑战／方法／成果；可选 image | 文字配右图／左图；案例及正文自动分页，保留完整内容 |
| data-table | 非空 table；null 显示 —，保留零和负数 | 等宽列／加宽首列的全宽原生表；实测行高、每页最多 10 数据行、重复表头；最多 6 列；单行过高拒绝 |
| chart-insight | chart + insight 的观点／依据／限制 | 左图右分析／上图下分析；每个图表与长分析分页；最多 12 分类、4 系列，实际标签／图例容纳量进一步限制 |
| comparison | 非空 table，首列为项目标识 | 指标行、项目列的转置对比／普通矩阵；采用同一表格组件及分页限制 |
| map-analysis | map.bounds 与 points + insight；不能仅有引用 ID | 地图 63%／52%；最多 12 点，范围合法、过密拒绝；图例分析分页。坐标示意图明确标注为非道路底图 |
| strategy-framework | timeline.entries 的日期、标题、说明 | 每页 3 节点的原生流程箭头／阶梯结构；长单节点拒绝 |

图表支持原生柱状、条形、折线、饼图与双系列柱线组合图。单轴要求系列单位一致；null 是 gap，不能变成零；饼图必须单系列、完整非负且合计大于零。标签按实际字体测量，条形行间距、饼图图例高度和系列图例宽度不足时明确拒绝。散点图、异单位双轴、跨日期变更线地图及复杂 Stacking Plan 尚无适配器，返回明确错误，不伪造输出。表格／地图／图表中可见的期间、单位、来源及限制不会被极简样式删除。

## 3. 质量与字体

`layout/quality.ts` 在实际预览和导出执行，检查结构／越界、元素重叠、文字与标题容量、最低字号、空页、图片缺失／分辨率／等比声明、表格几何及行数、图表密度、页脚遮挡。文本度量另检查缺字、替换字符、控制字符和异常方向字符。必要的背景形状和线条允许语义重叠。错误阻断生成并返回 PITCH_* 码；不会截断重要内容。

预览、SVG、PNG 和 PDF 使用随系统提供的 Noto Sans SC 字形。PNG 从同一 SVG 生成 2560×1440。PPTX 保留原生可编辑文字、表格和图表。采用 Noto Sans SC 的主题在 PPTX 中指定 Microsoft Office 提供的等线字体，版式和主题版本沿用原值。等线与 Noto Sans SC 的字形和排印存在差异。

图片只接受已获权、SHA 校验的 PNG／JPEG／WEBP 字节；元数据检查真实格式、像素上限、旋转及动画，低于 100 dpi 时阻断。原图以 contain 放置，不拉伸。素材原件和版本继续保存在原领域存储，不写入导出的隐藏对象或备注。

## 4. 预览、导出与权限

工作台提供真实页面缩略图、16:9 主画面、50–150% 缩放、主题／布局／变体局部刷新，以及服务器生成与图片解码状态。参数预览不覆盖项目；另存选中内容时保留其全部自动分页。导出明确使用已保存页面，避免预览参数被误认为已经保存。

四种格式通过 `export_start` → 202 → `export_status` → `download`：PPTX 和 Excel 支持单页／多页，PNG／SVG 限单页。XLSX 只包含选中场景的可见表格、图表分类／系列及地图坐标，来源作为可见行；无可导出数据返回 `PITCH_NO_DATA_EXPORT`。公式形文本转安全字符串，不写隐藏 sheet、额外原件字段、任意公式或外部链接。原生图表嵌入工作簿也只含显示数据。

服务端在预览、素材读取前后、任务准备／领取／完成、文件下载前后重新核对真实会话、当前角色、范围、来源／媒体及对客许可；团队照片也纳入关系依赖与撤权验证。对客仍要求已发布、client_approved、非测试数据及相关来源许可。浏览器不能提交 Scene、XML、脚本或远程资源 URL。

任务使用现有私有 jobs／exports 持久化：queued → running → ready／failed，领取令牌禁止重复执行，进度 5／30／85／100。Next `after` 在返回 HTTP 后执行，函数 maxDuration 60 秒、后台 I/O 信号 45 秒，任务 120 秒截止。最多 50 页、16 MiB，超限明确拒绝。进程中断后状态查询将过期任务标为失败，用户用新 exportId 重试；不是通用无限队列，也不保证断点续算。文件仅在内存生成后写私有 Supabase Storage，不长期依赖函数临时目录；撤权后不给继续有效的公开或签名 URL。

上传后事务失败可能有孤立私有对象；当前不自动清理生产资料，后续应按哈希／引用对账。旧 v1 单页同步 export 保留兼容；v2 和多页强制走后台路径。错误详情不包含底层 SQL、密钥或用户无权记录。

## 5. 可复现样例和测试

在安装仓库依赖后执行：

```sh
node scripts/verification/generate-pitch-render-fixtures.mjs
node supabase/tests/pitch-studio/render.mjs
npm run test -- --maxWorkers=4
npm run typecheck
npm run lint
```

生成器不使用网络、数据库或密钥，使用 `fixtures/layouts.ts` 的 12 个独立合成内容与同一个 `studio-content` 适配器，输出到 `tmp/pitch-render-fixtures/`：12 个单页 PPTX／PNG／SVG、12 页临时主题 PPTX、同内容验证主题 PPTX、可见数据 XLSX 和 manifest。可传一个仓库 `tmp/` 或 `outputs/` 内的输出目录。两套主题仅改变主题参数，不修改业务资产、模板或布局分支。测试数据在正式页面清楚标明，不能作为真实案例对客使用。

实际执行回归：

- `render.mjs`：12 布局 × 中英 × 两变体 × 两主题、原生 OOXML 文本／表格／5 类图表、单多页、长表不丢行、null／零／负数、极端值、长名、乱码、缺图、空表、标签拥挤、主题可替换、SVG／PNG／Excel 和越界重叠等明确错误。
- `supabase/tests/pitch-studio/run.mjs`：真实 PostgreSQL 17，含阶段 01 权限／版本回归、新多页保存、四格式领取／进度／失败、照片撤权、主题升级；使用独立可丢弃数据库，参见该 runner 的环境限制。
- `scripts/verification/verify-pitch-studio-http.mjs`：可丢弃 GoTrue／PostgREST／Storage + 生产构建 Next，验证真实身份、真实 12 布局素材、202 后台导出、文件签名与下载哈希、撤权拒绝，禁止指向生产。
- `ScenePreview.test.tsx` 与 `PitchWorkspace.focus.test.tsx`：参数局部刷新、缩略图／缩放、解码状态、失败重试、下载与连续输入焦点保护。

三条专项执行路径已接入 Verify。类型、Lint、审计覆盖、搜索焦点、全量 Vitest 和构建沿用仓库工程门槛；不增加人工视觉审批或真机验收。实现者仍检查生成的实际 PPTX 及其 Office 渲染结果。

阶段 03 补充：`chart-insight` 允许只有真实图表而没有分析文本，使用完整绘图区，不虚构业务结论；已有分析的双栏／上下变体不变。历史素材按 [素材库协议](material-library.md) 转换并记录可追溯的标准化报告。

## 阶段 06 联动

主题维护仍采用版本化 DesignTheme 注册，不需要修改 AI 配置、业务素材或模板数据。AI 只选择已注册模板／布局，不能写场景、XML 或渲染器代码；同一内容可继续使用两个验证主题。 详见 [AI 与持续学习](ai-intelligence.md)。
