# 配图与动效精修 · 2026-11-06

基线 main：72338895d701fa88c0961fd4d1894b48a6eaf431（PR #121）。用户认可整体版式，要求修复配图并增加自然、可见的动效。

- 生态页沿用 540×339 的旧图，四个配图页使用固定高度裁切，源图与容器比例不一致。
- 四张新的 2172×724 全景素材统一为 3:1，容器按相同比例显示并使用 contain；整体文字、色调、图表数据、导航和权限逻辑不变。
- 移除无业务意义的条形悬停变色。桌面整屏到位后才触发动效；手机长内容在阅读到相应图形时触发。
- 柱体与数值同步生长，点图端点显现，构成块与标签分序进入，办公网络逐段建立，照片揭示与轻微镜头归位。动效无循环，支持减少动态。
- 新增高清、比例与无裁切检查，归位前不播放的回归，以及实际图表动效检查；沿用七组视口、62 项数据、匿名访问与整屏检查。最终 CI 与部署状态分别记录。

## ImageGen 素材提示词

使用内置 ImageGen。源 PNG 留在生成目录；项目资产如下，均是建筑空间意象，不代表具体楼宇。

- `public/occupier-insights/office-ecosystem-panorama.webp`：Ultra-wide panoramic 3:1 editorial architectural photograph, 2400 by 800 composition. A coherent imagined contemporary office campus ecosystem, three different mid-rise stone and glass office buildings joined by tree-lined courtyards and walkable plazas. Everything important fits in a continuous horizontal band through the middle, full buildings visible with generous sky above and courtyard below. Soft daylight, pale limestone, muted sage and bronze, refined realistic architectural photography, visually consistent single scene not collage. No Beijing landmarks, no text, logos, charts, watermark.

- `public/occupier-insights/office-network-panorama.webp`：Ultra-wide panoramic 3:1 premium architectural photograph, horizontal composition. A single continuous scene of a modern glazed pedestrian bridge connecting two office buildings across a green courtyard, the entire bridge and meaningful facade details visible across frame, natural realistic geometry and materials. Pale stone, warm oak details, muted sage trees, soft neutral daylight. Main subject fits middle horizontal band, no collage, no split screen, no text, logos, watermark.

- `public/occupier-insights/office-workplace-panorama.webp`：Ultra-wide panoramic 3:1 premium editorial photograph of a single spacious contemporary workplace interior. In one continuous horizontal scene show a quiet work area, collaborative lounge and glazed meeting room, wide natural daylight windows, oak and pale stone, muted sage furnishings. Eye-level perspective, key furniture and windows all fit in middle horizontal band, calm realistic rich detail, no montage or collage, no words, logos, charts or watermark.

- `public/occupier-insights/office-green-panorama.webp`：Ultra-wide panoramic 3:1 premium editorial architectural photograph. A continuous horizontal view of a sustainable office terrace with sunshade fins, a planted courtyard and naturally lit atrium. Pale stone, soft green trees, warm metal, neutral morning daylight, realistic high-quality materials, sensible physical architecture. Key structure fits within middle horizontal band; no monumental towers, no collage, no words, logos, charts or watermark.
