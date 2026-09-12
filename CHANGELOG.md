## 2026-09-12 — Intelligence recommendation-first shortlist

### Area
Intelligence / DeepSeek requirement understanding / real-data building retrieval / recommendation ranking / Map / Proposal

### Changed
- Reframed Intelligence from a natural-language filter assistant into an AI site-selection advisor: one client requirement now returns a ranked building shortlist directly.
- Split demand semantics into hard filters, ranking preferences, explicit system assumptions, and conditions requiring Broker verification.
- Treats phrases such as “优先甲级” as a ranking preference rather than silently filtering out non-A-grade alternatives; explicit phrases such as “只考虑甲级” remain hard constraints.
- When the client gives a rent ceiling without naming the rent basis, the recommendation stage explicitly assumes the platform's net-effective-rent basis instead of blocking the workflow; the assumption is shown to the Broker.
- Added deterministic recommendation ranking from real `buildings`, latest `building_metrics`, and `building_brochure_data`, with explainable recommendation reasons and data-completeness metadata.
- Area and move-in timing remain verification-required while real-time unit availability is absent; standard-floor area and quarterly vacancy are never represented as live availability.
- Map is now a downstream spatial-review action rather than the place where the Broker must manually discover recommendations.
- Top five real recommended building IDs can seed the existing session-scoped Proposal Builder in one click.

### Verification
- Added business-semantics tests for grade preference vs hard constraint, default net-effective-rent assumption, real hard-budget filtering, and availability disclaimers.
- Added a product-contract test that keeps direct recommendation as the primary Intelligence flow and prevents regression to the parser-first UI.

# Engineering Changelog

This document is the durable record of meaningful product and engineering changes to the Colliers Data Platform.

It is intentionally more detailed than Git commit titles. Every non-trivial code, database, infrastructure, security, or workflow change should add an entry here in the same pull request.

## Entry format

Each entry should include:

- Date
- Area
- What changed
- Why it changed
- User or system impact
- Verification performed
- Follow-up work, if any

Do not use this file for raw commit-by-commit history. Group related implementation work into one clear entry.



---

## 2026-09-12 — Intelligence candidate proposal builder

### Area
Intelligence / Map / proposal draft / client recommendation workflow

### What changed

- Added a session-scoped proposal draft that starts when a user confirms a structured Intelligence requirement. The draft stores only parsed requirement structure and selected building IDs/names; it does not persist the original free-text client requirement or create proposal-history rows in Supabase.
- Added an Intelligence-only Map action, `加入客户方案`, to building info windows with a five-building cap and selected/full states. Normal Map entry remains unchanged.
- Added a lazy proposal basket overlay on Map with selected candidates, removal/clear controls, and navigation to a proposal builder.
- Added `/intelligence/proposal`, which reads selected buildings from the existing `buildings`, latest `building_metrics`, and `building_brochure_data` sources.
- Added deterministic requirement-match scoring based only on location, net-effective rent, and grade conditions that were actually validated and applied to the Map handoff. Unsupported, confirmation-only, or semantically skipped conditions are excluded from scoring.
- Added a separate data-completeness indicator so richer records are not confused with stronger client fit.
- Added rule-based recommendation evidence, explicit latest metric periods, and disclaimers distinguishing quarterly vacancy/standard-floor fields from real-time availability or currently leasable unit area.
- Added manual candidate ordering, removal, client/project naming, and browser print / Save as PDF output for the Pilot preview.

### Why

The previous milestone stopped at natural-language requirement → real Map candidates. This change closes the next broker workflow step: candidate selection → explainable shortlist → client-facing proposal preview, while preserving the data-trust boundary around missing availability data.

### Impact

- Intelligence users can build a five-project shortlist without affecting existing Map, Quarterly Update, Lease Submission, or Research Library workflows.
- No Supabase schema, RLS, or proposal-history persistence was introduced in this phase. Drafts live only for the current browser tab/session.
- Proposal scores are deterministic and inspectable; no model-generated facts or hidden recommendation weights are used.

### Verification

- Added scoring tests for supported-field-only scoring, daily/monthly rent basis conversion, and separation of match score from data completeness.
- Added source-contract coverage for session-only draft storage, five-project cap, Intelligence-only Map mounting, real Supabase data reads, and missing-data disclaimers.
- Full repository verification is required before merge.

### Follow-up

- Persist approved proposal history only after a dedicated Supabase schema/RLS design.
- Add real availability/current-unit data when `building_current_data` has production records; until then area/move-in conditions remain non-scoring constraints.

---

## 2026-09-11 — Intelligence → Map controlled handoff

### Area
Intelligence / Map / filter adapter / client requirement workflow

### What changed

- Added a deterministic Intelligence-to-Map adapter that converts only supported AI-extracted conditions into the existing `SidebarFilterState`; no second filtering engine was introduced.
- Added explicit daily-to-monthly conversion for net-effective rent (`365 / 12`) because customer requirements use RMB/㎡/day while the existing Map metric is RMB/㎡/month.
- Tightened rent capability semantics so asking rent and unspecified rent remain confirmation-only; only net-effective rent can be applied automatically.
- Mapped validated building grades into the Map's existing 甲级写字楼 / 乙级写字楼 / 产业园区 categories using the same grade semantics as `MapDataStore`.
- Refused mixed district/submarket OR expressions that the current Map cannot represent without changing meaning, rather than silently converting them into an AND filter.
- Passed the handoff through the Next.js map route boundary, seeded the existing filter state and filter command, and retained the existing authentication gate before `MapClient` mounts.
- Added an Intelligence context strip on Map with live candidate count, removable existing filter chips, and a return path to Intelligence.
- Added a one-time initial `fitToBuildings` for Intelligence entry only; normal Map filtering continues to preserve the user's current viewport.
- Logged the derived Map filter as the existing `MAP_FILTER` audit action with `source=intelligence`; raw customer requirement text is not included.

### Why

The AI parser is useful only when its confirmed output can enter the real broker workflow. The handoff must preserve semantic correctness, units, existing map behavior, and data trust boundaries rather than letting model output bypass established filter semantics.

### Impact

- Brokers can now go from natural-language client need → reviewed structured conditions → real candidate projects in the existing Map.
- Unsupported area, move-in timing, generic metro preference, ambiguous rent basis, and other partial conditions remain visible in Intelligence but are not applied to Map.
- Existing Map entry, manual filtering, project list, comparison mode, data loading, permissions, Supabase schema/RLS, and non-Intelligence users are unchanged.
- The URL contains only validated derived filter values and capability keys, not the raw client requirement.

### Verification

- Added unit coverage for rent conversion, grade mapping, unsupported-condition exclusion, mixed-location semantic protection, and malformed URL rejection.
- Added integration source contracts for the Intelligence button, async map `searchParams` boundary, authenticated route gate, existing filter-state seeding, one-time auto-fit, and candidate-context UI.
- Final delivery requires the repository Verify workflow (audit coverage, TypeScript, lint, tests, production build) and Vercel deployment checks to pass on the exact merge head.

### Follow-up

- The next product increment should let a broker select candidates from the filtered Map and add them to a customer proposal draft; do not start proposal generation before that selection state is explicit.


---

## 2026-09-11 — Intelligence preview and DeepSeek requirement parsing

### Area
Home / Intelligence / DeepSeek AI / authenticated API / data trust boundary

### What changed

