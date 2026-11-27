import * as React from 'react';
import { fetchSubmarketDetailPayload, saveSubmarketProfile, type SubmarketDetailPayload } from '@/src/services/mapDataClient';
import { emptySubmarketProfile, readSubmarketProfileRow, submarketProfileSchema, type SubmarketProfileDraft } from '../model/submarketProfile';
import { visibleSubmarketProfile } from '../model/submarketPublication';
import type { SubmarketResearchTrendState } from './SubmarketResearchData';

type DetailRead = { payload: SubmarketDetailPayload | null; loading: boolean; error: boolean };
const initialRead: DetailRead = { payload: null, loading: true, error: false };

/** The owning workspace is keyed by authorized scope and submarket; retries never revive another key. */
export function useSubmarketWorkspaceDetail(name: string) {
  const [read, setRead] = React.useState(initialRead);
  const [revision, setRevision] = React.useState(0);
  const [editor, setEditor] = React.useState<SubmarketProfileDraft | null>(null);
  const editingVersion = React.useRef<string | null | undefined>(undefined);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const retry = React.useCallback(() => {
    setRead(previous => ({ ...previous, loading: true, error: false }));
    setRevision(previous => previous + 1);
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void fetchSubmarketDetailPayload(name, signal).then(payload => {
      if (!signal.aborted) setRead({ payload, loading: false, error: false });
    }).catch((error: unknown) => {
      if (signal.aborted) return;
      const status = error && typeof error === 'object' && 'status' in error ? error.status : null;
      // Denied or expired access must clear already-read content, not show it as stale.
      setRead(previous => ({ payload: status === 401 || status === 403 ? null : previous.payload, loading: false, error: true }));
    });
    return () => controller.abort();
  }, [name, revision]);

  const beginEditing = () => {
    const row = read.payload?.draftProfile ?? read.payload?.profile;
    editingVersion.current = row?.updatedAt;
    setEditor(row ? { headline: row.headline, overview: row.overview, industries: row.industries,
      transport: row.transport, demographics: row.demographics, policies: row.policies, insights: row.insights, research: row.research } : emptySubmarketProfile());
    setSaveError(null);
  };
  const cancelEditing = () => { setEditor(null); setSaveError(null); };
  const save = async (draft: SubmarketProfileDraft, publish: boolean) => {
    if (saving) return;
    const parsed = submarketProfileSchema.safeParse(draft);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const groups: Record<string, string> = { sources: '来源', facts: '事实', observations: '观点', projects: '代表项目', positioning: '市场定位', updatedOn: '研究更新日期' };
      const field = issue.path[0] === 'research' ? groups[String(issue.path[1])] ?? '结构化研究' : '旧版资料';
      const row = typeof issue.path[2] === 'number' ? `第 ${issue.path[2] + 1} 项` : '';
      setSaveError(`${field}${row} · ${issue.code === 'custom' ? issue.message : '请检查必填内容、日期和字段格式。'}`);
      return;
    }
    setSaving(true); setSaveError(null);
    try {
      const next = await saveSubmarketProfile(name, parsed.data, publish, editingVersion.current);
      setRead(previous => previous.payload ? { ...previous, payload: { ...previous.payload,
        draftProfile: next.profile,
        profile: next.profilePublished
          ? next.profile.research ? visibleSubmarketProfile(next.profile, true) : next.profile
          : readSubmarketProfileRow(null, name),
        profilePublished: next.profilePublished,
      } } : previous);
      setEditor(null);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '保存失败');
    } finally { setSaving(false); }
  };

  const { payload, loading, error } = read;
  const profile = payload?.profilePublished ? payload.profile : null;
  const trendState: SubmarketResearchTrendState = payload && !payload.trendError ? 'ready'
    : loading ? 'loading' : error || payload?.trendError ? 'error' : 'ready';
  return { payload, profile, loading, error, trendState, retry, editor, saving, saveError, beginEditing, cancelEditing, save };
}
