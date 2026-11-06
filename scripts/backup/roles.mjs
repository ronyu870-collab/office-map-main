// initdb already owns its bootstrap role. Skip only that CREATE declaration;
// retain every ALTER, membership option and original GRANTED BY provenance.
export function rolesForBootstrap(sql, bootstrap) {
  let skipped = 0;
  const result = sql.replace(/^CREATE ROLE ((?:"(?:[^"]|"")*"|[a-z_][a-z0-9_$]*));\r?$/gm, (statement, identifier) => {
    const name = identifier.startsWith('"') ? identifier.slice(1, -1).replaceAll('""', '"') : identifier;
    if (name !== bootstrap) return statement;
    skipped++; return '';
  });
  if (skipped > 1) throw new Error('RESTORE_BOOTSTRAP_DECLARATION_INVALID');
  return result;
}
