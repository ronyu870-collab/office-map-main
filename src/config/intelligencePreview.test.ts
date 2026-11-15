import { afterEach, expect, test, vi } from 'vitest';
import { isIntelligencePreviewEnabled } from './intelligencePreview';
afterEach(() => vi.unstubAllEnvs());
test('public preview flags cannot grant AI access to non-admin roles', () => {
  vi.stubEnv('NEXT_PUBLIC_INTELLIGENCE_PREVIEW', 'true');
  for (const role of ['viewer', 'editor', 'super_admin', '', null, undefined]) expect(isIntelligencePreviewEnabled(role)).toBe(false);
  expect(isIntelligencePreviewEnabled('admin')).toBe(true);
});
