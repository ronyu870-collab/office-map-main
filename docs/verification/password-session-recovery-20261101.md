# 改密会话恢复验证（2026-11-01）

## 范围与版本

- 基线：远端 main `05fc9a54e2a56a4cf81018551266c1045102145d`；独立分支 `codex/password-session-recovery`。原工作区的其他任务改动未移动、覆盖或纳入本次修复。
- 用户故事：临时密码或普通登录 → 设置改密 → 当前标签页返回真实主页 → 同浏览器刷新 → 退出 → 刷新登录页 → 旧密码被拒 → 新密码加正确手机号登录成功。
- 本文记录本地实现与测试快照，未修改线上账号或密码。2026-11-02 用户明确授权提交与上线：最终 PR head 的 Verify 通过后才可合并；实际 CI、合并和生产部署结果在对应 PR 与发布记录追溯，不从本地测试推断生产完成。

## 实现与保留边界

`passwordChange.ts` 沿用已有经过身份验证的改密接口。确认保存成功后，以同一账号和新密码建立替换会话，校验账号和服务端 `must_change_password === false`，不再刷新已撤销的旧会话。该步骤延续当前已登录账号的账户操作；初始登录、退出后重登仍执行原有邮箱、密码、手机号三项校验。

设置页从共享 Provider 读取账户状态，显式刷新并确认新会话，再返回首页。Provider 为请求保留代次，强制刷新、新认证事件和退出使旧结果失效；旧请求的清理也不会误清除更新请求。

已保存而会话重建失败时，本地退出并清除认证缓存，返回可操作的登录页。非敏感标签页提示保留至登录成功；不保存密码，不清理业务草稿，不更改设备信任期限。没有新增 Auth 客户端实例或绕过共享客户端及审计。

服务端密码接口、Admin 权限、模拟模式只读约束、会话撤销策略及审计语义不变；没有数据库迁移或数据修复。

## 自动回归

新测试使用真实设置页、实际改密 HTTP handler、真实共享 Auth 服务、Supabase JS/Auth 2.111.0、设备感知存储和 SessionProvider。仅网络 Auth/PostgREST 边界为合成夹具：密码写入会撤销全部旧 session，之后使用新密码签发新 session。未声明网络请求直接报错，不使用线上凭据。

新增 12 项：

- 普通/强制改密 × 可信/非可信设备四组，核验新令牌、主页、缓存清理后重挂载、退出、旧密码拒绝、新密码登录、手机号不匹配拒绝、单设备业务标识和一次改密审计。
- 旧 access token 已过期时完成改密和替换会话。
- 保存成功但重新认证与退出端点都失败时，认证状态仍清除，草稿保留，产生正确提示。
- 服务端拒绝保存时，保留原会话、不记录成功审计、不跳首页。
- 替换会话仍携带强制改密标记时拒绝进入首页。
- 模拟身份请求在服务端被拒绝，未改密码。
- Provider 的强制刷新、退出、新登录三项竞态。

在同一套测试和夹具下，通过 Vite source loader 将设置页、登录页和 Provider 替换为基线原实现：**10 失败、2 通过**。失败均为业务断言，非环境启动错误。修复后这 12 项和已有共享会话测试合计 **13 项通过**。

测试文件位于现有 Vitest 自动发现路径。`.github/workflows/verify.yml` 的 `npm run test` 会运行这些测试；未新增可跳过的开关或独立于 CI 的必需回归。

```sh
npm run test -- src/app/settings/__tests__/password-change-session.test.tsx src/components/__tests__/SessionProvider.auth-races.test.tsx src/components/__tests__/SessionProvider.shared-session.test.tsx
npm run verify
```

最终仓库门槛：审计覆盖、TypeScript、Lint（0 错误，既有警告）、**140 个文件 / 918 项测试**、Next 16.2.12 生产 webpack 构建通过。涉及文件的唯一 Lint 警告位于原有 `useStandaloneSession` 初始化 effect，原实现同样存在。

## 真实浏览器

入口：`scripts/check-password-change-browser.mjs`。独立生产 Next/webpack 构建加载真实根布局、登录页、设置页、主页、改密路由、审计路由、共享 SDK/Provider 和正式 Tailwind 样式；没有用替代主页或模拟跳转来代替业务结果。

Chrome `156.0.8078.75`，1280px 与 390px，每个宽度覆盖普通/强制改密和可信/非可信设备，共 **8 组**。每组均实点 UI 完成保存、主页、刷新、退出、刷新登录页、旧密码拒绝、新密码重登；另验证重新认证与退出服务故障时，登录提示及其刷新保留。

最终结果见同目录 [结构化浏览器记录](password-session-recovery-20261101/results.json)。页面异常、外部网络请求和未知夹具请求均为 0。另检查了改密后主页和重新登录提示的实际页面截图。

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
CHROME_PATH=/path/to/chrome \
node --experimental-strip-types scripts/check-password-change-browser.mjs
```

浏览器 runner 使用本机合成 Auth/PostgREST 与空消息 Realtime 协议服务；此证据覆盖应用边界及真实 SDK/持久化/浏览器行为，不声称验证了生产 Auth 服务签发。390px 启用触控模拟，不能代替实体 iOS Safari/Android Chrome；真实手机、生产部署和实际线上会话未测试。

## 过程问题与处置

- 初版回归证明旧实现无法满足新会话与首页断言。
- 首次全库验证发现新增测试 fixture 的 TypeScript 强制转换不完整，已修正并重新运行；不是既有基线失败。
- 首轮浏览器完整流程通过，但错误恢复提示被重复的 `/login` 跳转覆盖。改为标签页提示，不依赖 URL 参数顺序，并实测刷新后仍可见。
- 浏览器夹具初版缺少正式 PostCSS 配置、Realtime 应答格式也与实际 SDK 不符。修正测试环境后重新执行全部场景，最终没有将无样式页面或夹具异常冒称合格浏览器证据。
- 默认沙箱不允许监听本机端口，浏览器测试经环境自动审批在本机隔离服务上运行；没有使用生产写入。