- Added the gated `/intelligence` Pilot Preview and a Home entry that is visible to admins by default, with an environment flag for later authenticated-role rollout.
- Added live database status for buildings, quarterly metrics, lease transactions, lease-term coverage, building brochures, future supply, and current availability records; operational KPI values are queried rather than hard-coded.
- Added an authenticated `/api/intelligence/parse-requirement` endpoint that calls DeepSeek through its Responses API and requests strict JSON Schema output.
- Added a server-only DeepSeek configuration contract (`DEEPSEEK_API_KEY`, configurable base URL/model/fallback) with no `NEXT_PUBLIC_` AI secret.
- Added deterministic post-model validation: district, submarket, and grade normalizations are accepted only when they match vocabulary read from the current building database.
- Added a business-capability resolver that explicitly prevents desired unit area and move-in timing from becoming live filters while the system lacks reliable availability/unit data, and marks ambiguous rent/metro semantics for confirmation.
- Added AI usage audit metadata (model, token counts, duration, prompt length, capability statuses) without storing the raw client requirement in the audit payload.
- Enabled the Intelligence client requirement card to submit natural-language needs and render supported, partially supported, and unsupported conditions before any map action is allowed.

### Why

The Intelligence workbench needs AI language understanding without allowing a model to become a source of market truth. Separating model extraction, database vocabulary validation, and deterministic business capability checks creates a stable trust boundary before AI-derived conditions are allowed to drive the existing Map filter engine.

### Impact

- Existing Map, Quarterly Update, Lease Submission, Research Library, Admin, Supabase schema, and existing broker workflows are unchanged.
- Intelligence Preview users can structure a client requirement when the server-side DeepSeek key is configured; if it is missing or the provider is unavailable, the page fails visibly without fabricating a result.
- The model receives only the user's requirement plus small district/submarket/grade vocabularies, not the building inventory, transaction dataset, or other internal database rows.
- The map handoff remains intentionally disabled in this increment, so an AI result cannot yet alter production map state.

### Verification

- Added resolver tests for hallucinated vocabulary rejection and unsupported availability semantics.
- Added source-contract tests for server-only AI credentials, authenticated Preview access, JSON Schema output, and privacy-preserving AI audit metadata.
- The repository's permanent Verify workflow (audit coverage, TypeScript, lint, tests, production build) must pass on the final branch head before merge.

### Follow-up

- Configure `DEEPSEEK_API_KEY` in Vercel server-side environment variables; do not commit the key.
- Add the next controlled step: confirmed structured conditions → Map filter adapter → existing `/map` workbench.
- Only after that flow is stable should Intelligence add proposal generation or multi-step agent/tool workflows.

---

## 2026-08-27 — Lease team visibility and loading resilience

### Area
Lease Submission / team-submissions API / authorization

### What changed

- Restored the team transaction summary for both `editor` and `admin` roles. Editors can view the complete summary but cannot manage team records; management actions remain admin-only.
- Kept the server-side role check as the authorization boundary for the service-role API route, so viewers and unknown roles remain denied.
- Bounded Supabase calls in the team API to 10 seconds and capped the function at 30 seconds. The client also cancels an unresponsive team request after 12 seconds, allowing the page to settle with an actionable error instead of loading indefinitely.
- Made the supplementary active-account lookup fail closed for identity display: if it is unavailable, transaction data still loads while submitter identities are masked.
- Added structured timing logs for successful and failed team API requests, without logging access tokens or user data.

### Why

The UI had incorrectly limited the team table to administrators, while the team API was observed timing out at Vercel's 300-second runtime limit. One optional account-status query could block the entire data response.

### Impact

- Editors can now inspect the team-wide transaction table in read-only mode.
- Admins regain a bounded team-data load path and retain team record management.
- A transient Supabase/Auth failure now produces a retryable error or masked names rather than a permanently loading page.

### Verification

- Added role-access and timeout regression contracts; full project verification and production deployment confirmation are recorded with the delivery commit.
- Browser testing was intentionally not run, per delivery instruction.

### Follow-up

- Apply the repository's pending database RLS migration in a separately controlled database change; it is not required for this API-enforced UI fix.


## 2026-08-27 — Global UI detail hardening and product visual consistency

### Area
Shared UI foundation / Home / Login / Map / Quarterly Update / Lease Submission / Research Library / Settings / Admin

### What changed

- Extended the existing visual tokens and shared UI layer with a canonical 54px application header, consistent control sizing, restrained surface/focus colors, `AppHeader`, `IconButton`, and an accessible shared `Dialog`.
- Removed redundant visible product identities, decorative English labels, fake app icons, repeated Admin headings/breadcrumbs, oversized metadata badges, and card/shadow treatments without business meaning.
- Standardized visible role names to 管理员 / 编辑用户 / 查看用户 while preserving backend role identifiers and authorization behavior.
- Reworked Admin navigation into concise 用户 / 数据 / 审计 / 系统 / 开发 groups, removed duplicate group-item naming, and calmed User, Database, Submission, diagnostics, modal, table, and toolbar presentation.
- Aligned Map loading and loaded identity to 北京办公楼市场地图; retained the existing map data, marker, LabelsLayer, MassMarks, InfoWindow, and rendering-performance architecture.
- Translated ordinary Quarterly workspace structure and field labels to Chinese, migrated its page loading/empty/error states and incomplete-submission confirmation to shared primitives, and retained Q1–Q4 plus data-level identifiers; all submission, validation, and calculation behavior is preserved.
- Aligned Lease, Research, Settings, and Login shells and controls with the same product language while preserving their workflow, upload/storage, authentication, warning, and validation semantics.
- Deleted the legacy Quarterly and Lease `concise.css` files and removed their imports instead of rendering helper copy and hiding it with brittle selectors.
- Added and strengthened cross-page, Chinese-language, minimal-copy, Admin navigation/role, scroll-layout, and Map identity contracts without locking tests to arbitrary Tailwind snapshots.

### Why

The application had coherent individual workspaces but inconsistent identity, typography, spacing, color, modal, and state conventions across routes. This pass removes decorative hierarchy and restores a calm, dense, data-first product language without redesigning business workflows.

### Impact

- No Supabase schema, API contract, permissions, authentication, impersonation, audit behavior, Map data/runtime architecture, Quarterly data logic, Lease data logic, OSS semantics, or save/submit/validation behavior changed.
- Ordinary visible UI is Chinese-first. Q1–Q4, LEED, PDF, Excel, URLs, developer-only API/schema identifiers, and user-supplied English names remain where they convey real domain or data meaning.
- The implementation was prepared on `fix/global-ui-detail-hardening-zh` and delivered to `main` only after the final verification gates passed.

### Verification

- `npm run verify` passed on the final tree: TypeScript, ESLint with 0 errors / 657 existing warnings, 48 test files / 290 tests, and the Next.js production build.
- Login was inspected at 1440×900, 1366×768, 1280×800, 390×844, and 430×932 with no page overflow or runtime overlay; protected routes were confirmed to redirect to Login when unauthenticated.
- Authenticated multi-route browser QA was explicitly cancelled before delivery and is not claimed.

### Follow-up

- If a later visual acceptance pass is requested, cover authenticated routes, modal/ESC/Back behavior, long content, focus, overflow, and 125% zoom; this is not part of the current delivery.


## 2026-08-25 — Home implementation cleanup and maintainability hardening

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

## 2026-08-25 — Home collaboration information-layer final QA

### Area
Home / Team Activity / System Notices / Market Communication / mobile fullscreen behavior

### What changed

