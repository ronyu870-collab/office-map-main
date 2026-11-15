# 地图项目看图视觉验收 · 2026-11-13

评审者：Codex。视觉结论：通过。基线为 GitHub `main` 的 `1095754b728b4899317d1f16f771678bb8c52259`，候选为本目录随附的 PR #168 版本；精确提交记录在 PR 的 Visual acceptance 区块。

两边均打开本地生产构建的 `/map`，用同一只读角色、合成图片、楼宇记录和地图 SDK 替身，经实际地图卡片打开查看器。Chrome 157.0.8103.52，桌面 1280 × 800、模拟手机触控 390 × 844。照片是合成样本；画面没有真实地图瓦片或业务数据。

| 地图项目 | 视口 | 卡片前后 | 查看器前后 | 视觉结论 |
| --- | --- | --- | --- | --- |
| 现有楼宇 | 1280 × 800 | [前](before-stock-1280-inline.jpg) · [后](after-stock-1280-inline.jpg) | [前](before-stock-1280-viewer.jpg) · [后](after-stock-1280-viewer.jpg) | 照片与说明成组，图片无覆盖图标；查看器居中，下载与关闭对齐，消除了原窗口右侧大块空白。 |
| 未来供应 | 1280 × 800 | [前](before-future-1280-inline.jpg) · [后](after-future-1280-inline.jpg) | [前](before-future-1280-viewer.jpg) · [后](after-future-1280-viewer.jpg) | 未来供应标签仍和标题同排；查看器标题、说明及操作与现有楼宇一致。 |
| 现有楼宇 | 390 × 844 | [前](before-stock-390-inline.jpg) · [后](after-stock-390-inline.jpg) | [前](before-stock-390-viewer.jpg) · [后](after-stock-390-viewer.jpg) | 卡片标题和看图入口完整，预览没有覆盖图标；查看器居中，照片、下载和关闭均在视口内。 |
| 未来供应 | 390 × 844 | [前](before-future-390-inline.jpg) · [后](after-future-390-inline.jpg) | [前](before-future-390-viewer.jpg) · [后](after-future-390-viewer.jpg) | 标题组和项目入口保持原有层级；查看器四周留白均衡，照片、说明与操作均完整。 |

[地图浏览器结果](map-browser-results.json)记录两类项目各自的窗口尺寸；[画廊浏览器回归](gallery-browser-results.json)覆盖 1280、390 和 320 px 下的大图打开、翻页、关闭后返回原位置、键盘、模拟触控、预览失败回退和原图字节比对。加载预算和目标存储抽测见[首张照片加载](../building-photo-performance-20261111.md)。

手机 Safari／Chrome 真机（MOB-05）尚未验收；模拟触控、截图和上述回归不替代手机系统的下载与保存验证。
