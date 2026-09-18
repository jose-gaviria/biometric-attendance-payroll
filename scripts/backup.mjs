import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
const db = new Database(
  resolve(process.env.DATA_DIR ?? "runtime/data", "face-lab.sqlite"),
  { fileMustExist: true },
);
const dir = resolve(process.env.BACKUP_DIR ?? "runtime/backups");
mkdirSync(dir, { recursive: true });
const output = resolve(
  dir,
  "face-lab-" + new Date().toISOString().replace(/[:.]/g, "-") + ".sqlite",
);
await db.backup(output);
const backup = new Database(output, { readonly: true });
if (backup.pragma("integrity_check", { simple: true }) !== "ok")
  throw new Error("Backup no válido");
backup.close();
db.close();
console.log("Backup local verificado: " + output);
