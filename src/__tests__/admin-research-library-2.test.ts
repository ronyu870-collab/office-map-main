import { describe, expect, it } from 'vitest';

import { canAccessAdminConsole, isResearchLibraryManager } from '@/src/utils/adminAccess';
import {
  filterAndSortLibraryItems,
  isDuplicateUploadName,
  isSupportedResearchFile,
  type ResearchLibraryItem,
} from '@/src/components/oss/libraryModel';

const items: ResearchLibraryItem[] = [
  { name: 'Beijing/', shortName: 'Beijing', type: 'folder' },
  { name: '2026Q2-market.pdf', shortName: '2026Q2-market.pdf', type: 'file', sizeBytes: 500, lastModified: '2026-07-02T00:00:00Z' },
  { name: 'leasing-deck.pptx', shortName: 'leasing-deck.pptx', type: 'file', sizeBytes: 1200, lastModified: '2026-08-02T00:00:00Z' },
  { name: 'office-data.xlsx', shortName: 'office-data.xlsx', type: 'file', sizeBytes: 900, lastModified: '2026-08-10T00:00:00Z' },
];

describe('Admin 2.0 authorization policy', () => {
  it('authorizes the console only for the canonical admin role', () => {
    expect(canAccessAdminConsole({ role: 'admin' })).toBe(true);
    expect(canAccessAdminConsole({ role: 'editor' })).toBe(false);
    expect(canAccessAdminConsole({ role: 'viewer' })).toBe(false);
    expect(canAccessAdminConsole({ role: null })).toBe(false);
    expect(canAccessAdminConsole({ role: 'viewer', isDemo: true })).toBe(false);
  });

  it('blocks admin entry while impersonating', () => {
    expect(canAccessAdminConsole({ role: 'admin', impersonationActive: true })).toBe(false);
    expect(canAccessAdminConsole({ role: 'viewer', isDemo: true, impersonationActive: true })).toBe(false);
  });

  it('keeps research-library write access on the canonical admin role', () => {
    expect(isResearchLibraryManager('admin')).toBe(true);
    expect(isResearchLibraryManager('super_admin')).toBe(false);
    expect(isResearchLibraryManager('editor')).toBe(false);
  });
});

describe('Research Library 2.0 list behavior', () => {
  it('searches and filters the real current-directory metadata', () => {
    const result = filterAndSortLibraryItems(items, { query: 'leasing', type: 'presentation', sort: 'name-asc' });
    expect(result.map((item) => item.shortName)).toEqual(['leasing-deck.pptx']);
  });

  it('sorts by modification date and size without mutating the source list', () => {
    const recent = filterAndSortLibraryItems(items, { query: '', type: 'all', sort: 'modified-desc' });
    const largest = filterAndSortLibraryItems(items, { query: '', type: 'all', sort: 'size-desc' });
    expect(recent[0].shortName).toBe('office-data.xlsx');
    expect(largest[0].shortName).toBe('leasing-deck.pptx');
    expect(items[0].name).toBe('Beijing/');
  });

  it('detects duplicate and unsupported uploads before a destructive overwrite', () => {
    expect(isDuplicateUploadName(items, 'OFFICE-DATA.XLSX')).toBe(true);
    expect(isDuplicateUploadName(items, 'new-file.pdf')).toBe(false);
    expect(isSupportedResearchFile('research.pdf')).toBe(true);
    expect(isSupportedResearchFile('payload.exe')).toBe(false);
  });
});
