import { it, expect } from 'vitest';
import { parseArtifactFilename, artifactContentDisposition } from './artifactFilename';
it('round-trips fixed safe Word and PowerPoint original filenames while rejecting executable names', () => {
    for (const filename of ['内部资料原件.docx', '内部资料原件.pptx'])
        expect(parseArtifactFilename(artifactContentDisposition(filename))).toBe(filename);
    expect(() => artifactContentDisposition('原件.html')).toThrow('ARTIFACT_FILENAME_INVALID');
});