- Kept Home collaboration as a visually secondary, read-only summary: system notices remain capped at three until explicitly expanded, and market communication remains a four-message summary until the user opens the full surface.
- Preserved the full market-communication boundary at the most recent 50 messages and kept all user-facing copy explicit about that limit rather than implying permanent chat history.
- Hardened message time formatting so Beijing-time timestamps remain unambiguous across calendar years.
- Added a synchronous send lock in addition to the rendered sending state so rapid repeated Enter/click submissions cannot race before React commits the disabled state.
- De-duplicated realtime INSERT payloads by message id while retaining the existing single Supabase channel lifecycle and unmount cleanup.
- Preserved history-aware fullscreen behavior, focus trapping/return, and the new-message affordance so users reading older messages are not forced back to the bottom by realtime inserts.
- Added `viewport-fit=cover`, top/bottom safe-area handling, and retained `100dvh` fullscreen sizing for mobile/PWA viewport behavior.
- Widened and fixed the notice date column so current-year and cross-year Beijing dates remain aligned without adding an internal notice scroller.
- Added source-contract regression coverage for read-only Home behavior, 50-message limits, subscription lifetime, rapid sending, failure/retry copy, history/focus behavior, realtime reading behavior, cross-year dates, safe areas, and notice expansion/error states.

### Why

The Home information layer is an auxiliary collaboration surface inside a market-data product, not a general-purpose chat product. Final QA therefore focused on correctness under failure, realtime updates, history navigation, mobile viewport changes, and extreme content without increasing its visual weight or adding chat-oriented UI patterns.

### Impact

- No Home information architecture, Map priority, database schema, RLS policy, auth/session boundary, message table shape, or permanent-history/pagination feature was added.
- Fullscreen toggles do not create additional Supabase subscriptions; the channel remains owned by the mounted CommunicationBoard and is removed on unmount.
- Sending failures retain the original input and expose retryable feedback; initial load failures remain visibly different from true empty states.
- Notice expansion continues to use page-level scrolling. Even for 10+ notices, Home does not reintroduce nested scrolling; if notice volume becomes structurally high, grouping/archive design should be handled as a separate product decision.

### Verification

- Added `communication-final-qa.test.ts` source-contract regression coverage alongside the existing Home presentation tests.
- Typecheck → Lint → Test → Production Build passed sequentially on the final source/changelog tree before this entry was committed.
- A real authenticated soft-keyboard pass at 390×844 and 430×932 is not claimed in this run because the connected Vercel account does not expose the office-map project. The implementation contract uses `100dvh`, `viewport-fit=cover`, safe-area insets, and a history entry so Android/PWA Back can close the communication surface before leaving Home; native keyboard behavior remains a device-level release check when an authenticated Preview is reachable.

### Follow-up

- Do not add pagination or “load more” solely because the UI currently keeps 50 messages. Add historical retrieval only if a durable collaboration-history requirement emerges.
- When an authenticated office-map Preview is available, repeat the native soft-keyboard open/close cycle on Android/PWA and an iOS-style viewport without changing the current information hierarchy unless a reproducible defect is observed.

---

## 2026-08-25 — Cross-page Product Continuity QA

### Area
Home → Map / Quarterly Update / Lease Submission / Research Library / Settings / Admin

### What changed

- Kept the Home information architecture unchanged and treated its Chinese workspace names as the product-language contract for destination pages.
- Aligned Map route loading and first-screen identity to “北京办公楼市场地图” while preserving the full-canvas GIS workbench.
- Replaced legacy visible English workspace/status language in Quarterly and Lease Data Entry with Chinese equivalents without changing their dense data-entry topology or business logic.
- Reframed the /oss surface visibly as “研究资料库 / 资料检索”; storage implementation terminology remains internal, and upload/management actions remain permission-gated.
- Aligned Settings and Admin top-level identity to “设置” and “系统管理”, and translated visible Admin navigation groups/section names without changing routes, permissions or backend section keys.
- Added source-contract regression coverage for canonical destination names, legacy-label removal, Map loading-shell continuity and return-to-Home seams.

### Why

Home had reached a coherent Chinese product language, but several destination pages still presented old English product identities and status vocabulary. That created the impression of navigating between separate systems even though routes, permissions and business workflows were shared.

### Impact

- Home structure and module priority are unchanged.
- Map remains a GIS workspace; Data Entry remains dense; Research remains retrieval-first; Admin remains a compact backend.
- Global Arial + Chinese fallback typography, Colliers brand blue, existing border/radius tokens, permissions, session boundaries, audit behavior and data flows are preserved.
- All audited destination shells retain explicit return-to-Home links; Browser Back behavior remains native route history rather than being replaced with custom navigation.

### Verification

- Added cross-page-product-continuity.test.ts source-level regression coverage.
- Typecheck → Lint → Test → Production Build are run in sequence on the exact patched working tree before the branch commit is created.
- A current authenticated deployment-level click/Back visual pass is still blocked if Vercel Preview cannot be created or accessed; this must be reported separately rather than inferred from source tests.

### Follow-up

- When a reachable authenticated Preview is available, repeat the critical click/Back paths at desktop and 390–430px mobile widths, focusing on first-paint/header continuity and overlay behavior.

## 2026-08-25 — Home visual hierarchy rebuild

### Area
Home / information architecture / Chinese product language / responsive workspace entry

### What changed

- Rebuilt Home as a restrained internal data-workspace entry instead of continuing the previous enterprise-marketing treatment.
- Removed visible English eyebrows, English module titles, marketing labels, Map metric badges, oversized CTA treatment, redundant brand copy, and unnecessary badge-driven hierarchy from Home.
- Standardized visible Home product language to Chinese while retaining the Colliers brand logo.
- Reduced the content width and right-rail weight, kept Map clearly first without a giant hero, and replaced the secondary card wall with one consistent divider-based workspace list.
- Simplified Communication Board and Notice presentation so collaboration information remains functional but visually secondary to Map and data-entry work.
- Aligned the Home loading shell with the loaded layout and moved mobile Admin below Notice / Communication while keeping the existing permission decision unchanged.
- Added presentation-contract regression coverage for Chinese labels and the existing session, authorization, audit, route, Communication, and Notice seams.

### Why

The prior Home 2.0 combined tiny uppercase labels, mixed Chinese and English, badges, nested cards, a visually heavy Map hero, and a high-contrast collaboration rail. Those rules fragmented the typography and spatial hierarchy and made the page feel assembled from generic enterprise UI UI motifs rather than designed as one stable internal data workspace.

### Impact

- Map remains the primary Home entry; Quarterly Update, Lease Submission, Research Library, and Administration retain their existing routes and access rules.
- Shared Session Context, authentication boundaries, role restrictions, demo mode, restricted-admin handling, ENTER_MODULE / LOGOUT audit events, development-module behavior, settings, logout, Communication Board, and Notice behavior remain intact.
- Mobile ordering now prioritizes Map, data entry, Research, then Notice / Communication, with Admin last when available.
- No database, RLS, Map runtime, Data Entry, Admin, or Research Library internal-page behavior changed.

### Verification

- Added source-level presentation regression tests that avoid pixel-value assertions.
- GitHub Verify must pass Typecheck, Lint, Test, and Production Build on the exact final head before merge.
- An authenticated real-browser visual pass at the requested desktop/mobile viewports remains a release requirement; the current execution environment blocks external Chromium navigation and must not be treated as a successful visual QA result.

### Final browser QA acceptance

