import { supabase } from './supabaseClient';

export interface LeaseTransactionDraftSnapshot {
  version: 1;
  values: Record<string, unknown>;
  ui: {
    isCustomSubIndustry: boolean;
    customSubIndustryText: string;
    isOnBehalf: boolean;
    behalfUserId: string;
    manualBuilding: boolean;
    manualOldBuilding: boolean;
    buildingLocked: boolean;
    oldBuildingLocked: boolean;
    faceRentUnit: 'monthly' | 'daily';
    effectiveRentUnit: 'monthly' | 'daily';
    floorInfoUnknown: boolean;
    floorUnknown: boolean;
    oldAddressUnknown: boolean;
    oldSubmarketUnknown: boolean;
    oldDistrictUnknown: boolean;
    oldGradeUnknown: boolean;
  };
}

export interface LeaseTransactionDraftRecord {
  draft: LeaseTransactionDraftSnapshot;
  updatedAt: string;
}

function assertUserId(userId: string) {
  if (!userId?.trim()) throw new Error('缺少用户 ID，无法处理租赁成交草稿');
}

export async function getLeaseTransactionDraft(userId: string): Promise<LeaseTransactionDraftRecord | null> {
  assertUserId(userId);
  const { data, error } = await supabase
    .from('lease_transaction_drafts')
    .select('draft_data,updated_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw new Error(`读取租赁成交草稿失败: ${error.message}`);
  if (!data) return null;

  const draft = data.draft_data as LeaseTransactionDraftSnapshot | null;
  if (!draft || draft.version !== 1 || !draft.values || !draft.ui) return null;
  return { draft, updatedAt: data.updated_at };
}

export async function saveLeaseTransactionDraft(
  userId: string,
  userName: string,
  draft: LeaseTransactionDraftSnapshot,
): Promise<string> {
  assertUserId(userId);
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('lease_transaction_drafts')
    .upsert(
      {
        user_id: userId,
        user_name: userName || '',
        draft_data: draft,
        updated_at: now,
      },
      { onConflict: 'user_id' },
    )
    .select('updated_at')
    .single();

  if (error) throw new Error(`保存租赁成交草稿失败: ${error.message}`);
  return data.updated_at || now;
}

export async function deleteLeaseTransactionDraft(userId: string): Promise<void> {
  assertUserId(userId);
  const { error } = await supabase
    .from('lease_transaction_drafts')
    .delete()
    .eq('user_id', userId);
  if (error) throw new Error(`清理租赁成交草稿失败: ${error.message}`);
}
