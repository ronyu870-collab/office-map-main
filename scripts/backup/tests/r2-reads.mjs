import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, writeFile, access } from 'node:fs/promises';

export async function r2ReadRegressions(test, dir, c, target, fixture) {
  const input = path.join(dir, 'r2-read-input'); const content = 'complete synthetic readback bytes';
  await writeFile(input, content); const key = `${c.prefix}read-regression.fixture`;
  await target.put(key, input);
  const gets = () => fixture.requests.filter(r => r.method === 'GET' && r.key === key).length;
  await test('R2 response body reset restarts the read from zero without overwriting existing files', async () => {
    fixture.interruptGet(1); const before = gets(); const out = path.join(dir, 'r2-restarted');
    await target.get(key, out, { maxBytes: Buffer.byteLength(content) });
    assert.equal(gets() - before, 2); assert.equal(await readFile(out, 'utf8'), content);
    await assert.rejects(target.get(key, out), { code: 'EEXIST' });
    assert.equal(gets() - before, 2); assert.equal(await readFile(out, 'utf8'), content);
  });
  await test('R2 exhausted resets remove only the reserved partial file; permissions and size errors never retry', async () => {
    const out = path.join(dir, 'r2-exhausted'); let before = gets(); fixture.interruptGet(Infinity);
    await assert.rejects(target.get(key, out)); assert.equal(gets() - before, 3);
    await assert.rejects(access(out), { code: 'ENOENT' }); fixture.interruptGet(0);
    before = gets(); fixture.denyGet(403);
    try { await assert.rejects(target.get(key, out)); assert.equal(gets() - before, 1); }
    finally { fixture.denyGet(undefined); }
    await assert.rejects(access(out), { code: 'ENOENT' }); before = gets();
    await assert.rejects(target.get(key, out, { maxBytes: 1 }), /BACKUP_HASH_MISMATCH/);
    assert.equal(gets() - before, 1); await assert.rejects(access(out), { code: 'ENOENT' });
  });
}
