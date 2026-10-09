import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.join(process.cwd(), 'src/app/update/components/QuarterlyUpdateWorkspace.tsx'),
  'utf8',
);

const store = fs.readFileSync(path.join(process.cwd(), 'src/app/update/quarterlyDraftStore.ts'), 'utf8');

describe('quarterly draft serialized revision contract', () => {
  it('drains newer edits after each acknowledgement instead of dropping their payload', () => {
    expect(store).toContain('if (this.inFlight) return this.inFlight');
    expect(store).toContain('while (this.snapshot.dirty)');
    expect(store).toContain('const expectedRevision = this.snapshot.revision');
    expect(store).toContain('dirty: this.editVersion !== version');
    expect(source).toContain('p_expected_revision: expectedRevision');
    expect(source).not.toContain('p_expected_revision: draftRevision,');
  });
});
