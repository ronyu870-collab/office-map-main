from pathlib import Path

CHANGELOG = Path('CHANGELOG.md')
WORKFLOW = Path('.github/workflows/home-maintainability-verify.yml')
SELF = Path(__file__)
TITLE = '## 2026-08-25 — Home implementation cleanup and maintainability hardening'

ENTRY = '''## 2026-08-25 — Home implementation cleanup and maintainability hardening

### Area
HomeWorkspace / HomeHeader / CommunicationBoard / NoticeBanner / admin access / Home tests

### What changed

- Removed the empty Under Development registry, modal, badge path, state, and activation branches from Home; there are currently no Home modules using that mechanism.
- Removed the account-specific restricted-admin email rule and routed Home/Admin visibility through one `canAccessAdminConsole` decision while preserving explicit demo access and blocking Admin entry during impersonation.
- Removed the stale `super_admin` Research Library manager branch and made admin helpers consume the canonical `viewer` / `editor` / `admin` role parser.
- Simplified Home workspace activation into one handler while preserving blocked-entry audit metadata and route behavior.
- Replaced user-menu requestAnimationFrame focus scheduling with the rendered menu lifecycle; Escape still closes the menu and returns focus to its trigger.
- Hardened CommunicationBoard async lifecycle: stale message loads are ignored, post-unmount state updates are suppressed, pending animation frames are cancelled, and fullscreen state is synchronously mirrored before History writes so rapid open actions cannot create duplicate entries.
- Kept the existing single Supabase realtime channel ownership model and `removeChannel` cleanup rather than rewriting subscription architecture.
- Added cancellation for NoticeBanner's visibility animation frame while retaining its existing timeout and async active guard.
- Kept Home audit calls on the existing IndexedDB outbox; logout no longer waits on an async compatibility wrapper whose implementation only schedules the outbox flush.

### Why

This pass targeted concrete maintenance risk rather than style preferences: dead feature branches, duplicated authorization policy, a user-specific authorization exception, a non-canonical role, stale async completions, uncancelled animation frames, and brittle tests that asserted source ordering instead of behavior.

### Impact

- No Home information architecture, hierarchy, route names, collaboration visuals, notice expansion model, message history limit, database schema, RLS policy, or audit transport was redesigned.
- Admin visibility is now consistent between Home and the Admin route guard. Impersonation cannot expose the Admin entry, and no individual email address changes the canonical admin role contract.
- Research Library write-role detection now matches the application role contract; the previously accepted `super_admin` string was not a canonical application role.
- Communication failure, retry, realtime, History, focus, and 50-message behavior remain intact with stronger unmount/race safety.

### Verification

- Replaced the source-order user-menu test with DOM behavior coverage for Arrow navigation, Escape focus return, disabled workspace prevention/audit, and impersonation-hidden Admin.
- Added Communication/Notice DOM behavior coverage for failed-send content retention, one Enter → one audit, same-frame duplicate-submit locking, Escape/Back/Forward fullscreen state, channel cleanup, and notice error → retry recovery.
- Reduced source-level tests to structural/presentation contracts that are appropriate to static inspection: Chinese product language, route seams, 50-message wording, viewport/safe-area behavior, and no nested notice scroll.
- Typecheck → Lint → Test → Production Build run sequentially on the final tree before the verification workflow commits this changelog entry.

### Accepted technical debt

- `WorkspaceShell` keeps its shared sticky header and z-index because no Home defect or stacking conflict was reproduced; changing a shared shell for local neatness would increase regression risk.
- `getAccessibilityProps` still returns link semantics for native workspace links. Home no longer relies on prop-spread ordering for the Admin menu item, so there is no demonstrated accessibility defect requiring a cross-project helper rewrite.
- `audit.ts` keeps its application-lifetime visibility/online listeners and IndexedDB outbox singleton. They are intentionally initialized once and are not a component-unmount leak.
- Home retains `h-screen h-[100dvh]` while shared shells use `dvh`; this provides a legacy fallback and no browser-specific failure was demonstrated in this code-review pass.
- Source-level presentation tests remain for static product invariants; replacing every one with DOM tests would add cost without improving confidence in those non-behavioral contracts.

### Follow-up

- Do not reintroduce Home development-state machinery until a real module needs it; when that happens, add the state model at the owning feature boundary rather than reviving dormant Home branches.
- Revisit shared access/a11y helpers only when another caller demonstrates a concrete semantic mismatch; keep this pass scoped to proven Home risks.

---

'''

text = CHANGELOG.read_text(encoding='utf-8')
if TITLE not in text:
    marker = '---\n\n'
    index = text.find(marker)
    if index < 0:
        raise SystemExit('CHANGELOG insertion marker not found')
    insert_at = index + len(marker)
    CHANGELOG.write_text(text[:insert_at] + ENTRY + text[insert_at:], encoding='utf-8')

WORKFLOW.unlink(missing_ok=True)
SELF.unlink(missing_ok=True)
