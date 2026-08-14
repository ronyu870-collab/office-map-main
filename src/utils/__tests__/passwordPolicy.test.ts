import { describe, expect, it } from 'vitest';

import { validatePassword } from '../passwordPolicy';

describe('validatePassword', () => {
  it('accepts a password with at least ten characters, letters and digits', () => {
    expect(validatePassword('Secure2026!')).toBeNull();
  });

  it('rejects weak or malformed passwords', () => {
    expect(validatePassword('short1')).toContain('10');
    expect(validatePassword('onlyletters')).toContain('字母和数字');
    expect(validatePassword('1234567890')).toContain('字母和数字');
    expect(validatePassword(undefined)).toContain('10');
  });
});

