from pathlib import Path

p = Path('scripts/identity_permission_hardening.py')
t = p.read_text()
old = "t = must_replace(t, \"        const isDemo = isDemoMode(session.user?.email);\\n        if (!isUserAdmin(session.role) && !isDemo) {\", \"        if (!isUserAdmin(session.role)) {\", 'Monitoring demo guard')"
new = "t = must_replace(t, \"        // 权限校验：admin、demo 可以访问\\n        const isDemo = isDemoMode(session.user?.email);\\n        if (!isUserAdmin(role) && !isDemo) {\", \"        // 权限校验：仅真实 admin 可以访问\\n        if (!isUserAdmin(role)) {\", 'Monitoring demo guard')"
if old not in t:
    raise RuntimeError('monitoring patch statement not found')
p.write_text(t.replace(old, new, 1))