- Ran the Home against a deterministic production build with real Chromium at 1366×768, 1440×900, 1920×1080, 390×844, 430×932, plus 1024×768 and 1280×720.
- Exercised loaded/session-transition states, empty/one/many/error notices, empty/populated/error market communication, long names, long announcements/messages/unbroken URLs, viewer-denied workspace access, normal/admin/demo user menus, notice expansion, mobile scrolling, full-screen communication, Escape handling, and 100dvh behavior.
- Fixed one browser-observed interaction defect: generic module accessibility props were overriding the System Administration entry's `role=menuitem`, causing menu keyboard navigation to skip that entry for admin/demo states. The menu now preserves menuitem semantics while retaining its existing disabled/accessibility metadata.
- No Home information architecture, database/RLS behavior, Map/Data Entry/Admin business logic, or speculative visual modules were added.
- Observed proportions were retained: 54px header, current desktop gutters/rail widths, 1240px base container with the existing 1360px 2xl expansion, 104px Map entry, and current mobile single-column rhythm.

### Follow-up

- Keep future Home changes focused on observed workflow friction; do not reintroduce decorative English labels, badge-driven hierarchy, or marketing-style hero treatment.


---

## 2026-08-25 — Data 2.0 Performance Hardening

### Area
Map / route loading / Trend / production bundle / performance regression

### What changed

- Established reproducible 100/300/500-building MapDataStore and marker-construction baselines before changing runtime code.
- Removed the duplicate first marker build previously triggered once by `MapController.initMap()` and again by the managed `MapClient` lifecycle.
- Started the lazy Trend ECharts runtime import in parallel with the building-history query after explicit Trend intent, preserving existing stale-render race guards.
- Moved the admin-only `BuildingMetricsEditModal` behind a client-side dynamic import so normal Map entry no longer eagerly includes that secondary editor surface.
- Added stable source-contract regression coverage for the single initial marker owner, Trend lazy/parallel loading order, route-shell split, and admin-only chunk split.
- Recorded measured baselines and explicit `unable to measure` browser rows in `docs/performance-baseline.md`; no wall-clock timing was added as a CI gate.

### Why

Profiling showed that indexed filtering was already negligible at 500 buildings, while Map entry contained duplicate marker work and Trend contained a true serial waterfall. The changes therefore target proven structural waste rather than adding speculative memoization, caches, virtualization, or database changes.

### Impact

- Permissions, role filtering, map/filter results, compare groups, Admin behavior, audit logging, database schema and RLS remain unchanged.
- MapClient is now the single owner of first role-aware marker rendering.
- Trend remains lazy relative to Map startup but no longer waits for the history request before beginning its chunk load.

### Verification

- Baseline GitHub Actions: Typecheck, Lint, Test (238 tests), Production Build all passed.
- Final acceptance requires the clean post-profiling head, with temporary timing/workflow files removed, to pass the same four gates.

### Follow-up

- Capture real authenticated Chrome Performance/React Profiler/network traces when a production-like office-map deployment is available; do not infer AMap overlay or InfoWindow latency from fake objects.


---

## 2026-08-25 — Admin / Research Library 2.0

### Area
Administration / Research Library / OSS / authorization / responsive internal data workspaces

### What changed

- Reorganized every existing Admin tool into stable Users & Access, Data Management, Audit & Activity, System / Operations, and Development / Maintenance groups without adding speculative modules.
- Added explicit current-module context plus responsive Admin drawer navigation, while retaining database management, users, submissions, schema, OSS, notices, memos, issues, changelog, audit logs, impersonation, data diagnostics, and display-overrides maintenance.
- Hardened `/admin` authorization so the management console resolves the real Supabase session and no longer treats impersonation state as an authorization shortcut.
- Rebuilt Research Library around current-directory search, file-type filtering, sorting, result counts, dense desktop rows, compact mobile rows, and consistent loading/error/empty/no-result/retry states.
- Added explicit per-file upload queue state with real upload progress, success/failure status, duplicate-name detection, unsupported-file handling, and visible completion state.
- Preserved existing folder navigation, open/download, upload, create-folder, file rename/move, recursive folder deletion, batch deletion, and audit logging behavior.
- Forced Research Library management controls into read-only mode during user impersonation.
- Required authenticated bearer-token access for OSS directory listing because list results contain one-hour signed download URLs; write actions remain server-validated for admin/super_admin only.
- Removed OSS environment/object debug logging and added behavior-focused regression tests for Admin access policy, Library filtering/sorting, and upload preflight rules.

### Why

Administration had accumulated real operational tools without a stable information architecture, while Research Library still behaved primarily as a raw OSS manager. High-frequency internal administration needs dense navigation and clear destructive-action hierarchy; research users need to locate and judge documents before opening them rather than browse giant file cards.

The audit also found two authorization weaknesses worth correcting in the same scope: Admin UI could be admitted by client impersonation state, and OSS directory listing returned signed download URLs without authenticating the caller.

### Impact

- Administration and Research Library now share the Colliers Data 2.0 page, button, state, spacing, typography, and table language while retaining different business purposes.
- No Admin module, database schema, RLS policy, data field, or existing destructive confirmation semantics were removed.
- Normal Research Library browsing remains available to authenticated users; management remains restricted to admin/super_admin and is disabled during impersonation.
- Desktop layouts remain table-first; 390–430px Research Library layouts preserve search, browsing, open/download, and management actions without forcing the desktop table horizontally off-screen.

### Verification

- Added regression coverage for the existing Admin role boundary and restricted-admin exception, Research Library manager roles, current-directory search/filter/sort behavior, duplicate detection, and unsupported upload formats.
- Final acceptance requires the exact post-changelog PR head to pass the permanent Verify workflow in order: Typecheck, Lint, Test, and Production Build.

### Follow-up

- Continue Admin table-level refinements only where observed operational workflows justify them; do not add speculative backend modules for visual completeness.
- If Research Library volume grows beyond the current OSS listing limit, introduce server-side indexed search as a separate data/backend change rather than silently expanding this UI refactor.

---

## 2026-08-25 — Data Entry 2.0 for Quarterly Update and Lease Submission

### Area
Quarterly Update / Lease Submission / shared data-entry primitives / validation / save state / responsive business workflows

### What changed

- Rebuilt Quarterly Update as a dense Data Entry workspace while preserving assignments, Admin preview, impersonation read-only behavior, prior-quarter metrics, future-supply assignments, 30-second cloud drafts, existing calculation formulas, force-submit semantics, submission tables, and audit logging.
- Added persistent save-state presentation for unsaved, saving, saved, failed/retry, submitting, and submitted states; retained manual save in addition to the existing timed cloud-draft sync.
- Organized Quarterly fields into project context, previous-quarter reference, and current-quarter entry groups; added Enter/Tab-friendly continuous entry, inline advisory validation, mobile field cards, and stable submission confirmation.
- Rebuilt Lease Submission as a compact Broker Data Entry workspace with entity-first building selection, recent-building shortcuts, relocation/original-location handling, daily/monthly rent input, existing fuzzy-duplicate confirmation, on-behalf submission, current/previous-quarter selection, record editing, transfer, and Admin team views.
- Preserved the existing custom sub-industry path when `其他` is selected, including existing custom values during edit.
- Added a persistent Lease success state showing the written company, building, area, quarter, and record ID, with explicit Continue adding / Return to workspace actions.
- Added shared `SaveStatus`, `ValidationMessage`, and `DataEntryToolbar` primitives only where both workflows use the same semantics.
- Added regression coverage for Quarterly completeness/payload calculations, Lease existing-record mapping and period window, persistent error/retry state, and server-side authorization seams.

### Why

Quarterly Update and Lease Submission were functionally mature but still behaved like legacy page/form surfaces. High-frequency Broker, Research, and Admin entry needs dense navigation, visible validation near the affected field, explicit database/save state, and reliable continuation after a successful write.

