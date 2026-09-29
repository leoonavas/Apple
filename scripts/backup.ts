import fs from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";

async function main() {
  const dataDir = path.resolve(process.env.APP_DATA_DIR ?? ".data");
  const source = path.join(dataDir, "apple.sqlite");
  await fs.access(source);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destination = path.join(dataDir, `backup-${stamp}`);
  await fs.mkdir(destination, { recursive: true, mode: 0o700 });
  const db = new Database(source, { readonly: true });
  try { await db.backup(path.join(destination, "apple.sqlite")); }
  finally { db.close(); }
  const attachments = path.join(dataDir, "attachments");
  try { await fs.cp(attachments, path.join(destination, "attachments"), { recursive: true, errorOnExist: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  console.log(`Backup criado em ${destination}`);
}

main().catch((error) => {
  console.error("Falha ao criar backup:", error);
  process.exitCode = 1;
});
