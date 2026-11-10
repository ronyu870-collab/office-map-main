import catalog from './catalog.generated.json';

export interface FieldDoc {
  name: string;
  label: string;
  type: string;
  desc: string;
  who?: string;
  note?: string;
}

export interface TableDoc {
  name: string;
  label: string;
  desc: string;
  fields: FieldDoc[];
  rules?: string[];
}

interface GroupDoc {
  id: string;
  title: string;
  desc: string;
  tables: TableDoc[];
}

export const schemaCatalog = catalog;
export const schemaCounts = catalog.reduce((totals, group) => ({
  tables: totals.tables + group.tables.length,
  fields: totals.fields + group.tables.reduce((sum, table) => sum + table.fieldCount, 0),
}), { tables: 0, fields: 0 });

export async function loadSchemaGroup(id: string): Promise<GroupDoc> {
  const { default: group } = await import(`./groups/${id}.json`) as { default: GroupDoc };
  return group;
}

export async function loadSchemaSearch(): Promise<Record<string, string>> {
  const { default: search } = await import('./search.generated.json');
  return search;
}

export function findSchemaTables(input: string, search: Record<string, string> | null) {
  if (!input.trim()) return catalog;
  const q = input.toLowerCase();
  return catalog.map(group => ({
    ...group,
    tables: group.tables.filter(table => table.name.toLowerCase().includes(q) ||
      table.label.includes(q) || search?.[table.name]?.includes(q)),
  })).filter(group => group.tables.length);
}