### Impact

- No DB schema, RLS, Map architecture, MapDataStore, MapController, or Auth architecture changes.
- Existing permissions, server-side Admin checks, record ownership checks, data fields, validation services, duplicate checking, audit calls, and submission destinations are preserved.
- Newly surfaced Quarterly anomaly checks are warnings only; no unsupported business rule was introduced as a hard validation block.
- Desktop remains the primary high-density experience; 390–430px layouts keep major fields and submit actions reachable without forcing the full desktop grid onto mobile.

### Verification

- Final acceptance requires the exact PR head to pass the permanent Verify workflow in order: Typecheck, Lint, Test, and Production Build.
- Regression coverage includes validation, save/error retry state, existing records, calculation payloads, and authorization boundaries.

### Follow-up

- Continue Data Entry refinement only from observed Broker/Research usage; do not change DB schema or authorization boundaries as a UI follow-up.

---

## 2026-08-25 — Map final experience QA and interaction hardening

### Area
Map 2.0 / final experience QA / responsive overlays / markers / InfoWindow / accessibility

### What changed

- Added a single presentation-level dismissal contract for Filter, Future Supply, and Project List: existing mutual exclusion is retained, while Escape or returning directly to the map canvas closes any open large workspace.
- Fixed the Future Supply workspace height contract so its content scrolls inside the available panel height on short desktop and mobile viewports rather than being clipped below its header.
- Tightened the command/KPI/filter/supply surfaces toward the Colliers Data 2.0 border-led 4–8px radius language with less blur and shadow.
- Reworked full building, dot, future-supply, submarket, and competitor marker chrome through route-scoped presentation rules: lower shadow, less hover scaling, squarer GIS symbols, and a smaller aggregate footprint while preserving all data-driven colors and render-mode semantics.
- Made building/future InfoWindow content and the competitor toolbar viewport-aware without changing Building Detail, Trend, contact, compare, filtering, or AMap lifecycle behavior.
- Replaced the list-to-marker bounce with a short subtle emphasis and removed noisy Map/filter development diagnostics while retaining warnings/errors.
- Added behavior-level regression coverage for Escape and direct map-canvas dismissal rather than locking implementation-specific CSS strings.

### Why

Final QA of the Map 2.0 presentation found release-quality interaction and responsive risks: large workspaces could remain open after users returned to the map, the Future Supply body could exceed the panel height, marker chrome still read like a consumer map, InfoWindow widths assumed desktop space, and the competitor toolbar had a fixed 520px minimum width.

### Impact

- Map remains the dominant work surface across desktop, narrow desktop, and mobile layouts.
- Dense marker areas retain more base-map context and hover feedback is less distracting.
- Filter, Future Supply, Project List, InfoWindow, and competitor workflows coordinate more predictably without changing data or authorization semantics.
- Keyboard users gain a consistent Escape path for all large map workspaces.

### Verification

- The permanent repository Verify workflow must pass Typecheck, Lint, Test, and Production Build on the exact PR head before merge.
- Browser-level inspection was attempted against the existing Vercel preview; authenticated visual QA is not claimed where the execution environment cannot access the repository's Vercel team/session.

### Follow-up

- Do not reopen MapDataStore, useMapRuntime, MapRouteGate, auth/session, Supabase/RLS, or AMap lifecycle for further visual tuning unless a separate reproducible behavioral bug is found.

---

## 2026-08-25 — Map 2.0 project inventory and presentation density

### Area
Map 2.0 / project inventory / building detail / InfoWindow / filters / marker presentation

### What changed

- Reworked the floating project list into a dense market-inventory panel with compact rows as the default view and a retained detail-card mode.
- Restyled building detail cards around net effective rent, vacancy, data quarter, and compact property attributes instead of large floating cards.
- Added map-route-scoped presentation overrides for AMap InfoWindow chrome, building-marker shadow/saturation, and embedded SidebarFilter density.
- Kept the existing marker data-driven colors, list slicing and IntersectionObserver loading, search/filter callbacks, building hover/click behavior, InfoWindow action handlers, and trend/competitor/contact flows unchanged.

### Why

The first Map 2.0 slice established the full-canvas workbench but several nested surfaces still used the previous large-card, high-radius visual language. This pass aligns the high-frequency inventory/detail surfaces with the professional, dense, institutional GIS-workbench direction without reopening map behavior or data semantics.

### Impact

- More projects and metrics fit in the visible map workspace with less visual obstruction.
- Building comparison is faster because rent, vacancy, area, data quarter, submarket, and grade are exposed in a consistent tabular hierarchy.
- InfoWindow, filter, and marker presentation now visually align with the Map 2.0 shell while their existing runtime contracts remain intact.
- No authentication, Supabase/RLS, MapDataStore filtering, useMapRuntime lifecycle, or MapController behavioral changes are included.

### Verification

- The pre-slice interaction-fix head `0592c2033905922f7aef747602e8016e7184df0d` passed Typecheck, Lint, Test, and Production build in Verify #94.
- The final second-slice head must pass the same four gates before this draft PR is considered ready for further visual work.

### Follow-up

- Perform browser-level visual inspection when an accessible preview is available, with emphasis on 360–430px widths, InfoWindow clipping, filter-scroll density, and marker readability at each zoom tier.
- Continue visual refinement through presentation seams; do not use this slice to change filtering semantics or AMap lifecycle ownership.

---

## 2026-08-24 — Map architecture split and lazy trend-chart runtime

### Area
Map workbench / authentication boundary / client runtime / filtering architecture / frontend bundle performance

### What changed

- Converted `/map` into a small route shell with `MapRouteGate`, reusing the root `SessionProvider` rather than resolving a second route-level session before mounting the map workspace.
- Preserved the P0 authorization boundary: `MapClient`, AMap, and map data work do not mount until the shared application session is authenticated.
- Extracted shared Map domain logic from the monolithic `MapClient` into `mapDomain`, including filter defaults, render modes, statistics, district LEED aggregation, active-filter chips, and the current five-bucket future-supply calendar.
- Replaced the historical supply-calendar test that duplicated a stale six-bucket implementation with tests against the production domain model.
- Added `MapDataStore` with reusable building-id, district, submarket, grade, LEED, and project-type indexes. Production filtering now uses the store while preserving source ordering, viewer/editor/admin visibility, compare-group semantics, numeric filters, keyword search, and delegated subway-distance checks.
- Extracted the imperative AMap lifecycle into `useMapRuntime`, isolating controller creation, initialization, admin-mode synchronization, readiness, error handling, and destruction from the Map workspace component.
- Removed all top-level ECharts runtime imports and registration from `MapController`. Building Detail → Trend now loads `trendChartRuntime` with a dynamic `import()` only after the user opens the Trend panel and usable history exists.
- Reduced the lazy trend runtime to the chart features actually used by this flow: `LineChart`, `GridComponent`, `TooltipComponent`, and `CanvasRenderer`; the previous unused `BarChart` and `LegendComponent` registrations are no longer loaded for this feature.
- Added race guards around the lazy chart load so closing the panel or switching buildings before the chunk/render frame completes cannot draw a stale chart.
- Added architecture regression coverage that fails if runtime `echarts/*` imports are moved back into `MapController` or if the dynamic trend-runtime boundary is removed.
- Removed all one-time codemod/workflow tooling after each large-file migration; the permanent CI surface remains the repository Verify workflow.

### Why

