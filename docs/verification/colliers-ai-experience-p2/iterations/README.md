# 迭代发现截图

这些是本轮较早的实际 Next／React 渲染，不与最终设计矩阵的 manifest 哈希对应，不用于精确 PR head 的最终视觉结论。

初轮欢迎截图可能仍处于文字入场过渡。最终矩阵已统一等待字体、使用截图 API 固定有限动画的完成态，并核对图像 SHA-256；匹配的精选图位于相邻 `browser/`。最终来源/摘要键盘顺序修正后的画面由精确 head CI 重新生成。

研究侧栏的早期 loading 截面曾被独立评审判为证据不足；已使用实际加载完成的面板图替换 `browser/after-320-research-open.webp` 与 `browser/after-390-research-open.webp`。

## 首次 PR head 的生产构建发现

`ci-4f67196-*.png` 是从 GitHub Verify run `44080622029` 的原始 artifact 原样取出的图片，属于 head `4f6719696d019ea00e33a3de4d8d55e9a2a99bdf`，与上述早期 WebP 分开。三张图的 SHA-256 记录在 [ci-first-head.json](../ci-first-head.json)。

- [1280px 复杂结果](ci-4f67196-1280-expanded-complex.png)：图表说明下方 SVG 空白。不能当作图表完成态；后续增加实际几何、绘制稳定及专门完整图表截图。
- [320px 历史](ci-4f67196-320-history-open.png)、[768px 历史](ci-4f67196-768-history-open.png)：顶部说明与操作占满面板，初次打开看不到记录。后续压缩窄屏头部并要求首条记录至少 44px 可见交集。

这些图用于保留发现与迭代依据，不属于修正后新 head 的通过证据。
