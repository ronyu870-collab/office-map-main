# F6 最终页面视觉核对

日期：2026-11-11；评审者：Codex（逐张查看真实渲染图片，非仅用自动断言）。

代码基线为整合 main `fb66b36` 后的 `1a1556e`，另有 Auth 截图记录脚本变更；后续文档和图片提交不改应用源码，完整最终 head 在 PR #170 的记录中绑定。浏览器 Google Chrome 157.0.8103.50，macOS 桌面无头模式，Asia/Shanghai，1280×900、390×900、320×900。角色为真实登录的隔离管理员；图片只有合成企业、楼宇和备注。

## 范围与结论

F6 在 main 中是全新页面，没有可比的旧 F6 页面；采用系统后台页头、表单、卡片和按钮。此次导航保护和成交重复确认修复没有改动已有控件的视觉样式；实际成交弹窗的业务闭环由真实浏览器回归覆盖。

已检查九张 F6 最终画面：

- 阅读顺序为说明、筛选、候选，再进入详情；预计日期和计算依据分组清楚，补充入口明确可选。
- 桌面标签、字段和卡片对齐；正文及辅助文字采用稳定层级，主按钮只强调筛选／保存动作。
- 390／320 px 筛选纵向排列，卡片文字和日期自动换行；320 px 下较长日期占两行，内容仍完整可读。
- 展开补充后表单和保存按钮可经页面滚动到达；备注没有被固定页头或底部动作挡住。图中顶部裁切是向下滚动的视口边缘，不是字段隐藏。

以上 F6 正常列表／详情／补充状态的视觉核对通过。后续合并准备已补齐下述状态和入口核对，**本 PR 受影响画面的视觉结论为通过**；手机真机仍单独待验。Visual acceptance 是否通过，以最终 PR head 的实际检查为准，草稿阶段的 skipped 不计作通过。

## 实际截图

| 状态 | 1280 px | 390 px | 320 px |
| --- | --- | --- | --- |
| 列表 | [桌面](visual/f6-list-1280.png) | [手机视口](visual/f6-list-390.png) | [窄屏](visual/f6-list-320.png) |
| 详情 | [桌面](visual/f6-detail-1280.png) | [手机视口](visual/f6-detail-390.png) | [窄屏](visual/f6-detail-320.png) |
| 补充及保存 | [桌面](visual/f6-notes-1280.png) | [手机视口](visual/f6-notes-390.png) | [窄屏](visual/f6-notes-320.png) |

真机：iOS Safari／Android Chrome 未测。桌面浏览器的返回、断网重试通过不外推到系统切换、软键盘或操作系统结束浏览器。

## 合并准备：入口与边界状态

在整合 main `39d2c7a3732f92a858dc6c30b6f72109f02b1c4c` 后补验。该 main 只改成交表格和相关测试；F6 页面、入口、共同样式与原九张实际画面的源码一致。最终 head 在 PR 中绑定。Google Chrome 157.0.8103.50，1280／390／320 × 900。评审者 Codex 已逐张查看下表画面和保存失败后仍保留输入的表单画面。

入口来自本机真实登录的管理员页面，没有发送模型请求或保存业务数据；截图没有真实客户或账号资料。状态画面由实际 F6 React 组件、API 客户端和构建 CSS 生成，使用明确的合成会话及 HTTP 响应，以稳定覆盖空结果和失败等状态。这是视觉证据，权限有效性仍由真实 Auth／PostgreSQL 回归证明。复现探针见 [visual-state-probe.mjs](visual-state-probe.mjs)，结果见 [results.json](visual-states/results.json)。新增页面及新增链接在 main 中没有对应旧入口；原业务智能推荐表单和成交重复确认弹窗的样式未改。

| 状态 | 桌面 1280 | 手机视口 390 | 窄屏 320 | 评审结论 |
| --- | --- | --- | --- | --- |
| 业务智能入口 | [截图](visual-states/entry-1280.png) | [截图](visual-states/entry-390.png) | [截图](visual-states/entry-320.png) | 通过；新链接位于原选址顾问上方，与内容左边线对齐；文字完整，原表单仍可见 |
| 权限拒绝 | [截图](visual-states/1280-denied.png) | [截图](visual-states/390-denied.png) | [截图](visual-states/320-denied.png) | 通过；权限说明与返回链接清楚，不显示候选或写入控件 |
| 空结果 | [截图](visual-states/1280-empty.png) | [截图](visual-states/390-empty.png) | [截图](visual-states/320-empty.png) | 通过；明确区分零结果与无真实到期租约；分页禁用 |
| 读取中 | [截图](visual-states/1280-loading.png) | [截图](visual-states/390-loading.png) | [截图](visual-states/320-loading.png) | 通过；显示读取状态，没有将加载中误显示为零结果 |
| 读取失败 | [截图](visual-states/1280-read-error.png) | [截图](visual-states/390-read-error.png) | [截图](visual-states/320-read-error.png) | 通过；错误和重试成组，窄屏可完整阅读 |
| 保存失败 | [截图](visual-states/1280-save-error.png) | [截图](visual-states/390-save-error.png) | [截图](visual-states/320-save-error.png) | 通过；错误保持在页面提示区，原详情与输入保留；可滚回表单重试 |
| 保存中 | [截图](visual-states/1280-saving-form.png) | [截图](visual-states/390-saving-form.png) | [截图](visual-states/320-saving-form.png) | 通过；按钮明确显示正在保存并禁用，输入仍可读 |
| 只读历史 | [截图](visual-states/1280-readonly-form.png) | [截图](visual-states/390-readonly-form.png) | [截图](visual-states/320-readonly-form.png) | 通过；原备注可读，保存禁用；不以隐藏字段处理只读 |

版式结论：提示、筛选、候选／详情沿用同一阅读顺序和左右基线；正文与表单统一，品牌色用于动作；窄屏长标题、说明和时间自然换行，未裁切必要信息。保存失败时错误区在页面上部，用户可滚动查看，失败不清空输入；本轮没有额外重排或取消业务保护。截图顶部局部裁切属于表单滚动位置。

手机真机的处理顺序与本次用户合并授权见 [合入与启用边界](merge-boundary.md)，不将桌面窄视口计为真机验收。

最终同步 main `f09abcc` 后复核：F6 页面、业务智能入口、共同样式均无差异；main 新增的企业联想 UI 原样保留，本分支在成交表单的差异仍只有重复确认后的校验调用，没有样式改动。以上视觉结论继续适用于最终 PR head；企业联想自身证据见主分支随附的 [验收记录](../lease-company-lookup-20261111.md)。
