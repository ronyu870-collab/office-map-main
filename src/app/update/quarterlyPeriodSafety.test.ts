import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function source(file: string) {
  return fs.readFileSync(path.join(process.cwd(), file), 'utf8');
}

describe('quarterly period safety', () => {
  it('uses transactional draft, submission and period rollover RPCs', () => {
    const workspace = source('src/app/update/components/QuarterlyUpdateWorkspace.tsx');
    const manager = source('src/components/admin/SubmissionManager.tsx');

    expect(workspace).toContain("supabase.rpc('save_quarterly_draft_v2'");
    expect(workspace).toContain("supabase.rpc('submit_quarterly_batch_v2'");
    expect(workspace).not.toContain("from('quarterly_submissions').insert(");
    expect(workspace).not.toContain("from('future_supply_submissions').insert(");

    expect(manager).toContain("supabase.rpc('set_current_submission_period_v2'");
    expect(manager).toMatch(/\.eq\(['"]record_year['"], year\)/);
    expect(manager).toMatch(/\.eq\(['"]record_quarter['"], quarter\)/);
    expect(manager).toMatch(/\.eq\(['"]is_entered_market['"], false\)/);
    expect(manager).toMatch(/\.eq\(['"]project_type['"], ['"]stock['"]\)/);
    expect(manager).toMatch(/\.eq\(['"]launch_year['"], String\(year\)\)/);
    expect(manager).toMatch(/\.eq\(['"]launch_quarter['"], `Q\$\{quarter\}`\)/);
  });

  it('keeps future-supply drafts stable across assignment-id rollover', () => {
    const workspace = source('src/app/update/components/QuarterlyUpdateWorkspace.tsx');

    expect(workspace).toContain('futureSupplyDrafts[building.id] || futureSupplyDrafts[building._assignmentId]');
    expect(workspace).toContain('updateFutureField(building.id, building._assignmentId');
    expect(workspace).toContain(".eq('is_entered_market', false)");
  });

  it('uses a strictly previous-period building metric as the reference', () => {
    const workspace = source('src/app/update/components/QuarterlyUpdateWorkspace.tsx');

    expect(workspace).toContain('metric.record_year < submitYear');
    expect(workspace).toContain('metric.record_quarter < submitQuarter');
  });

  it('keeps database rollover forward-only and batch submission atomic', () => {
    const migration = source('supabase/migrations/20260928015050_harden_quarterly_period_rollover_and_submission.sql');

    expect(migration).toContain('update_drafts_owner_tab_uidx');
    expect(migration).toContain('future_supply_assignments_period_owner_uidx');
    expect(migration).toContain('create or replace function public.set_current_submission_period');
    expect(migration).toContain("message = 'submission_period_cannot_move_backward'");
    expect(migration).toContain('create or replace function public.submit_quarterly_batch');
    expect(migration).toContain('insert into public.quarterly_submissions');
    expect(migration).toContain('insert into public.future_supply_submissions');

    const lifecycleMigration = source('supabase/migrations/20260928020602_reconcile_entered_market_future_supplies.sql');
    expect(lifecycleMigration).toContain('is_entered_market = true');
    expect(lifecycleMigration).toContain('coalesce(fs.is_entered_market, false) = false');

    const quarterGuardMigration = source('supabase/migrations/20260928021119_guard_future_supply_launch_quarter_values.sql');
    expect(quarterGuardMigration).toContain("launch_quarter in ('Q1','Q2','Q3','Q4','H1','H2')");
    expect(quarterGuardMigration).toContain('not valid');

    const finalGuardMigration = source('supabase/migrations/20260928021409_finalize_quarter_guard_and_quarterly_indexes.sql');
    expect(finalGuardMigration).toContain('validate constraint future_supplies_launch_quarter_valid');
    expect(finalGuardMigration).toContain('quarterly_submissions_building_idx');
    expect(finalGuardMigration).toContain('future_supply_submissions_future_supply_idx');
    expect(finalGuardMigration).toContain('future_supply_submissions_user_idx');
  });
});

