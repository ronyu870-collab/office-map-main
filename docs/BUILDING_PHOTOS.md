# 楼宇图片与来源

## 适用范围

地图现有楼宇和带 `building_id` 的未来供应可关联多张图片。`public.building_photos` 记录网络图片的楼宇归属、原图链接、来源页面、说明和可选私有副本，与业主销控、佣金和历史楼书资料分开。收集时间不代表拍摄、竣工、出租或业主确认时间；效果图、施工照、室内照应在 `photo_kind` 与说明中据实区分。

沿用楼宇身份规范：用系统中已存在的 `buildings.id`，同名项目、园区与单栋楼座须核对地址、项目名称和画面，不把园区概览伪装为某栋外观。原两栋试点照片继续走既有 `building-media-pilot`；新图片不依赖试点名单和试点开关。

## 表与文件

迁移：`supabase/migrations/20261105153236_building_photos.sql`，由 Supabase CLI 3.0.0 的 `migration new` 生成文件名。

| 字段 | 含义与约束 |
| --- | --- |
| `id`、`building_id` | 图片 UUID、楼宇外键；删除楼宇受外键保护 |
| `image_url` | 原始 HTTPS 图片地址；同楼宇同地址唯一 |
| `source_url`、`source_name` | 确认图片与楼宇关联的来源页面和来源名称；页面允许 HTTP/HTTPS |
| `attribution_text`、`license_url` | 可选摄影者/版权署名（最多500字）和 HTTPS 许可页；有许可要求的图片必须保留并在看图时显示 |
| `caption`、`photo_kind` | 1–160 字说明；exterior / interior / rendering / construction / other |
| `storage_path` | 现有私有 bucket `building-sales-materials` 内 `building-photos/v1/{building_id}/{photo_id}/{file}`；仅 jpg/jpeg/png/webp |
| `width`、`height`、`file_size`、`sha256` | 原文件尺寸、字节数、SHA-256；私有副本必须齐全且有效 |
| `status`、`sort_order` | pending / ready / archived；默认 pending、顺序非负 |
| `collected_at`、`created_at`、`notes` | 收集及记录时间、核对说明；未知拍摄时间保持未知 |

启用前应完成楼宇匹配、图片实际下载解码、尺寸与内容核对；私有副本上传后按字节数及摘要回读核验，最后将记录置为 `ready`。复制原链接也可展示，无私有副本时 `storage_path` 为 null。业务服务器不会代抓任意 URL。归档只需将状态改为 `archived`，地图随后刷新不再列出；已发出的私有签名链接最长剩余 300 秒有效。无需改 bucket 公私有属性。

仅维护服务器能直接读写表，`anon`、`authenticated` 均无表权限，RLS 再次限制浏览器角色。浏览器只使用 `/api/map/data` 的 `id/caption` 摘要；展开看图后，`/api/map/building-photos` 根据真实登录及有效身份校验角色、active/tracked 楼宇、图片 ID 与 building_id、ready 状态。存储路径必须属于这一张照片，私有链接有效 300 秒；外链须是无凭据的公共 HTTPS 域名，来源页另按 HTTP/HTTPS 校验。

## 交互与审计

详情默认折叠；看图、翻页按张读取，返回已经显示的图片不重复请求。收起、关闭或切换楼宇取消未完成请求；失败提供重试。没有明确许可链接的照片在地图看图中只显示图注，来源、摄影及授权说明仍保存在照片记录中。带许可链接的照片保留来源、署名和许可入口，外部链接以新标签页打开且不传递 opener/referrer。数据库说明经 HTML 转义，来源与署名使用文本节点。

点已加载的照片打开大图；大图复用当前照片与图注，多图可用按钮、左右方向键或触屏横滑翻页。关闭大图回到地图详情的当前照片，不收起看图。单图不显示翻页控件。

`BUILDING_PHOTO_ACCESS` 由服务器记录真实调用账号，同时保留 `effective_user_id` 和 `is_impersonating`。批次维护使用 `BUILDING_PHOTO_IMPORT`，记录管理员账号、`details.executor`、批次、楼宇/图片计数与核验信息；不把工具维护伪装为网页登录。中文审计说明与徽标由 `auditTranslator` 提供。

## 发布与验证

先在精确 PR head 的 Verify 中通过 PostgreSQL 17.6 约束与权限回归，再执行生产迁移，最后发布依赖该表的代码。真实数据库测试创建独立随机库，使用纯合成数据并清理，不接受远程连接或环境中的生产 PG 凭据。

执行验证与实际限制记在 [本次验证记录](verification/building-photos-20261105.md)。此文档定义实现契约，不表示生产照片数量或上线状态；批次清单和生产回读结果另行记录。
