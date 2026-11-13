// A read-only leasing entry. Reuse the existing feature flag, real-admin checks,
// private/no-store response and DB authorization; no parallel access policy.
export { GET } from '../../intelligence/lease-expiry/route';
