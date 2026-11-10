import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { temporary } from './common.mjs';
import { validDigest } from './manifest.mjs';

export const HOUR = 3_600_000;
export const WEEK = 7 * 24 * HOUR;
export const LOCK_AGE = 30 * 24 * HOUR;
export const ADMISSION_BYTES = 5_800_000_000;
export const COMPLETE_MAX_BYTES = 4096;
const ORIGIN = Date.UTC(2026, 10, 8, 18); // Monday 02:00 Asia/Shanghai.
const PROJECT = 'qhgxougfzzmgqjzzwudf';
const BASELINE_SUFFIX = '2026-11-08T21-33-15-789Z-e913f17c-32b7-4840-9514-d8e7ee6b22e8/';
const PINNED_SUFFIX = '2026-11-06T12-20-19-770Z-56cdfc27-eb4a-4f3e-8fa4-6a36c6dfe7b5/';
const runSuffix = /^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z-[a-f0-9-]{36}\/$/;
const dataSuffix = /^(?:[a-f0-9-]{36}\.age|manifest\.age|reservation\.json|complete\.json)$/;
const validSha = (x) => /^[a-f0-9]{64}$/.test(x ?? '');
export const hashJSON = (data) => createHash('sha256').update(JSON.stringify(data)).digest('hex');
export const slotAt = (now) => new Date(ORIGIN + Math.floor((now - ORIGIN) / WEEK) * WEEK).toISOString();
export const validRun = (c, run) => typeof run === 'string' && run.startsWith(c.prefix) && runSuffix.test(run.slice(c.prefix.length));
export const pinnedRun = (c) => c.project === PROJECT ? `${c.prefix}${PINNED_SUFFIX}` : undefined;
export const inventoryHash = (entries) => hashJSON(entries.map(({ Key, Size }) => [Key, Size]).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));

function inventory(c, objects) {
  const byKey = new Map(); const groups = new Map(); let bytes = 0;
  for (const o of objects) {
    if (typeof o.Key !== 'string' || !o.Key.startsWith(c.prefix) || byKey.has(o.Key) || !Number.isSafeInteger(o.Size) || o.Size < 0) throw new Error('BACKUP_INVENTORY_INVALID');
    byKey.set(o.Key, o); bytes += o.Size;
    const end = o.Key.indexOf('/', c.prefix.length);
    const run = end === -1 ? '' : o.Key.slice(0, end + 1);
    if (validRun(c, run)) {
      if (!groups.has(run)) groups.set(run, []);
      groups.get(run).push(o);
    }
  }
  if (!Number.isSafeInteger(bytes)) throw new Error('BACKUP_INVENTORY_INVALID');
  return { byKey, groups, bytes };
}

export async function weeklyState(c, target, { now = Date.now() } = {}) {
  const state = inventory(c, await target.list(c.prefix));
  const weeks = new Map(); let outstandingBytes = 0;
  await temporary('colliers-weekly-read-', async (dir) => {
    let count = 0;
    const json = async (key) => {
      const file = path.join(dir, `${count++}.json`);
      await target.get(key, file, { maxBytes: COMPLETE_MAX_BYTES });
      return JSON.parse(await readFile(file, 'utf8'));
    };
    for (const [run, objects] of state.groups) {
      const markerKey = `${run}complete.json`; const reservationKey = `${run}reservation.json`;
      const baseline = c.project === PROJECT && run === `${c.prefix}${BASELINE_SUFFIX}`;
      const marker = state.byKey.has(markerKey) ? await json(markerKey) : undefined;
      const hasReservation = state.byKey.has(reservationKey);
      if (hasReservation && !marker?.weeklySlot) {
        if (marker || objects.some(o => !dataSuffix.test(o.Key.slice(run.length)))) throw new Error('BACKUP_RESERVATION_INVALID');
        const reservation = await json(reservationKey);
        const actual = objects.filter(o => o.Key !== reservationKey).reduce((sum, o) => sum + o.Size, 0);
        if (reservation.format !== 1 || reservation.run !== run || !Number.isSafeInteger(reservation.bytes) || reservation.bytes < actual || reservation.bytes > ADMISSION_BYTES) throw new Error('BACKUP_RESERVATION_INVALID');
        outstandingBytes += reservation.bytes - actual;
      }
      if (!marker || (!baseline && !marker.weeklySlot)) continue;
      const finished = Date.parse(marker.finished);
      const captured = Date.parse(baseline ? '2026-11-08T21:33:15.789Z' : marker.snapshotStarted);
      if (!Number.isFinite(finished) || !Number.isFinite(captured) || captured > finished) throw new Error('WEEKLY_COMPLETION_INVALID');
      const slot = baseline ? slotAt(finished) : marker.weeklySlot;
      const expectedHash = baseline ? '0f6cf9ef3eb3b14e74145ff0cecac9638f6262648cfa3c29b53f3f22e950b360' : marker.inventorySha256;
      if (marker.format !== 1 || marker.profile !== 'supabase' || marker.run !== run || marker.manifest?.key !== `${run}manifest.age` || !validDigest(marker.manifest) || marker.manifest.bytes > 16 * 1024 * 1024 || finished > now + 5 * 60_000 || slot !== slotAt(finished) || slot !== slotAt(captured) || slot > slotAt(now) || !validSha(expectedHash) || weeks.has(slot) || (!baseline && !hasReservation)) throw new Error('WEEKLY_COMPLETION_INVALID');
      if (baseline && (marker.finished !== '2026-11-08T22:17:26.420Z' || marker.manifest.sha256 !== 'c2208116b059b5706dcc88fb92c072d5c3f58e10c5f99cbd1282accd19ac6a88')) throw new Error('WEEKLY_BASELINE_INVALID');
      if (objects.some(o => !dataSuffix.test(o.Key.slice(run.length))) || inventoryHash(objects.filter(o => o.Key !== markerKey)) !== expectedHash) throw new Error('WEEKLY_ARCHIVE_INCOMPLETE');
      const got = await target.get(marker.manifest.key, path.join(dir, `${count++}.age`), { maxBytes: marker.manifest.bytes });
      if (got.bytes !== marker.manifest.bytes || got.sha256 !== marker.manifest.sha256) throw new Error('WEEKLY_ARCHIVE_INCOMPLETE');
      weeks.set(slot, { slot, run, finished, captured, marker, objects });
    }
  });
  if (!Number.isSafeInteger(state.bytes + outstandingBytes)) throw new Error('BACKUP_RESERVATION_INVALID');
  return { ...state, weeks, outstandingBytes, slot: slotAt(now) };
}

