# Pitch Studio 3.0 文档工作流

项目继续使用现有页面、快照、版本和私人所有权。此处的工作台命令使用 `/api/intelligence/pitch/workspace`。导出使用 `/api/intelligence/pitch`。

| 命令 | 调用与结果 |
| --- | --- |
| GET `document_bindings` | 传项目 ID。返回页面固定素材版本、披露、原始来源及内容块的业务／人工／素材来源。现有季度与成交快照记录字段、查询参数、政策、权限版本及业务日期。 |
| POST `preview_data_refresh` | 传 `projectId`、`slideId`、`expectedVersion` 和可选正式 `period`。按所选页的快照复核同组关联页，比较数据值和真实来源版本，并返回审阅指纹及结论复核提示。 |
| POST `apply_data_refresh` | 使用相同参数和审阅指纹。正式事实和来源、项目版本或权限出现变化时需重新核对。保存同时提交替换数据的私有归档及项目新版本，历史恢复沿用 `restore`。版式或分页无法安全保留时拒绝保存。含独立研究素材的组合页暂不开放自动刷新。 |
| POST `apply_modification` | 传共享 `DocumentModificationPlan`，支持已有 `PageEdit` 的受控更新。默认 `scope: selected`，其余页自动保留。显式 `scope: document` 时传完整目标顺序和原始页版本，可复制、删除及排序。可选 `theme` 指定已注册主题版本。数据更新走带审阅指纹的刷新命令。 |
| POST `review_handoff` | 传共享 `AddToPitch`。楼宇与子市场由当前账号查询授权及正式季度数据解析。Colliers AI `analysis-result.id` 接受获权查数存档的请求 ID，复核当前会话和原始权限。支持楼宇列表、楼宇对比及可解析的单子市场上下文。需要指定正式季度时返回 `period_required`。 |
| POST `add_to_pitch` | 传相同 `handoff`、预览 `fingerprint`、稳定 `taskId` 和显式 `target`。追加使用 `mode: append, expectedVersion`；新建使用 `mode: create, projectId, title, scope, themeId, themeVersion`。新建和排队在同一事务。后台重新读取并核对事实，应用整个任务结果时持有项目版本锁。 |

任务收据保留 `state`、`attempts` 和实际阶段 `preparing`、`assembling`、`saved`。在请求结果不确定时用原 `taskId` 与原始参数重放，已完成的任务返回原回执。取消、重试及审批继续使用现有权限和版本控制。

GET `export_eligibility` 返回指定受众是否获授权、项目版本以及每页拦截原因。POST `export_start` 保留既有 `page`、`pages` 选择约定，支持 PPTX、PDF、高清 PNG、SVG 与 XLSX。所选页面中任何一页不符合要求时返回 403 及页面列表，调用方可以改选。审核通过的导出按所选页固定资产和图片版本，下载时复核；已完成的文件继续使用自己的权限清单。PPTX 继续由统一 Scene 写出原生对象。PDF 逐页复用 2560 像素场景渲染，适用于固定版式阅读。旧导出记录沿用原工作流读取。

楼宇图片、地图、Stacking Plan 的新授权解析和新 Scene 由各自专项接入。现有项目仍按私人所有权读取。现有页面素材可按记录版本复用。
