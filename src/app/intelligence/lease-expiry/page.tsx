import { LeaseExpiryWorkspace } from '@/src/components/intelligence/LeaseExpiryWorkspace';

export default function LeaseExpiryPage() {
  return <LeaseExpiryWorkspace trialLabel={process.env.LEASE_EXPIRY_REVIEW_TRIAL_LABEL} />;
}
