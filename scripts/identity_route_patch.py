from pathlib import Path

def replace(path: str, old: str, new: str, label: str):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise RuntimeError(f'missing route patch anchor: {label}')
    p.write_text(text.replace(old, new, 1))

p = 'src/app/map/MapRouteGate.tsx'
replace(p,
"import { useAppSession } from '@/src/components/SessionProvider';",
"import { useAppSession } from '@/src/components/SessionProvider';\nimport { getModuleAccessDecision } from '@/src/utils/accessControl';\nimport { logAction } from '@/src/utils/audit';",
'Map imports')
replace(p,
"  const { status } = useAppSession();",
"  const { session, status } = useAppSession();",
'Map app session')
replace(p,
"""  React.useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
  }, [router, status]);

  // Preserve the P0 security contract: MapClient, AMap and map data requests are
  // never mounted until the shared root session has resolved as authenticated.
  if (status !== 'authenticated') return <MapAuthLoading />;

  return <MapClient />;""",
"""  const decision = React.useMemo(
    () => getModuleAccessDecision('map', session?.role, { email: session?.user.email }),
    [session?.role, session?.user.email],
  );

  React.useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
      return;
    }
    if (status === 'authenticated' && session && !decision.allowed) {
      if (session.user.email) logAction(session.user.email, 'ENTER_MODULE', { module: 'map', blocked: true, reason: decision.reason, source: 'route_guard' });
      router.replace('/');
    }
  }, [decision.allowed, decision.reason, router, session, status]);

  // MapClient, AMap and map data requests never mount before both authentication
  // and the canonical role decision have resolved successfully.
  if (status !== 'authenticated' || !session || !decision.allowed) return <MapAuthLoading />;

  return <MapClient />;""",
'Map guard')

p = 'src/app/oss/page.tsx'
replace(p,
"import { LoadingState } from '@/src/components/ui/State';",
"import { LoadingState } from '@/src/components/ui/State';\nimport { getModuleAccessDecision } from '@/src/utils/accessControl';\nimport { logAction } from '@/src/utils/audit';",
'OSS imports')
replace(p,
"""        if (!session) {
          router.replace('/login');
          return;
        }
        setUserEmail(session.user.email ?? '未知用户');""",
"""        if (!session) {
          router.replace('/login');
          return;
        }
        const decision = getModuleAccessDecision('oss', session.role, { email: session.user.email });
        if (!decision.allowed) {
          if (session.user.email) logAction(session.user.email, 'ENTER_MODULE', { module: 'oss', blocked: true, reason: decision.reason, source: 'route_guard' });
          router.replace('/');
          return;
        }
        setUserEmail(session.user.email ?? '未知用户');""",
'OSS guard')

# Extend regression source contract.
p = Path('src/__tests__/identity-permission-hardening.test.ts')
t = p.read_text()
anchor = """  it('uses local sign-out and durable logout enqueue', () => {"""
addition = """  it('keeps Map and Research direct routes on the canonical policy', () => {
    expect(source('src/app/map/MapRouteGate.tsx')).toContain("getModuleAccessDecision('map'");
    expect(source('src/app/oss/page.tsx')).toContain("getModuleAccessDecision('oss'");
  });

"""
if anchor not in t:
    raise RuntimeError('missing regression test anchor')
p.write_text(t.replace(anchor, addition + anchor, 1))
