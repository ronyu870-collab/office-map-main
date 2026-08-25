export type ResearchLibraryItem = {
  name: string;
  type: 'folder' | 'file';
  shortName?: string;
  size?: string;
  sizeBytes?: number;
  lastModified?: string;
  url?: string;
};

export type LibraryTypeFilter = 'all' | 'folder' | 'pdf' | 'presentation' | 'document' | 'spreadsheet' | 'other';
export type LibrarySort = 'name-asc' | 'modified-desc' | 'modified-asc' | 'size-desc';

const SUPPORTED_EXTENSIONS = new Set(['pdf', 'ppt', 'pptx', 'doc', 'docx', 'xls', 'xlsx']);

export function itemDisplayName(item: ResearchLibraryItem): string {
  return item.type === 'folder'
    ? item.shortName || item.name.split('/').filter(Boolean).pop() || item.name
    : item.shortName || item.name.split('/').pop() || item.name;
}

export function fileExtension(name: string): string {
  const base = name.split('/').pop() || name;
  const index = base.lastIndexOf('.');
  return index > 0 ? base.slice(index + 1).toLowerCase() : '';
}

export function classifyLibraryItem(item: ResearchLibraryItem): LibraryTypeFilter {
  if (item.type === 'folder') return 'folder';
  const extension = fileExtension(itemDisplayName(item));
  if (extension === 'pdf') return 'pdf';
  if (extension === 'ppt' || extension === 'pptx') return 'presentation';
  if (extension === 'doc' || extension === 'docx') return 'document';
  if (extension === 'xls' || extension === 'xlsx') return 'spreadsheet';
  return 'other';
}

export function isSupportedResearchFile(name: string): boolean {
  return SUPPORTED_EXTENSIONS.has(fileExtension(name));
}

export function isDuplicateUploadName(items: ResearchLibraryItem[], fileName: string): boolean {
  const normalized = fileName.trim().toLowerCase();
  return items.some((item) => item.type === 'file' && itemDisplayName(item).trim().toLowerCase() === normalized);
}

function parsedTimestamp(value?: string): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function filterAndSortLibraryItems(
  items: ResearchLibraryItem[],
  params: { query: string; type: LibraryTypeFilter; sort: LibrarySort },
): ResearchLibraryItem[] {
  const query = params.query.trim().toLowerCase();
  const filtered = items.filter((item) => {
    if (params.type !== 'all' && classifyLibraryItem(item) !== params.type) return false;
    if (!query) return true;
    return itemDisplayName(item).toLowerCase().includes(query);
  });

  return [...filtered].sort((a, b) => {
    if (params.sort === 'name-asc') return itemDisplayName(a).localeCompare(itemDisplayName(b), 'zh-CN');
    if (params.sort === 'size-desc') {
      const aSize = a.sizeBytes;
      const bSize = b.sizeBytes;
      if (aSize == null && bSize == null) return itemDisplayName(a).localeCompare(itemDisplayName(b), 'zh-CN');
      if (aSize == null) return 1;
      if (bSize == null) return -1;
      return bSize - aSize;
    }

    const aTime = parsedTimestamp(a.lastModified);
    const bTime = parsedTimestamp(b.lastModified);
    // Metadata-free folders/files stay at the end for either date direction instead
    // of accidentally outranking dated research documents.
    if (aTime == null && bTime == null) return itemDisplayName(a).localeCompare(itemDisplayName(b), 'zh-CN');
    if (aTime == null) return 1;
    if (bTime == null) return -1;
    return params.sort === 'modified-asc' ? aTime - bTime : bTime - aTime;
  });
}
