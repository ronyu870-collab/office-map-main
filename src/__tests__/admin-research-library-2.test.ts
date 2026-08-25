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
  it('keeps the existing admin-only console rule', () => {
    expect(canAccessAdminConsole({ role: 'admin', email: 'admin@colliers.com' })).toBe(true);
    expect(canAccessAdminConsole({ role: 'editor', email: 'editor@colliers.com' })).toBe(false);
    expect(canAccessAdminConsole({ role: 'viewer', email: 'viewer@colliers.com' })).toBe(false);
  });

  it('preserves the explicit restricted-admin exception', () => {
    expect(canAccessAdminConsole({ role: 'admin', email: 'judy.li@colliers.com' })).toBe(false);
  });

  it('keeps research-library write roles distinct from general browsing', () => {
    expect(isResearchLibraryManager('admin')).toBe(true);
    expect(isResearchLibraryManager('super_admin')).toBe(true);
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
