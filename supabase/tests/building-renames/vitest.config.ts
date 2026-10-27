import { mergeConfig } from 'vitest/config';
import base from '../../../vitest.config';
export default mergeConfig(base, { test: { include: ['supabase/tests/building-renames/ui.integration.tsx'] } });