`MapClient` had accumulated route authentication, session resolution, data loading, filtering, statistics, future-supply derivation, imperative AMap lifecycle, event bridges, and UI state in one client component. `MapController` also statically registered ECharts even though trend charts are an optional detail interaction. That architecture made the Map workspace harder to change safely and forced chart code into the normal map dependency path before a user requested it.

This split establishes stable boundaries before the Map 2.0 visual migration: route/session gating, pure domain derivation, indexed data selection, imperative map runtime, and optional chart runtime can now evolve independently without mixing visual redesign with behavioral rewrites.

### Impact

- Normal Map entry no longer has a static runtime dependency on ECharts through `MapController`; the chart runtime becomes an on-demand chunk for Trend usage.
- Map authentication reuses the application-level session owner while retaining the existing fail-closed mount boundary.
- Repeated filter interactions can use prebuilt indexes instead of embedding the entire selection engine inside the React effect, while existing result semantics and ordering remain unchanged.
- AMap controller lifecycle code is isolated from workspace rendering, reducing the risk that role/session UI changes recreate or leak the map instance.
- No Map 2.0 visual redesign, Supabase schema change, RLS change, or intentional broker workflow change is included in this architecture PR.

### Verification

- Added/updated focused coverage for the route session gate, shared supply-calendar model, indexed Map data store, AMap runtime lifecycle, and lazy ECharts bundle boundary.
- Implementation head `c331a013cee8cb147c1bf0e8e9d4f980f0b53412` passed the repository Verify workflow in order: Typecheck, Lint, Test, and Production build.
- Final acceptance still requires the exact post-changelog/cleanup PR head to pass the same four gates before merge.

### Follow-up

- Use these architecture boundaries as the base for the Map 2.0 visual/workbench migration rather than combining another behavioral rewrite with the UI redesign.
- Measure representative Map entry and first- Trend-open timings after deployment to quantify the practical effect of the lazy chart split in addition to the source-level bundle-boundary regression test.
- Continue reducing `MapController` responsibilities only where a stable behavioral seam exists; do not turn this PR into a broad rewrite of every legacy map interaction.

---

## 2026-08-24 — Home 2.0 workspace and shared session context

### Area
Home workspace / authentication session lifecycle / navigation information architecture

### What changed

- Converted the root `SessionProvider` from timeout-only infrastructure into the single application-session owner. It now exposes `useAppSession()` with shared `session`, `status`, and `refreshSession` state while retaining trusted-device expiry, 30-minute inactivity handling, password-change redirects, and Supabase auth-state synchronization.
- Removed the Home page's independent `getSessionFast()` request and client-side auth gate. The route is now a small server shell that mounts `HomeWorkspace`, which consumes the already-resolved root session.
- Added a regression test proving that two workspace consumers under one root provider still trigger only one `getSessionFast()` resolution.
- Rebuilt Home as the first real Colliers Data 2.0 consumer of the design system:
  - Map Workbench is the dominant primary entry;
  - Quarterly Update, Lease Submission, Research Library, and Administration are explicit business workspaces;
  - Administration remains visible only to the same admin/demo audience as before;
  - lease-submission role restrictions, fail-closed authorization, audit metadata, keyboard activation, impersonation-compatible session resolution, and the existing development-module gate are preserved.
- Moved Communication Board and Notice into a visually secondary Team Activity rail so collaboration information no longer competes with the core market/data workspaces.
- Preserved the fixed workbench layout contract (`h-screen` / page overflow hidden) and kept scrolling inside workspace regions, including the Communication Board, to avoid reintroducing the historical page-scroll regression.
- Refined `WorkspaceShell` so fixed workbench consumers can use a true flex-column shell with a min-height-zero content region and internal overflow management.

### Why

The previous Home page resolved authentication independently even though the root layout already mounted `SessionProvider`. That left route rendering dependent on an additional client effect and duplicated the session ownership model. At the same time, Home still behaved like a feature-card portal rather than an institutional commercial-real-estate data workspace.

This migration makes session ownership explicit at the application shell and gives the product a clearer hierarchy: market intelligence first, business data workflows second, team communication third.

### Impact

- Authenticated route transitions can reuse root session state instead of asking Home to resolve the same session again.
- Home presents a more stable, dense, institutional workspace without changing broker authorization rules or data contracts.
- Viewers remain blocked from Lease Submission; editors/admins retain access; special admin/demo visibility behavior is preserved.
- The existing Communication Board and Notice components remain operational but are no longer part of the critical visual path.
- No Supabase schema, RLS policy, API contract, or Map runtime behavior changes in this PR.

### Verification

- Added `SessionProvider.shared-session.test.tsx` to lock the one-provider/one-auth-resolution contract across multiple consumers.
- Existing repository preservation tests continue to define the required fixed Home layout, keyboard interaction, Communication Board availability, and responsive behavior.
- Final acceptance requires the exact PR head to pass Typecheck, Lint, Test, and Production build through the repository Verify workflow.

### Follow-up

- PR 3: begin the behavior-preserving Map architecture split before changing the Map visual workspace.
- Migrate additional authenticated routes to `useAppSession()` only when their existing route-specific guards can be removed without weakening authorization.
- Capture Home before/after timings using the Phase 0 performance-baseline scenarios after the merged version is available in a representative deployment.

---

## 2026-08-24 — Colliers Data 2.0 UI foundation and performance baseline

### Area
Design system / workspace layout / frontend performance observability

### What changed

- Established the first Colliers Data 2.0 design-token layer under `src/styles/tokens.css`, covering workspace/surface colors, text hierarchy, brand and semantic colors, spacing, typography scale, radii, shadows, z-index, and motion durations.
- Updated global typography to the intended institutional system stack (`Arial`, `PingFang SC`, `Microsoft YaHei`, system sans-serif) while preserving the existing Colliers brand color contract.
- Added reusable UI primitives for Button, Input, Badge, Panel, PageHeader, Toolbar, and Loading/Empty/Error states.
- Added a reusable `WorkspaceShell` that supports the different navigation, GIS, data-entry, and administration workspace layouts without forcing every page into one card template.
- Added `PerformanceReporter` using Next.js Web Vitals reporting plus browser long-task observation. Measurements are published as a local `colliers:performance` browser event and are logged in development; no telemetry is transmitted externally.
- Added `docs/performance-baseline.md` defining repeatable Home, Map, Quarterly Update, Lease Submission, and Admin measurement scenarios plus user-perceived latency targets.
- No existing business page has been migrated to the new primitives in this foundation change; the refactor remains behavior-preserving by design.

### Why

The current product has accumulated page-specific colors, radii, headers, loading patterns, and large client-side workspaces. Beginning the 2.0 redesign by directly restyling Home or Map would create another layer of one-off UI decisions and would make performance claims subjective.

This change therefore establishes two prerequisites first: a shared visual language appropriate for a dense commercial-real-estate intelligence workbench, and a common measurement contract that subsequent Home, Map, data-entry, and Admin refactors can use for before/after comparisons.

### Impact

- Existing workflows and permissions are intentionally unchanged.
- Subsequent pages can adopt consistent visual primitives without duplicating style decisions.
- Future performance work can distinguish immediate visual feedback, route-shell responsiveness, browser long tasks, and network/data completion instead of treating them as one vague loading-time metric.
- The new foundation does not introduce an analytics backend or send performance data outside the browser.

### Verification

- The branch is intended to pass the repository `npm run verify` quality gate before merge.
- Pull-request CI will be used as the authoritative TypeScript, lint, test, and production-build verification because this connected GitHub editing environment does not execute the repository locally.
- The first consumer migrations are intentionally deferred so verification can isolate foundation/API correctness from page-level behavioral changes.

