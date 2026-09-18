import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { config, settingsSchema, type Settings } from "./config.js";
import { vectorValid, type Candidate, type Vector } from "./matching.js";

export function openDatabase(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("secure_delete = ON");
  db.pragma("busy_timeout = 5000");
  const version = db.pragma("user_version", { simple: true }) as number;
  if (version > 2) throw new Error("Database newer than application");
  if (version < 1)
    db.transaction(() => {
      db.exec(`
      CREATE TABLE face_profiles(id TEXT PRIMARY KEY, display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 100), external_reference TEXT, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, consent_at INTEGER);
      CREATE TABLE face_templates(id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES face_profiles(id) ON DELETE CASCADE, embedding BLOB NOT NULL CHECK(length(embedding)=512), sample_number INTEGER NOT NULL, quality_score REAL NOT NULL CHECK(quality_score BETWEEN 0 AND 1), model_name TEXT NOT NULL, model_version TEXT NOT NULL, created_at INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)), UNIQUE(profile_id,sample_number));
      CREATE INDEX templates_profile ON face_templates(profile_id,active);
      CREATE TABLE face_identification_log(id TEXT PRIMARY KEY,profile_id TEXT REFERENCES face_profiles(id) ON DELETE CASCADE,score REAL,second_score REAL,accepted INTEGER NOT NULL,liveness_passed INTEGER NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE face_challenges(id TEXT PRIMARY KEY,nonce TEXT NOT NULL,type TEXT NOT NULL CHECK(type IN('blink','left','right')),created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0 CHECK(used IN(0,1)),session_id TEXT NOT NULL,purpose TEXT NOT NULL CHECK(purpose IN('enroll','identify')),profile_id TEXT REFERENCES face_profiles(id) ON DELETE CASCADE);
      CREATE TABLE settings(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL);
      CREATE TABLE admins(id TEXT PRIMARY KEY,password_hash TEXT NOT NULL);
      CREATE TABLE sessions(id TEXT PRIMARY KEY,role TEXT NOT NULL CHECK(role IN('admin','kiosk')),expires_at INTEGER NOT NULL);
      CREATE TABLE audit_log(id TEXT PRIMARY KEY,action TEXT NOT NULL,profile_id TEXT REFERENCES face_profiles(id) ON DELETE CASCADE,created_at INTEGER NOT NULL);
      PRAGMA user_version = 1;
    `);
    })();
  if (version < 2)
    db.transaction(() => {
      db.exec(
        "ALTER TABLE face_challenges ADD COLUMN capture_mode TEXT NOT NULL DEFAULT 'active' CHECK(capture_mode IN('active','frontal')); PRAGMA user_version = 2;",
      );
    })();
  db.prepare("INSERT OR IGNORE INTO settings(id,value) VALUES(1,?)").run(
    JSON.stringify({
      threshold: config.FACE_MATCH_THRESHOLD,
      margin: config.FACE_AMBIGUITY_MARGIN,
      minQuality: config.FACE_MIN_QUALITY,
      duplicateThreshold: config.FACE_DUPLICATE_THRESHOLD,
    }),
  );
  return db;
}
export type DB = ReturnType<typeof openDatabase>;
export const settings = (db: DB): Settings =>
  settingsSchema.parse(
    JSON.parse(
      (
        db.prepare("SELECT value FROM settings WHERE id=1").get() as {
          value: string;
        }
      ).value,
    ),
  );
export const audit = (
  db: DB,
  action: string,
  profileId: string | null = null,
) =>
  db
    .prepare("INSERT INTO audit_log VALUES(?,?,?,?)")
    .run(randomUUID(), action, profileId, Date.now());
export function encode(v: Vector) {
  if (!vectorValid(v)) throw new Error("Invalid embedding");
  const b = Buffer.alloc(512);
  v.forEach((x, i) => b.writeFloatLE(x, i * 4));
  return b;
}
export function decode(b: Buffer): Vector {
  const v = Array.from({ length: 128 }, (_, i) => b.readFloatLE(i * 4));
  if (!vectorValid(v)) throw new Error("Invalid stored embedding");
  return v;
}
export function gallery(db: DB, version: string, includeInactive = false): Candidate[] {
  const rows = db
    .prepare(
      `SELECT p.id,p.display_name,t.embedding FROM face_profiles p JOIN face_templates t ON p.id=t.profile_id WHERE (?=1 OR p.active=1) AND t.active=1 AND t.model_name='SFace' AND t.model_version=? ORDER BY p.id,t.sample_number`,
    )
    .all(Number(includeInactive), version) as {
    id: string;
    display_name: string;
    embedding: Buffer;
  }[];
  const map = new Map<string, Candidate>();
  for (const r of rows) {
    const p = map.get(r.id) ?? { id: r.id, name: r.display_name, vectors: [] };
    p.vectors.push(decode(r.embedding));
    map.set(r.id, p);
  }
  return [...map.values()];
}
export function cleanup(db: DB) {
  const now = Date.now();
  db.prepare("DELETE FROM sessions WHERE expires_at<?").run(now);
  db.prepare("DELETE FROM face_challenges WHERE expires_at<?").run(now - 60000);
  db.prepare("DELETE FROM face_identification_log WHERE created_at<?").run(
    now - 30 * 86400000,
  );
  db.prepare("DELETE FROM audit_log WHERE created_at<?").run(
    now - 30 * 86400000,
  );
}
