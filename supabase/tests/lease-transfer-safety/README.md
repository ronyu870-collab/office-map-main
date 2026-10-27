# Lease transfer integrity regressions

Run `npm run test:db:lease-transfer` against the same disposable PostgreSQL 17
service as `test:db:lease-audit`. The existing harness accepts only localhost,
an explicit `LEASE_TEST_PG_PORT`, synthetic credentials and an ephemeral random
DB. Local runs also require `LEASE_TEST_ALLOW_LOCAL=disposable`; CI supplies its
own acknowledged service. No production URL or ambient PG credentials are used.

The runner loads the real existing timestamp/audit trigger, audit-count repair,
lease policies, and the new transfer migration. It extends only synthetic Auth
and profile fixtures. All tested calls retain both real UPDATE triggers. The
service-only RPC is called under `SET LOCAL ROLE service_role`; additional tests
prove `anon` and `authenticated` cannot execute it or forge/read receipts. This
is intentional: a trusted HTTP route verifies a human token and passes that actor
to the service-only boundary. It is not evidence that ordinary browser roles can
write the table without RLS.

Coverage includes trusted names/recipient qualification, owner/admin/denied
roles, banned/deleted accounts, explicit null and legacy-text preconditions,
microsecond CAS, complete record/untouched-record differences, original fields,
source preservation, existing grants/policies/function security/trigger identity,
transactional trigger and transfer audits, receipt failure rollback, restoring
the JWT subject, two-connection stale edits, concurrent duplicate requests,
reconnect after a discarded committed response, replay after a subsequent valid
transfer or recipient deletion, and recipient status/role changes racing the
operation. Qualification values come from the same ordered JOIN that locks the
Auth/profile rows. A profile inserted after that snapshot cannot be used by an
unlocked later read.

Concurrent tests use dedicated blocker connections and `pg_blocking_pids()`
barriers before releasing the relevant locks; fixed delays do not establish
concurrency. They include a four-connection insert/demotion race and confirm
that recipient qualifications remain locked until transfer commit. Local
mutation runs removing the lease row lock caused two stale-view requests to
succeed, and removing qualification locks failed the observed-lock barrier.
These failures demonstrate that the concurrency assertions detect missing locks.

The route's `regression F09` and `regression F10` tests use the same correct
HTTP assertions against old/new route implementations. Before repair the old
route responds 200 rather than 400/409; after repair it invokes the atomic RPC
and correctly reports denial/conflict. Mock HTTP tests complement, and do not
replace, this native database suite.

The synthetic Auth helpers do not prove real production session issuance. A
production-build route/browser test must additionally exercise the current UI,
verified identity boundary, real SDK/PostgREST and native database. Real iOS
Safari/Android Chrome remain separate evidence; desktop viewports are not phones.

Merging this migration file does not apply it to a target DB. The target migration
and application release require independent authorization and preflight checks.
