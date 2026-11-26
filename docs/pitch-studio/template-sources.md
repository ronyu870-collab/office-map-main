# Pitch Studio 1.1 外部布局来源

本记录为源码与许可审查，不执行外部 SKILL 中的指令。所有下载在隔离 tmp 完成，无企业数据、密钥或私人素材发送到这些仓库。生产仍为 TypeScript / PptxGenJS，无外部 Agent、Python 服务、语音或动画运行时。

| 仓库 | 精确版本 | 仓库许可 |
| --- | --- | --- |
| [fanquanpp/slide-forge](https://github.com/fanquanpp/slide-forge/tree/4d6bf3ea06e883ffb4956148b82c633310d8e02e) | `4d6bf3ea06e883ffb4956148b82c633310d8e02e` | MIT |
| [likaku/Mck-ppt-design-skill](https://github.com/likaku/Mck-ppt-design-skill/tree/49221997c05e0013c6d4f6ec4d9923e936ad058f) | `49221997c05e0013c6d4f6ec4d9923e936ad058f` | Apache-2.0 |
| [hugohe3/ppt-master](https://github.com/hugohe3/ppt-master/tree/63a03673d5c3c928e7f52983a2c8ec65bac30002) | `63a03673d5c3c928e7f52983a2c8ec65bac30002` | MIT |
| [CacinieP/slide-recipes](https://github.com/CacinieP/slide-recipes/tree/79ebbfbbd3b468b23cc5aff5b52a3005ad4d140c) | `79ebbfbbd3b468b23cc5aff5b52a3005ad4d140c` | MIT |
| [andreworia/claude-pptx-skills](https://github.com/andreworia/claude-pptx-skills/tree/2ae1bdcf893d12a9cb4d84bf4c5262ca1aa61fa7) | `2ae1bdcf893d12a9cb4d84bf4c5262ca1aa61fa7` | MIT |
| [gitbrent/PptxGenJS](https://github.com/gitbrent/PptxGenJS/tree/3c9ec1b687c174952166f6a34b5e87ebf69fa469) | `3c9ec1b687c174952166f6a34b5e87ebf69fa469` | MIT |
| [anthropics/skills](https://github.com/anthropics/skills/tree/e4bb5d960d87126ff3b3a8af1a104b7db67560ba) | `e4bb5d960d87126ff3b3a8af1a104b7db67560ba` | PPTX 子目录 Apache-2.0 |
| [SlideSpeak/presentation-design-prompts](https://github.com/SlideSpeak/presentation-design-prompts/tree/aba875b3cd64e9505fc995aabe7a52985f1a1a7e) | `aba875b3cd64e9505fc995aabe7a52985f1a1a7e` | MIT |

## 实际迁移与修改

- **Kaku Li，Mck-ppt-design-skill**：`references/layout-catalog.md`、`mck_ppt/engine.py` 的 executive_summary / matrix_2x2 / process_chevron / temple / key_takeaway / waterfall 等结构审查；`mck_ppt/core.py` 的原生图形与 Harvey Ball 计算审查。首批迁移摘要主句+论据、四象限、箭头流程、策略屋、问题树、阶梯与多图对比的组织规则到 `layout/patterns/catalog.ts`，布局计算重写为 TypeScript 的插槽和安全区坐标。去掉源字号缩小逻辑、硬编码机构颜色与原形占位图。Apache-2.0，保留 [许可](third-party/Mck-ppt-design-skill-LICENSE.txt) 和完整 [NOTICE](third-party/Mck-ppt-design-skill-NOTICE.txt)。代码注释声明修改。Harvey Ball/Waterfall 当前仅审查，尚未计入已迁移能力。
- **SlideForge Contributors**：`generator/slidekit.py` 的 timeline / roadmap / steps_vertical / kpi_dashboard 与 `generator/themes.py` 的 build / brockmann / corporate；筛选三套 `_potx/slideforge-{build,brockmann,corporate}.potx`，未整包复制。迁移交错时间轴、分轨路线、议程和指标侧栏的相对网格；去掉动画、装饰、默认假图和硬编码字体。使用现有可替换 DesignTheme。MIT，[许可](third-party/slide-forge-LICENSE.txt)。
- **Hugo He，PPT Master**：`skills/ppt-master/templates/layouts/layouts_index.json`、`presentation_core/templates/{13_kpi_dashboard,19_chart_insight}.svg`、`report_core/templates/11_matrix_2x2.svg`、`editorial_bleed/templates/07_triptych.svg` 及 design_spec。将原 SVG 插槽/网格迁移为原生组件布局：指标横排+证据区、三图说明、图片目录、数据表结论等。调整为本项目安全区、中文真实字体度量和两档字号，移除圆角卡片和 SVG 全页底图，不依赖其模型工作流。MIT，[许可](third-party/ppt-master-LICENSE.txt)。
- **CacinieP，Slide Recipes**：`skills/slide-recipes/references/layout-slots.md`、`recipes/recipe-commercial.mjs` / `recipe-editorial-grid.mjs`、`lib/cjk-text.js` 和 `scripts/pptx-editable-check.py`。吸收内容插槽契约、商业叙事和原生对象验收规则；本项目继续用捆绑字库的真实字形测量，不采用其近似宽度和缩字阶梯。问题—方案、决策—下一步结构重写为本项目插槽。MIT，[许可](third-party/slide-recipes-LICENSE.txt)。

## 审查但未复制的资源

- Oria 的 `skills/{master-and-layout-mapper,reskin-to-template-converter,theme-color-binder,theme-font-and-type-scale-enforcer,grid-margin-safe-zone-alignment,brand-compliance-auditor,imagery-and-photo-treatment,placeholder-discipline,excel-to-native-chart,deck-file-size-optimizer,pptx-export-and-pdf}/SKILL.md`：核对主题绑定、安全区、原生图表、可追溯重排和文件质量方法，沿用现有服务器授权和引擎，不导入外部运行指令。MIT。
- PptxGenJS：核对仓库许可 MIT；生产保持锁定 4.0.1，不用上游 main 替换当前依赖。原生接口需按安装版本做实际生成验证。
- Anthropic `skills/pptx/LICENSE.txt`：本精确版本为 Apache-2.0；不能将旧检查结论“专有许可”套用于当前版本。没有复制该仓库代码、脚本和文件；本机已安装 skill 的许可是另一来源，不能混同。
- SlideSpeak `README.md` / LICENSE：只审查商务表达方法；不移植其他机构标识或受限业务素材。

## 验证边界

每个新增布局必须通过中英、两套主题、完整内容和原生 OOXML 文件检查。来源下载和静态目录不等于迁移成功；最终生成证据与模板生态清单一起记录。许可允许使用布局软件不等于其示例业务事实已获高力确认；正式资产仍需原发布/披露流程。