export function checkAdmission(state, plannedBytes, ceiling = ADMISSION_BYTES) {
  if (!Number.isSafeInteger(plannedBytes) || plannedBytes < 0 || state.bytes + state.outstandingBytes + plannedBytes > ceiling) throw new Error('BACKUP_BUDGET_EXCEEDED');
}

export async function runIfMissing(c, target, create) {
  const state = await weeklyState(c, target);
  const present = state.weeks.get(state.slot);
  if (present) return { alreadyComplete: true, ...present.marker };
  checkAdmission(state, 1);
  return create(state.slot);
}

export function weeklyHealth(state, now) {
  const newest = [...state.weeks.values()].sort((a, b) => b.finished - a.finished)[0];
  if (!newest) throw new Error('NO_WEEKLY_BACKUP');
  if (!state.weeks.has(state.slot) && now >= Date.parse(state.slot) + 10 * HOUR) throw new Error('WEEKLY_BACKUP_MISSED');
  if (now - newest.captured > WEEK) throw new Error('WEEKLY_BACKUP_STALE');
  return { status: 'weekly-backup-healthy', slot: state.slot, run: newest.run, currentWeekComplete: state.weeks.has(state.slot), ageHours: (now - newest.captured) / HOUR, backupBytes: state.bytes, reservedBytes: state.outstandingBytes };
}

export function rotationPlan(c, state, now) {
  const newest = state.weeks.get(state.slot);
  const ordered = [...state.weeks.values()].sort((a, b) => a.slot.localeCompare(b.slot));
  if (!newest || now - newest.captured > WEEK || ordered.length < 6) return { status: 'no-rotation', reason: !newest ? 'no-current-week' : ordered.length < 6 ? 'retain-five-weeks' : 'stale', slot: state.slot };
  const oldest = ordered[0];
  const pinned = pinnedRun(c);
  if (!validRun(c, oldest.run) || oldest.run === pinned || (pinned && (!state.byKey.has(`${pinned}complete.json`) || !state.byKey.has(`${pinned}manifest.age`))) || oldest.objects.some(o => !(o.LastModified instanceof Date) || !Number.isFinite(+o.LastModified) || +o.LastModified + LOCK_AGE > now)) return { status: 'no-rotation', reason: 'protected-or-locked', slot: state.slot };
  const objects = oldest.objects.map(o => ({ key: o.Key, bytes: o.Size, modified: new Date(o.LastModified).toISOString() })).sort((a, b) => a.key.localeCompare(b.key));
  const details = { slot: state.slot, newest: newest.run, run: oldest.run, objects, bytes: objects.reduce((sum, o) => sum + o.bytes, 0) };
  return { status: 'rotation-preview', ...details, planSha256: hashJSON(details) };
}