### Follow-up

- PR 2: migrate the authenticated system shell and Home workspace to the new foundation and remove duplicate session-gating behavior where safe.
- PR 3: split Map state/runtime responsibilities while preserving current Map UI before the Map 2.0 visual migration.
- Add richer primitives such as Select, SearchInput, Drawer, Popover, FilterChip, and table-specific controls when a real workspace migration requires them rather than building unused abstractions up front.
- Capture concrete production-like before/after measurements for each migrated workspace using the baseline scenarios.

---

## 2026-08-24 — P0 dependency security baseline

### Area
Dependency security / spreadsheet ingestion / supply-chain risk

### What changed

- Replaced the npm-registry `xlsx@0.18.5` package with SheetJS' official `0.20.3` distribution, removing the known Prototype Pollution and ReDoS advisories that affected the old parser on the real admin spreadsheet-upload path.
- Hardened XLSX ingestion independently of the package upgrade:
  - only `.xlsx` uploads are accepted;
  - upload size is capped at 25 MiB;
  - worksheet processing is capped at 10,000 data rows and 500,000 cells;
  - parsing is restricted to the data features this workflow actually needs instead of enabling formula, HTML, style, or VBA extraction;
  - pure tests cover file-type, file-size, row, and cell budgets.
- Removed `puppeteer-core` from production dependencies after repository-wide usage review found no imports or runtime calls. This also removed the unused `@puppeteer/browsers -> extract-zip` high-severity advisory chain instead of taking an unnecessary Puppeteer major upgrade.
- Kept `ali-oss@6.23.x` rather than downgrading the SDK. Scoped its legacy HTTP stack with an `ali-oss -> urllib@2.41.0` override and regenerated the lockfile with Node.js 22.
- Applied only the non-breaking updates available through `npm audit fix`; `npm audit fix --force` was intentionally not used.
- Removed all temporary dependency-audit and dependency-fix GitHub Actions after the lockfile and advisory graph were captured. The permanent CI surface remains the standard read-only Verify workflow.

### Why

The previous dependency baseline reported 24 vulnerabilities (7 low, 2 moderate, 14 high, 1 critical). Several were not merely scanner noise: the old SheetJS parser handled administrator-selected workbooks directly, while an unused Puppeteer dependency carried a high-risk archive-extraction chain. The critical finding came from the legacy `vm2` sandbox inside an old optional PAC/proxy dependency path rather than from application code.

The goal was to eliminate reachable or unnecessary high-impact risk without converting the security cleanup into an uncontrolled major-version migration. In particular, forcing every transitive dependency to the newest incompatible version only to reach an artificial audit count of zero would create larger regression risk than the remaining non-critical advisories justify.

### Impact

- The admin Excel workflow keeps the same user-facing import/export contract while using a patched SheetJS release and explicit resource budgets.
- Malformed or oversized workbooks are rejected before unrestricted worksheet processing.
- The unused Puppeteer runtime and its browser-download/extraction dependency graph are no longer shipped.
- The previous critical `vm2` advisory is no longer present in the final audit baseline.
- The dependency tree is smaller and its residual security debt is explicit rather than hidden.

### Verification

- Node.js 22 / npm 10 regenerated `package-lock.json` from the committed dependency declarations.
- The original audit baseline was 24 vulnerabilities: 7 low, 2 moderate, 14 high, 1 critical.
- After the targeted changes and non-force audit fixes, `npm audit` reports **11 residual vulnerabilities: 4 low, 1 moderate, 6 high, 0 critical**.
- The residual report is transitive and is concentrated in the legacy optional proxy/network path around `ali-oss` / `urllib` (`proxy-agent`, `pac-proxy-agent`, `pac-resolver`, `ip`, `@tootallnate/once`) plus current transitive `ip-address` and `qs` advisories. No `vm2`, `xlsx`, `puppeteer-core`, or `extract-zip` advisory remains in the final captured report.
- Final merge acceptance still requires the exact post-changelog head to pass Typecheck, Lint, Test, and Production build and to receive both Vercel preview checks; those checks are intentionally outside this historical audit snapshot rather than being faked into the record before they run.

### Follow-up

- Revisit the remaining Ali OSS optional proxy-chain advisories when Alibaba publishes a stable SDK/dependency graph that removes the old proxy stack, or when there is a tested compatible override that does not alter OSS request behavior.
- Continue consuming non-breaking fixes for `ip-address` and `qs` as their parent dependency ranges allow them to resolve cleanly.
- Do not use `npm audit fix --force` as a substitute for dependency-path review.

---

## 2026-08-24 — P0 Verify baseline recovery

### Area
TypeScript / lint / tests / production build / CI baseline

### What changed

- Repaired the historical TypeScript baseline without disabling strict type checking:
  - removed stale test imports for the deleted `/bi` route;
  - aligned Zod 4 error configuration and React Hook Form resolver typing;
  - typed OSS authorization headers as a valid string header record;
  - updated AG Grid configuration to current API/type contracts;
  - corrected audit-log callback typing, nullable building-area handling, lease-service field drift, and the test environment's `NODE_ENV` mutation.
- Aligned stale tests with current product contracts instead of preserving deleted behavior:
  - keyboard access-control coverage now targets the real `lease-submission` restriction rather than `/bi`;
  - MapController destruction tests now assert removal of the global comparison bridge after `destroy()`;
  - page-scroll preservation tests reset Auth state between cases and deterministically mock the current Update page dependencies;
  - lease-transaction tests now exercise the current fuzzy duplicate-detection/query path and include the current `.limit()` query stage.
- Kept lint as a blocking repository-wide gate. Broad pre-existing React Compiler / React hooks / `no-explicit-any` migration debt is reported as warnings rather than converted into hundreds of risky product refactors inside this baseline PR.
- Corrected the ESLint flat-config rule scope so the `react` plugin is available where `react/no-unescaped-entities` is overridden.
- Removed all temporary one-time codemod/workflow machinery after it had served its migration purpose. The permanent Verify workflow is back to `contents: read` and runs only `npm ci`, typecheck, lint, tests, and production build.

### Why

The Verify workflow existed but was not a usable merge gate because historical TypeScript drift stopped the pipeline before lint, tests, and production build could execute. Once typecheck was repaired, stale tests and an ESLint flat-config scoping issue surfaced additional baseline failures.

The goal of this work was to make the existing quality gate truthful again: current code should be checked against current contracts, real failures should still block merging, and historical migration debt should not be hidden by skipping checks or by weakening the workflow itself.

### Impact

- No intended business/product behavior change.
- Pull requests can now reach and execute all four blocking gates: TypeScript, lint, tests, and production build.
- Historical test suites now validate routes, authorization rules, query chains, and lifecycle behavior that actually exist in the current application.
- Lint still runs across the repository and remains merge-blocking for non-baselined errors; legacy warning debt remains visible for gradual cleanup.

### Verification

- On the clean branch with temporary tooling removed, Verify run #30 (`32698149384`) completed successfully through all four sequential gates: Typecheck, Lint, Test, and Production build.
- The test stage passed after the previously observed 26 failures across page-scroll preservation, keyboard navigation, lease-transaction service, and MapController lifecycle tests were corrected.
- Production build executed for the first time after the repaired upstream gates and completed successfully; it was not skipped.
- Both Vercel preview projects (`office-map-main` and `colliersdata`) were Ready on the pre-changelog head. The changelog-only final head must still receive its own complete Verify and Vercel checks before merge.
- `npm ci` currently reports 24 dependency vulnerabilities (7 low, 2 moderate, 14 high, 1 critical). These are not silently treated as resolved by this baseline recovery.

