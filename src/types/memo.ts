export interface Memo {
  id: string;
  title: string;
  content: string;
  tags: string[];
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
}

export interface MemoVersion {
  id: string;
  memo_id: string;
  version: number;
  title: string;
  content: string;
  tags: string[];
  snapshot_at: string;
  snapshot_by: string;
}

export interface MemoListItem {
  id: string;
  title: string;
  tags: string[];
  is_pinned: boolean;
  updated_at: string;
  updated_by: string;
  content_preview?: string;
}
