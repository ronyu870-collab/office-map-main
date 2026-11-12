import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';

const directory = new URL('../src/components/admin/schema-dictionary/', import.meta.url);
const order = ['building', 'submission', 'future', 'transaction', 'company', 'user', 'system'];
const files = await readdir(new URL('groups/', directory));
assert.deepEqual(files.sort(), order.map(id => id + '.json').sort(), 'Every schema group must be registered in display order');
const groups = await Promise.all(order.map(async id => {
  const group = JSON.parse(await readFile(new URL('groups/' + id + '.json', directory), 'utf8'));
  assert.equal(group.id, id);
  return group;
}));
const catalog = groups.map(({ id, title, tables }) => ({
  id, title, tables: tables.map(({ name, label, fields }) => ({ name, label, fieldCount: fields.length })),
}));
const search = Object.fromEntries(groups.flatMap(({ tables }) => tables.map(({ name, desc, fields }) => [
  name, [desc, ...fields.flatMap(field => [field.name.toLowerCase(), field.label, field.desc])].join('\u0000'),
])));
assert.equal(Object.keys(search).length, catalog.reduce((sum, group) => sum + group.tables.length, 0), 'Table names must be unique');
for (const [filename, content] of [
  ['catalog.generated.json', catalog], ['search.generated.json', search],
]) {
  const target = new URL(filename, directory);
  const formatted = JSON.stringify(content, null, 2) + '\n';
  if (process.argv.includes('--check')) {
    assert.equal(await readFile(target, 'utf8'), formatted, 'Run node scripts/generate-schema-dictionary.mjs after editing schema groups');
  } else {
    await writeFile(target, formatted);
  }
}
