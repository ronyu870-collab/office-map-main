The group JSON files are the source for the admin data dictionary. After editing a group, run `node scripts/generate-schema-dictionary.mjs` and commit both generated indexes. Verify checks them against the source files.

The initial catalog includes table names, labels, and field counts. The search index keeps the existing table/field name, label, and description matches and loads on the first nonempty search. Full rules and field details load by group when a table is opened. No database metadata is queried.
