# Lease edit and authoritative audit regression

The runner uses a fresh, disposable PostgreSQL 17 database containing only synthetic
records. It loads the original audit migration unchanged, then executes the current
lease read/write policies from their migration sources. Auth helpers model the
synthetic users; this does not validate production session issuance or all schema
dependencies.

It first proves a real field edit fails with SQLSTATE `42883`, while an unchanged
save succeeds. The same fixture then receives the repair migration and verifies
save/readback, exact field counts and snapshots, null transitions, no-op behavior,
editor/viewer/admin boundaries, source/ownership protection, stale timestamps,
audit-insertion failure rollback, and reapplication. Policies, trigger identities
and function security attributes must remain unchanged.

CI runs `npm run test:db:lease-audit` against its PostgreSQL service, with
`LEASE_TEST_PG_PORT` set by the workflow. A local run must explicitly set
`LEASE_TEST_ALLOW_LOCAL=disposable` and `LEASE_TEST_PG_PORT` for a **dedicated
disposable service** using the same synthetic CI credentials. Arbitrary database
URLs, hosts and ambient `PG*` credentials are not accepted. The runner requires
PostgreSQL major version 17 and drops its generated database on completion.

The original historical migration remains immutable. The repair only replaces
`private.audit_lease_transaction_update()`; merging the file does not apply it to
a target database. Target migration application and verification require the
corresponding production authorization under ARCH-03.
