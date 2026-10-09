# Expansion grants and retained-data access

The expansion leaves existing business-table policies and all three legacy RPC
definitions unchanged.

New public data tables:

- `quarterly_draft_history`: authenticated SELECT only, restricted to the row's
  owner **and** an active account with viewer/editor/admin application role
- `quarterly_submission_provenance`: the same owner-and-active-account SELECT rule
- Neither table grants authenticated INSERT/UPDATE/DELETE; no anonymous access

New private tables:

- `quarterly_submission_requests` and `quarterly_rollout_control`: no PUBLIC,
  anonymous or authenticated table access; RLS enabled; controlled definer RPCs
  and separately approved operator SQL handle access

New private reader helper:

- `private.is_active_quarterly_reader()` is STABLE SECURITY DEFINER with an empty
  search path, checking authoritative `auth.users` existence and the same user's
  `user_roles` membership in viewer/editor/admin
- PUBLIC/anon/authenticated privileges are revoked first; authenticated receives
  only EXECUTE so the two new SELECT policies can evaluate it
- Existing private-schema USAGE is reused; expansion adds no schema-wide grant
- The helper has no user-ID argument and answers only for the caller's auth.uid()

New public RPCs:

- save_v2, submit_v2 and setter_v2 retain authenticated/service_role EXECUTE grants,
  with PUBLIC/anonymous execution revoked and authorization enforced in the body
- `get_quarterly_rollout_status()` permits authenticated/service_role EXECUTE and
  requires a non-null authenticated identity; it exposes only the freeze flag

Other private archive/category functions have PUBLIC/anonymous/authenticated
execution revoked. Archive writes occur through triggers, not a client-write API.

Retained history/provenance deliberately survive account deletion. A still-valid
old token cannot read them after the authoritative account is deleted or its
application role is removed. Existing business RLS is not broadened or replaced.
The synthetic security stage verifies viewer ownership, disabled/deleted-account
old-token denial, cross-owner denial, retained evidence, and anonymous helper denial.