### Follow-up

- Gradually reduce the remaining lint warning baseline, especially React Compiler/hooks and `no-explicit-any` debt, through scoped behavior-preserving refactors.
- Triage the 24 dependency vulnerabilities separately; avoid blanket `npm audit fix --force` updates without regression review.
- Consider updating GitHub Actions major versions after validating compatibility with the current runner/runtime.
- P0: generate and adopt typed Supabase database definitions.
- P0: remove excessive debug logging and sensitive diagnostic output.

---

## 2026-08-24 — P0 authentication and authorization boundary tightening

### Area
Authentication / authorization / Supabase RLS / sensitive API access

### What changed

- Unified the application role contract to exactly `viewer`, `editor`, and `admin`, matching the database role constraint. Removed the stale `executive` role from the canonical TypeScript role model and admin impersonation UI.
- Replaced the stale restricted-module entry `deals` / `/deals` with the real `lease-submission` / `/lease-submission` module. The lease-submission workspace now explicitly allows `editor` and `admin`; `viewer` is denied.
- Changed module authorization helpers to fail closed for missing or unknown roles instead of treating unrecognized identities as generally accessible.
- Added a route-level guard for `/lease-submission` so direct URL navigation cannot bypass the homepage module restriction.
- Added a pre-mount authentication gate for `/map`. The heavy map client, AMap runtime, and map data requests are not mounted until a valid session has been resolved.
- Added Supabase migration `20260824043500_tighten_auth_boundaries.sql` to move viewer data scoping into Postgres RLS:
  - `viewer` can read stock buildings only when grade is exactly A or P.
  - `editor` and `admin` retain access to all stock building grades.
  - `building_metrics`, `building_current_data`, and `building_display_overrides` inherit their parent building's visibility.
  - `viewer` can no longer read `lease_transactions`; `editor` and `admin` retain read access so the existing cross-broker duplicate-detection workflow continues to work.
- Hardened `/api/lease-submission/team-submissions`: because the endpoint uses the Supabase secret/service role and bypasses RLS, it now verifies that the authenticated caller is actually an `admin` before any team-wide transaction or Auth user data is queried.
- Updated the broker API to select the canonical `editor` role directly instead of filtering around the obsolete `executive` role.
- Updated authorization tests to cover the real lease-submission module, editor/admin access, viewer denial, and fail-closed handling of unknown roles.
- Corrected the Verify workflow runtime from Node.js 20 to Node.js 22 after CI showed that the installed Supabase JavaScript packages declare Node.js `>=22.0.0`.

### Why

The previous implementation mixed UI navigation rules with real authorization. A viewer's map request downloaded all building rows into the browser and then filtered A/P buildings client-side, which meant the hidden rows were still available to browser code and could reappear through alternate UI paths such as comparison mode. Database policies also allowed every authenticated user to select all buildings, metrics, and transactions directly through the Supabase Data API.

The project also had role and route drift: TypeScript still described an `executive` role that the database does not allow, while the restricted-module configuration referenced `/deals` even though the live workflow is `/lease-submission`.

Finally, the team-submissions API used a service-role client after checking only that a valid user token existed. Because service-role clients bypass RLS, that was an authorization gap for team-wide sensitive data.

### Impact

- Once the new migration is applied to the office-map Supabase environment, viewer accounts will no longer receive non-A/P stock-building rows from the database at all; browser-side filtering is no longer the security boundary.
- Viewer accounts cannot enter the lease-submission workspace or query the lease transaction table.
- Existing broker/editor workflows remain available, including cross-broker duplicate detection.
- Admin users retain full map visibility and team monitoring access.
- Unauthenticated users no longer cause the map runtime to initialize before session validation.
- Invalid, missing, or legacy role values fail closed instead of implicitly gaining normal module access.

### Verification

- Added/updated unit tests for canonical role and module authorization behavior.
- Verify run #3 reached `npm run typecheck` and failed on a pre-existing TypeScript baseline. Every reported error is in files untouched by this PR: obsolete BI test imports, existing Zod 4 / React Hook Form typing, OSS request header typing, AG Grid API typing, an audit-log implicit `any`, a map modal nullable value, lease-service inferred columns, and a test mutating read-only `NODE_ENV`.
- No TypeScript error from Verify run #3 points to any authorization file changed by this PR.
- Because typecheck stops the sequential workflow, lint, tests, and production build were not executed in run #3. The repository therefore does not yet have a fully green Verify baseline; this is recorded rather than hidden by weakening the workflow.
- CI also reported that the installed Supabase JS packages require Node.js `>=22.0.0`; `.github/workflows/verify.yml` is now aligned to Node.js 22 for subsequent runs.
- The RLS migration has been reviewed against the existing schema and policy names in the repository.
- The connected Supabase project available in this session was identified as a different Personal OS database, so this migration was intentionally **not** executed against that project. Applying and validating the migration against the correct office-map Supabase environment remains a required deployment step.

### Follow-up

- Apply `20260824043500_tighten_auth_boundaries.sql` to the correct office-map Supabase project and verify viewer/editor/admin queries with real test accounts before production release.
- Repair the repository's pre-existing TypeScript baseline so the Verify workflow can reach lint, tests, and production build without weakening quality gates.
- Remove the now-redundant viewer grade filtering and `allBuildingsUnfiltered` copy inside `MapClient` after the RLS migration is deployed; at that point the client can treat its Supabase result as already authorization-scoped.
- P0: generate and adopt typed Supabase database definitions.
- P0: remove excessive debug logging and sensitive diagnostic output.

---

## 2026-08-24 — P0 refactor safety foundation

### Area
Engineering workflow / CI / change management

### What changed

- Added `npm run typecheck` using `tsc --noEmit`.
- Added `npm run check` to run type checking, linting, and the test suite in a fixed order.
- Added `npm run verify` to run the complete local verification pipeline, including the production build.
- Added GitHub Actions workflow `.github/workflows/verify.yml`.
- The workflow runs on pull requests targeting `main` and on pushes to `main`.
- CI installs dependencies with `npm ci`, then runs typecheck, lint, tests, and production build. The runtime was initially Node.js 20 and was corrected to Node.js 22 during the following P0 auth-hardening change after dependency engine requirements were observed in CI.
- Added this `CHANGELOG.md` as the durable engineering change record.
- Updated repository agent/contributor guidance so future meaningful changes must update this changelog and must be verified before completion.

### Why

The project is entering a larger refactor phase. Before changing authentication boundaries, Supabase data access, map loading, and large components, regressions need to be caught systematically rather than through manual browser testing alone.

Git commit titles are too compressed to serve as product memory. A persistent repository document is required so future contributors can understand what changed, why it changed, and how it was verified.

### Impact

- No intended user-facing behavior change.
- Future refactors have a common local and CI quality gate.
- Engineering changes now have a repository-native historical record independent of individual commit messages.

### Verification

- Repository scripts are defined so the same commands can be executed locally and in CI.
- GitHub Actions configuration uses deterministic `npm ci` installation from the committed lockfile.
- The first auth-hardening PR exposed a pre-existing TypeScript baseline, proving the gate is operational but not yet green; the baseline is tracked explicitly for repair rather than bypassed.

### Follow-up

- P0: tighten authentication and authorization boundaries.
- P0: generate and adopt typed Supabase database definitions.
- P0: remove excessive debug logging and sensitive diagnostic output.
