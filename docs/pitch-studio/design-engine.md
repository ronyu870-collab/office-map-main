# Pitch Studio 3.0 演示设计引擎

六个版本化候选通过既有主题目录选择。每个主题的品牌状态均为 `provisional`。候选方案使用仓库已授权的 Noto Sans SC 和原创构图原则，仍需 Colliers 官方母版确认。

| 候选主题 | 构图 | 图表和数据表 |
| --- | --- | --- |
| Corporate Executive | 右侧竖幅封面，结论与证据侧栏，行动按日期成组 | 轻量横线表格，单色主系列与独立基准线 |
| Consulting Minimal | 开放留白的框内图，结论和证据保留共同主轴 | 较细折线和紧凑比较柱，横线表格 |
| Architectural Editorial | 满版摄影配实底标题区，照片优先的大图构图 | 少量刻度和较粗折线，横线表格 |
| Market Intelligence | 左上刊头，图表与分析侧栏，研究内容紧凑 | 较高对比图例、趋势节点、带状表和共享热力尺度 |
| Investment Memorandum | 文件式上方标题与横向条幅，下方解读 | 带状表、定位节点与数据单元格右对齐 |
| Premium Portfolio | 左大图右文字的作品集封面、同图幅楼宇对照 | 较宽柱间距，单独突出目标项目，横线表格 |

## 设计输入

- 业务组合方提供 `SlideContent` 和已注册的 `layoutId`。引擎以版本化主题运行 `layoutSlides`，可生成多页，再用 `numberDeckPages` 统一预览与导出页码。
- 照片沿用 `mediaAssetId`、`mediaVersion`、`sourceIds`。Agent 02 服务端解析 `VisualAssetReference` 后，调用方通过 `imageFromResolvedVisual` 将同版本引用和媒体转为图像块及原始来源，并将媒体交给渲染器。该接缝把署名、原件链接和许可链接保留在页面，并对不可裁的照片及地图强制等比完整显示。引擎以固定 ID 和版本消费媒体字节，原件仍经现有服务端权限和摘要路径。照片可附 `caption`、`credit`、`aspectRatio`、`fit` 与归一化焦点 `focus`。比例用于候选构图，裁剪按实际解码尺寸执行。图文版式未提供照片时生成纯文字页。已引用却无法读取的图片继续报错。
- 排版沿用两档主体字号，封面有单独的大标题档，图注、来源和页脚共享 11 pt。图内刻度与图例共享 12 pt。标题、章节、数字、单位、次级标题、正文、图注、来源、页脚有独立语义。正文分页保留显式段落和完整文字。
- 扩展场景使用 `designVersion: 1`，同时沿用公共 `rendererVersion: 'pitch-scene/2'` 和布局注册的版本 2。旧记录缺少 `designVersion` 仍使用原版坐标和主题。图片、表格、图表和文字在 PPTX 中均为原生对象。满版图片在 PPTX 中保留原图及可编辑裁剪。
- 桌面浏览器预览使用捆绑字体，PPTX 声明同字体。Office 环境可替代字体，图表刻度和标签位置也由 Office 应用独立排版。

## 图表数据

- `scatter` 要求 `xAxis: { label, unit, values }`，纵轴使用 `series`，下标与 `categories` 中的项目一一对应。只有横纵数值均已知的配对进入图形。独立 XLSX 保留原序和所有未知字段。PPTX 内嵌工作簿保留可绘制坐标，项目标签可在图表内编辑。项目高亮使用 `emphasis: { kind: 'target', category: index }`。
- `combo` 用第一组系列绘制柱、第二组绘制折线，量纲一致。使用 `emphasis: { kind: 'benchmark' }` 时，第二组以虚线显示，基准值由业务输入。单系列条形和柱形也支持目标高亮。
- `stacked-column` 沿零点分开累计正负值，需要完整同单位系列。成交面积区间使用业务已明确边界的分类及原始计数。多季度线图保留缺口。
- 子市场热力矩阵使用 `table.treatment: 'heatmap'`。首列为行名，其余列是共同量纲的数值或空值。按全表计算一次颜色域并保留到分页场景。色深与数字始终同时可见，未知值留空值标记，零保持为零。

## 可复现验证

运行 `node scripts/verification/generate-pitch-design-demos.mjs`，生成四组代表版式和同内容六主题对照。演示素材全部为本地合成，构图可用于接入 Agent 01／02／04 的正式业务数据和获权照片。真实对客资料受现有许可限制。

`npm run test -- src/lib/pitch/__tests__/design-engine.test.ts` 检查六种构图、内容分页、无图降级、一致图幅、原生裁剪、散点横纵轴及工作簿、堆叠和热力矩阵。隔离 PostgreSQL 17 的 `supabase/tests/pitch-studio/run.mjs` 覆盖目录、权限、保存回读、预览与下载。

本机 Office 渲染用 `FONTCONFIG_FILE` 指向项目捆绑字体目录后运行 LibreOffice headless。与相同 Scene 生成的 SVG 对比裁剪、中文、表格和图表关键页。密度、视觉主体、裁剪和重复构图检查给出提示，实际渲染用于判断样稿质量。
