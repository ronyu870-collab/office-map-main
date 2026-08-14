import { describe, expect, it } from 'vitest';

import {
  INACTIVE_SUBMITTER_LABEL,
  maskInactiveSubmitters,
} from '../leaseSubmitterPrivacy';

describe('maskInactiveSubmitters', () => {
  it('keeps active identities and masks inactive current/original identities', () => {
    const result = maskInactiveSubmitters([
      {
        submitter_id: 'active',
        submitter_name: 'Active User',
        original_submitter_id: 'inactive',
        original_submitter_name: 'Former User',
      },
      {
        submitter_id: 'inactive',
        submitter_name: 'Former User',
      },
    ], new Set(['active']));

    expect(result[0].submitter_name).toBe('Active User');
    expect(result[0].original_submitter_name).toBe(INACTIVE_SUBMITTER_LABEL);
    expect(result[0].submitter_active).toBe(true);
    expect(result[1].submitter_name).toBe(INACTIVE_SUBMITTER_LABEL);
    expect(result[1].submitter_active).toBe(false);
  });
});

