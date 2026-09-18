import { describe, expect, it } from 'vitest';

import { annotateSubmitterActivity } from '../leaseSubmitterPrivacy';

describe('annotateSubmitterActivity', () => {
  it('preserves current and original submitter names while marking account activity', () => {
    const result = annotateSubmitterActivity([
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
    expect(result[0].original_submitter_name).toBe('Former User');
    expect(result[0].submitter_active).toBe(true);
    expect(result[1].submitter_name).toBe('Former User');
    expect(result[1].submitter_active).toBe(false);
  });
});
