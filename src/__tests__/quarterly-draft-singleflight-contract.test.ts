import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.join(process.cwd(), 'src/app/update/components/QuarterlyUpdateWorkspace.tsx'),
  'utf8',
);

describe('quarterly draft single-flight contract', () => {
  it('serializes draft writes and uses a synchronous revision ref', () => {
    expect(source).toContain('draftRevisionRef = React.useRef(0)');
    expect(source).toContain('draftSyncInFlightRef = React.useRef<Promise<boolean> | null>(null)');
    expect(source).toContain('if (draftSyncInFlightRef.current) return draftSyncInFlightRef.current');
    expect(source).toContain('const expectedRevision = draftRevisionRef.current');
    expect(source).toContain('draftRevisionRef.current = nextRevision');
    expect(source).not.toContain('p_expected_revision: draftRevision,');
  });
});
