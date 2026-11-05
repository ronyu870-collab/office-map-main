# 企业选址报告整屏改版（2026-11-06）

基线：GitHub main `4d40c501c20e873d8813f041a22d2377312bfb94`。用户确认八点方案，并授权完成后合并 main、发布。此次为报告内容与展示交互改版。

## 实现

- 删除第 18 节及展示中的来源／边界说明；原始调查数据与 sourceNotes 保存在 reportContent.ts 和 Git 历史。原调查页面：https://cw-prod-apacgws-a-cd.cushwake.com/en/greater-china/insights/chinese-mainland-office-occupier-strategy-report 。数据不是高力自行问卷，不更改 62 个分类比例。
- 18 个场景（封面＋17 个正文），以三轮看楼流程收尾；四个导航分组。
- 桌面按视口扣除页头计算场景最低高度，内容不裁切。手机使用自然展开。
- passive wheel 观察在手势结束后归位相邻整屏；保留原生滚动，新的输入可打断，长内容、文本选择、嵌套滚动不强制跳页。CSS 原生 proximity snap 提供辅助停点。
- 五种呈现模式：横条、纵柱、点图、构成带、办公节点示意＋比例。多选不转构成图；构成比例只用于单选分布。纵柱使用一致的 0—60% 范围，保留每项精确值。
- 文字组短位移、图表展开、图片揭示、连接线绘制、背景轻微位移；减少动态模式取消动画。公开阅读与认证返回逻辑沿用已有实现。

## 功能证据

- 旧 main 在 1280×720 中可用高度 644px：研究导言 750px、行业分布约 1024px、多数数据页 790px，复现超高。
- 新版浏览器回归覆盖 1440×900、1366×768、1280×720、1024×700、768×1024、390×844、320×740。桌面各场景完整入屏，轻扫前后归位；各尺寸无横向溢出，导航和减少动态深链接通过。
- 仓库脚本 scripts/verification/verify-occupier-report.mjs 随 CI 持续执行；测试使用隔离静态报告，不携带生产账号。手机证据为浏览器视口，不冒称真机触控验收。
- 类型、Lint 与 159 文件 / 1,066 项测试通过；首次构建发现 CSS Modules 纯选择器限制，补足局部类作用域后生产构建通过。精确 PR head 的 CI 与正式发布另行核对。

## 图像

使用内置 ImageGen，四张生成图已人工查看，作为虚构建筑／空间意象，不作为真实项目证据。源 PNG 保留在生成目录，网站使用 1600px WebP，总计约 1.1MB，封面优先、其余延迟加载。

### office-cover.webp

- 项目文件：public/occupier-insights/office-cover.webp
- 原件：/Users/yuhang/.codex/generated_images/01a1ab25-fa7b-7421-b68b-54c2162b45a1/exec-bf7c7551-c93d-4c10-b2f1-82ca8f8cdbd2.png
- 提示词：Wide 16:9 premium editorial architectural photograph for a Chinese corporate office research website. Imagined contemporary business district, sophisticated stone and glass buildings receding into soft morning haze, mature trees, warm off-white and muted blue-green palette, no recognizable landmark. Powerful quiet perspective, left half spacious pale sky and shaded building surface for dark editorial headline, visual detail toward right. Natural daylight, realistic photography, restrained elegant, not a render. No words, logos, charts or watermark.

### office-network.webp

- 项目文件：public/occupier-insights/office-network.webp
- 原件：/Users/yuhang/.codex/generated_images/01a1ab25-fa7b-7421-b68b-54c2162b45a1/exec-77fe5b36-9646-4d45-9d26-5d926f11f229.png
- 提示词：Wide 16:9 premium editorial architecture photograph, elevated view through a contemporary office building's glass passage connecting two workspaces, several separate buildings and planted courtyards visible. Evokes connected distributed offices. Warm stone, muted sage, brushed metal and clear glass, coherent refined natural morning light. Spacious asymmetric composition, convincing physical architecture, no recognizable property, no text, charts, logos or watermark.

### office-workplace.webp

- 项目文件：public/occupier-insights/office-workplace.webp
- 原件：/Users/yuhang/.codex/generated_images/01a1ab25-fa7b-7421-b68b-54c2162b45a1/exec-02b0e24d-578d-44d3-a7d3-b4d076af51f2.png
- 提示词：Wide 16:9 premium editorial interior photography for an office research report. Beautiful human-centered workspace, quiet focus desks in foreground and glass meeting room and comfortable collaborative lounge deeper behind, full-height windows, diffuse sunlight, natural oak, pale stone, muted sage upholstery. A few tiny distant indistinct people only. Refined realistic spatial depth, unposed, calm, no readable text, logos, watermark or charts.

### office-green.webp

- 项目文件：public/occupier-insights/office-green.webp
- 原件：/Users/yuhang/.codex/generated_images/01a1ab25-fa7b-7421-b68b-54c2162b45a1/exec-ac15a842-d137-4250-a583-2937c93a5797.png
- 提示词：Wide 16:9 premium editorial architectural detail photograph for a corporate sustainability research report. Close perspective of sophisticated office facade with external timber-colored sunshade fins, planted terrace and large naturally lit glass atrium, glimpses of green trees and sky. Muted off-white stone, soft sage and bronze, natural soft daylight, realistic materials, premium quiet architectural magazine composition. Imagined property, no recognizable landmark, no words logos charts or watermark.
