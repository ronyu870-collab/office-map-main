# Pitch Studio 3.0 文档工作流

项目继续使用现有页面、快照、版本和私人所有权。此处的工作台命令使用 `/api/intelligence/pitch/workspace`。导出使用 `/api/intelligence/pitch`。

| 命令 | 调用与结果 |
| --- | --- |
| GET `document_bindings` | 传项目 ID。返回页面固定素材版本、披露、原始来源及内容块的业务／人工／素材来源。现有季度与成交快照记录字段、查询参数、政策、权限版本及业务日期。 |
| POST `preview_data_refresh` | 传 `projectId`、`slideId`、`expectedVersion` 和可选正式 `period`。按所选页的快照复核同组关联页，比较数据值和真实来源版本，并返回审阅指纹及结论复核提示。 |
| POST `apply_data_refresh` | 使用相同参数和审阅指纹。正式事实和来源、项目版本或权限出现变化时需重新核对。保存同时提交替换数据的私有归档及项目新版本，历史恢复沿用 `restore`。版式或分页无法安全保留时拒绝保存。含独立研究素材的组合页暂不开放自动刷新。 |
| POST `apply_modification` | 传共享 `DocumentModificationPlan`，支持已有 `PageEdit` 的受控更新。默认 `scope: selected`，其余页自动保留。显式 `scope: document` 时传完整目标顺序和原始页版本，可复制、删除及排序。可选 `theme` 指定已注册主题版本。`PageEdit.manualNote` 保存页面标题区的人工说明，传 `null` 清除。`chartPresentation` 按块索引切换原生条形、柱状或折线图，系列和来源保持固定。刷新时沿用人工说明和图表类型。数据更新走带审阅指纹的刷新命令。 |
| POST `review_handoff` | 传共享 `AddToPitch`。楼宇与子市场由当前账号查询授权及正式季度数据解析。Colliers AI `analysis-result.id` 接受获权查数存档的请求 ID，复核当前会话和原始权限。支持楼宇列表、楼宇对比及可解析的单子市场上下文。需要指定正式季度时返回 `period_required`。成交库可传 `lease-search`，包括 `dataset`、`from`、`to`、`buildingIds`、`submarkets`、`view` 与可选 `direction`。`view` 可为 `transactions`、`industry-count` 或 `industry-area`。服务端沿用成交查询的独立导出、明细权限和分组披露阈值。 |
| POST `add_to_pitch` | 传相同 `handoff`、预览 `fingerprint`、稳定 `taskId` 和显式 `target`。追加使用 `mode: append, expectedVersion`；新建使用 `mode: create, projectId, title, scope, themeId, themeVersion`。新建和排队在同一事务。后台重新读取并核对事实，应用整个任务结果时持有项目版本锁。 |

任务收据保留 `state`、`attempts` 和实际阶段 `preparing`、`assembling`、`saved`。在请求结果不确定时用原 `taskId` 与原始参数重放，已完成的任务返回原回执。跨模块确认请求的精确重放在新查数之前读取原任务，保留原目标版本及审批指纹。取消、重试及审批继续使用现有权限和版本控制。

GET `export_eligibility` 返回指定受众是否获授权、项目版本以及每页拦截原因。POST `export_start` 保留既有 `page`、`pages` 选择约定，支持 PPTX、PDF、高清 PNG、SVG 与 XLSX。所选页面中任何一页不符合要求时返回 403 及页面列表，调用方可以改选。审核通过的导出按所选页固定资产和图片版本，下载时复核；已完成的文件继续使用自己的权限清单。PPTX 继续由统一 Scene 写出原生对象。PDF 逐页复用 2560 像素场景渲染，适用于固定版式阅读。旧导出记录沿用原工作流读取。同一账号重复导出相同版本、页序、格式、受众和权限清单时，可复用同一渲染版本的归档文件。每个请求仍保留自己的回执和下载鉴权。

楼宇图片、地图、Stacking Plan 的新授权解析和新 Scene 由各自专项接入。项目编辑仍限所有者。现有页面素材可按记录版本复用。


## 指定账号演示

| 命令 | 调用与结果 |
| --- | --- |
| POST `share_create` | 所有者传 `projectId`、`expectedVersion`、`shareId`、`recipientId`、可选有顺序的 `slideIds` 和 `expiresAt`。创建内部实名只读演示，并固定当前保存版本。重复原请求返回原回执。 |
| GET `shares` 和 POST `share_revoke` | 所有者查询最近 50 条回执，按 `projectId` 和 `shareId` 撤回。过期或撤回后的旧入口失效。 |
| GET `shared_presentation` | 收件人用自己的登录会话和 `shareId` 打开页面目录。分享指定了页面时，目录沿用该顺序。 |
| GET `shared_slide` | 收件人传 `shareId` 和目录中的 `slideId` 获取同一 Scene 渲染的 SVG。服务器在渲染前后复核账号、授权、版本、来源和媒体。 |

接收账号须具备项目所在范围的 Pitch 查阅授权，并能查看页面所用的已发布素材。所有者可以显式分享自己撰写的页面。包含租赁与季度快照的生成页暂未开放跨账号分享，继续沿用账号绑定的授权。对客交付使用独立的披露检查和正式导出。持有分享编号本身不产生访问权限。共享版本复用修订历史，活跃分享保留固定版本，后续编辑不会改写演示内容。
