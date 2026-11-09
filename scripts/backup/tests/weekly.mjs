import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { backup, readBackup } from '../pipeline.mjs';
import { scopedDeleter, store } from '../r2.mjs';
import { applyRotation } from '../retention.mjs';
import { checkAdmission, HOUR, inventoryHash, LOCK_AGE, rotationPlan, runIfMissing, slotAt, WEEK, weeklyHealth, weeklyState } from '../weekly.mjs';
import { temporary } from '../common.mjs';
import { s3Fixture } from './s3-fixture.mjs';

export async function weeklyRegressions(test, dir, input, source, exportDB, identity) {
  const fixture = await s3Fixture();
  const c = { ...input, profile: 'supabase', endpoint: fixture.endpoint };
  const target = store(c, { requestHandler: fixture.requestHandler });
  const seed = (finished) => {
    const stamp = new Date(finished).toISOString();
    const run = `${c.prefix}${stamp.replaceAll(/[:.]/g, '-')}-${randomUUID()}/`;
    const put = (key, value) => { fixture.objects.set(key, Buffer.from(value)); fixture.modified.set(key, stamp); };
    const manifest = { key: `${run}manifest.age`, bytes: 6, sha256: createHash('sha256').update('cipher').digest('hex') };
    put(manifest.key, 'cipher');
    put(`${run}reservation.json`, JSON.stringify({ format: 1, run, bytes: 4096 }));
    put(`${run}${randomUUID()}.age`, 'synthetic ciphertext');
    const expected = [...fixture.objects].filter(([key]) => key.startsWith(run)).map(([Key, value]) => ({ Key, Size: value.length }));
    put(`${run}complete.json`, JSON.stringify({ format: 1, run, profile: c.profile, manifest, finished: stamp, snapshotStarted: stamp, weeklySlot: slotAt(finished), inventorySha256: inventoryHash(expected) }));
    return run;
  };
  const reset = () => { fixture.objects.clear(); fixture.modified.clear(); fixture.requests.length = 0; };
  try {
    await test('Shanghai Monday slot and missed-week deadline use the verified weekly completion', async () => {
      const monday = Date.parse('2026-11-15T18:00:00Z');
      assert.equal(slotAt(monday), '2026-11-15T18:00:00.000Z');
      assert.equal(slotAt(monday - 1), '2026-11-08T18:00:00.000Z');
      seed(monday - WEEK + 8 * HOUR);
      const before = monday + 3 * HOUR;
      assert.equal(weeklyHealth(await weeklyState(c, target, { now: before }), before).currentWeekComplete, false);
      const after = monday + 10 * HOUR;
      assert.throws(() => weeklyHealth({ ...{ weeks: new Map() } }, after), /NO_WEEKLY_BACKUP/);
      const overdue = await weeklyState(c, target, { now: after });
      assert.throws(() => weeklyHealth(overdue, after), /WEEKLY_BACKUP_MISSED/);
      assert.equal(rotationPlan(c, overdue, after).reason, 'no-current-week');
    });
    await test('exact staged bytes and durable partial reservations block over-budget PUTs; same-week retry skips', async () => {
      reset();
      const weeklySlot = slotAt(Date.now());
      const opt = { target, sources: [source], exportDB, weeklySlot };
      await assert.rejects(backup(c, { ...opt, admissionCeiling: 100 }), /BACKUP_BUDGET_EXCEEDED/);
      assert.equal(fixture.requests.filter(r => r.method === 'PUT').length, 0);
      fixture.failPut(3);
      try { await assert.rejects(backup(c, opt)); } finally { fixture.failPut(Infinity); }
      assert.equal(fixture.requests.find(r => r.method === 'PUT').key.endsWith('/reservation.json'), true);
      const partial = await weeklyState(c, target);
      assert.equal(partial.weeks.size, 0);
      assert.ok(partial.bytes > 0 && partial.outstandingBytes > 0);
      assert.throws(() => checkAdmission(partial, 1, partial.bytes), /BACKUP_BUDGET_EXCEEDED/);
      const good = await backup(c, opt);
      const full = await weeklyState(c, target);
      assert.equal(full.weeks.get(weeklySlot).run, good.run);
      assert.equal(full.outstandingBytes, partial.outstandingBytes);
      const count = fixture.requests.filter(r => r.method === 'PUT').length;
      assert.equal((await runIfMissing(c, target, () => assert.fail('duplicate weekly export'))).alreadyComplete, true);
      assert.equal(fixture.requests.filter(r => r.method === 'PUT').length, count);
      await temporary('weekly-roundtrip-', async tmp => {
        const result = await readBackup(c, target, good.run, tmp, identity);
        assert.equal(result.files.length, 3);
      });
      const sample = [...fixture.objects.keys()].find(k => k.startsWith(good.run) && k.endsWith('.age') && !k.endsWith('/manifest.age'));
      fixture.objects.delete(sample);
      await assert.rejects(weeklyState(c, target), /WEEKLY_ARCHIVE_INCOMPLETE/);
    });
    await test('rotation waits for a verified sixth week, rejects locked objects, and scopes marker-first DELETE', async () => {
      reset();
      const now = Date.parse('2026-12-21T02:00:00Z');
      const oldest = seed(now - 6 * WEEK - HOUR);
      for (let i = 4; i >= 0; i--) seed(now - i * WEEK - HOUR);
      const state = await weeklyState(c, target, { now });
      const valid = rotationPlan(c, state, now);
      assert.equal(valid.run, oldest);
      const onlyFive = { ...state, weeks: new Map([...state.weeks].filter(([, a]) => a.run !== oldest)) };
      assert.equal(rotationPlan(c, onlyFive, now).reason, 'retain-five-weeks');
      const key = `${oldest}manifest.age`;
      const oldDate = fixture.modified.get(key); fixture.modified.set(key, new Date(now - LOCK_AGE + HOUR).toISOString());
      assert.equal(rotationPlan(c, await weeklyState(c, target, { now }), now).reason, 'protected-or-locked');
      fixture.modified.set(key, oldDate);
      const journalDir = path.join(dir, 'weekly-journal'); await mkdir(journalDir, { mode: 0o700 });
      fixture.scopeDelete(oldest);
      const deleter = scopedDeleter(c, oldest, { ...c.credentials, sessionToken: 'synthetic-session' }, { requestHandler: fixture.requestHandler });
      try {
        await assert.rejects(deleter.remove(`${c.prefix}business-key`), /ROTATION_SCOPE_REJECTED/);
        await assert.rejects(applyRotation(c, target, deleter, { now, journalDir, run: oldest, planSha256: '0'.repeat(64) }), /ROTATION_PLAN_CHANGED/);
        assert.equal(fixture.requests.filter(r => r.method === 'DELETE').length, 0);
        const result = await applyRotation(c, target, deleter, { now, journalDir, run: oldest, planSha256: valid.planSha256 });
        assert.equal(result.status, 'rotation-complete');
        const deletes = fixture.requests.filter(r => r.method === 'DELETE');
        assert.equal(deletes[0].key, `${oldest}complete.json`);
        assert.ok(deletes.every(r => r.session && r.signed && r.key.startsWith(oldest)));
        assert.equal((await weeklyState(c, target, { now })).weeks.size, 5);
        const journal = await readFile(path.join(journalDir, `${state.slot.slice(0, 10)}.jsonl`), 'utf8');
        assert.match(journal, /approved-for-removal/);
        assert.match(journal, /rotation-complete/);
      } finally { deleter.close(); }
    });
    await test('interrupted rotation cannot advertise a half-deleted archive or start another deletion in the same week', async () => {
      reset();
      const now = Date.parse('2026-12-28T02:00:00Z');
      const oldest = seed(now - 6 * WEEK - HOUR);
      for (let i = 5; i >= 0; i--) seed(now - i * WEEK - HOUR);
      const plan = rotationPlan(c, await weeklyState(c, target, { now }), now);
      const journalDir = path.join(dir, 'interrupted-weekly-journal'); await mkdir(journalDir, { mode: 0o700 });
      fixture.scopeDelete(oldest, `${oldest}manifest.age`);
      const creds = { ...c.credentials, sessionToken: 'synthetic-session' };
      const deleter = scopedDeleter(c, oldest, creds, { requestHandler: fixture.requestHandler });
      try {
        await assert.rejects(applyRotation(c, target, deleter, { now, journalDir, run: oldest, planSha256: plan.planSha256 }));
        assert.equal(fixture.objects.has(`${oldest}complete.json`), false);
        assert.ok((await target.list(oldest)).length > 0);
        const after = await weeklyState(c, target, { now });
        assert.equal(after.weeks.size, 6);
        const next = rotationPlan(c, after, now);
        fixture.scopeDelete(next.run);
        const second = scopedDeleter(c, next.run, creds, { requestHandler: fixture.requestHandler });
        try { await assert.rejects(applyRotation(c, target, second, { now, journalDir, run: next.run, planSha256: next.planSha256 }), { code: 'EEXIST' }); }
        finally { second.close(); }
        assert.equal(fixture.objects.has(`${next.run}complete.json`), true);
      } finally { deleter.close(); }
    });
  } finally { target.close(); await fixture.close(); }
}
