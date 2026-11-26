import { readdir, readFile } from "node:fs/promises";

const directory = new URL("../../migrations/", import.meta.url);

// Pitch owns these migrations. Other business modules set up their own
// prerequisites separately, including the real-estate source fixtures.
export async function loadPitchMigrations(client) {
  const names = (await readdir(directory)).filter(name => /^\d{14}_pitch_.+\.sql$/.test(name)).sort();
  for (const name of names) await client.query(await readFile(new URL(name, directory), "utf8"));
}
