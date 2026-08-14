# Security

- 所有公开 schema 业务表均启用 Row Level Security。
- `anon` 角色没有业务表权限。
- 浏览器只使用 `sb_publishable_...`。
- `sb_secret_...` 和第三方服务密钥只允许在服务端环境中使用。
- 禁止把真实 `.env.local`、数据库导出或账号密码提交到 Git。
- 生产环境密钥应定期轮换，并遵循最小权限原则。
