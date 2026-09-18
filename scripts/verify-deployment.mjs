// Runs INSIDE an isolated verification container. Never run against user data.
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
const directory = process.env.DATA_DIR;
if (
  directory !== "/app/runtime/data" ||
  process.env.APP_ORIGIN !== "http://localhost:8092"
)
  throw new Error("Verification installation only");
const db = new Database(directory + "/face-lab.sqlite");
const phase = process.argv[2] ?? "seed";
const id = "00000000-0000-4000-8000-000000000001";
const expected = Array.from({ length: 128 }, (_, i) => +(i === 0));
if (phase === "seed") {
  assert.equal(
    db.prepare("SELECT count(*) n FROM face_profiles").get().n,
    0,
    "Requires an empty test database",
  );
  // This publicly known password protects only a disposable test installation.
  db.prepare("INSERT INTO admins VALUES(?,?)").run(
    "admin",
    await bcrypt.hash("Solo-prueba-local-8092", 12),
  );
  db.prepare(
    "INSERT INTO face_profiles(id,display_name,created_at,updated_at,consent_at) VALUES(?,?,?,?,?)",
  ).run(id, "Prueba numérica de persistencia", 1, 1, 1);
  const blob = Buffer.alloc(512);
  expected.forEach((v, i) => blob.writeFloatLE(v, i * 4));
  for (let i = 1; i <= 6; i++)
    db.prepare("INSERT INTO face_templates VALUES(?,?,?,?,?,?,?,?,?)").run(
      randomBytes(16).toString("hex"),
      id,
      blob,
      i,
      0.8,
      "SFace",
      "synthetic-verification-only",
      1,
      1,
    );
  const settings = JSON.parse(
    db.prepare("SELECT value FROM settings").get().value,
  );
  settings.threshold = 0.63;
  db.prepare("UPDATE settings SET value=?").run(JSON.stringify(settings));
  console.log(
    "Seeded isolated synthetic persistence data; not facial recognition.",
  );
} else if (phase === "verify") {
  assert.equal(
    db.prepare("SELECT display_name FROM face_profiles WHERE id=?").get(id)
      .display_name,
    "Prueba numérica de persistencia",
  );
  assert.equal(
    db
      .prepare("SELECT count(*) n FROM face_templates WHERE profile_id=?")
      .get(id).n,
    6,
  );
  assert.equal(
    JSON.parse(db.prepare("SELECT value FROM settings").get().value).threshold,
    0.63,
  );
  assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
  mkdirSync("/app/runtime/backups", { recursive: true });
  await db.backup("/app/runtime/backups/verification.sqlite");
  const backup = new Database("/app/runtime/backups/verification.sqlite", {
    readonly: true,
  });
  assert.equal(backup.pragma("integrity_check", { simple: true }), "ok");
  assert.equal(
    backup.prepare("SELECT count(*) n FROM face_templates").get().n,
    6,
  );
  backup.close();
  const health = await fetch("http://127.0.0.1:8080/health").then((r) =>
    r.json(),
  );
  assert.equal(health.status, "healthy");
  for (const target of ["http://1.1.1.1", "https://example.com"]) {
    let blocked = false;
    try {
      await fetch(target, { signal: AbortSignal.timeout(2000) });
    } catch {
      blocked = true;
    }
    assert.equal(blocked, true, "Unexpected outbound connection");
  }
  writeFileSync(
    directory + "/verification.json",
    JSON.stringify(
      {
        profile: true,
        templates: 6,
        settings: 0.63,
        backup_integrity: "ok",
        restart: true,
        outbound_blocked: true,
        health: health.status,
      },
      null,
      2,
    ),
  );
  console.log(readFileSync(directory + "/verification.json", "utf8"));
}
db.close();
