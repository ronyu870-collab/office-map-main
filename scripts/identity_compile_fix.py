from pathlib import Path

p = Path('src/components/OSSManager.tsx')
t = p.read_text()
old = """    try {
      setIsImpersonating(Boolean(sessionStorage.getItem('__impersonation_state')));
    } catch {
      setIsImpersonating(false);
    }
"""
if old not in t:
    raise RuntimeError('legacy Research impersonation setter block not found')
p.write_text(t.replace(old, '', 1))
