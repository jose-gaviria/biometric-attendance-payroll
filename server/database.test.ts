import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { openDatabase, encode, decode, gallery, settings } from "./db.js";
import { Lab } from "./lab.js";
import { initialLive } from "./liveness.js";
const vector = Array.from({ length: 128 }, (_, i) => +(i === 0));
function profile(db: ReturnType<typeof openDatabase>) {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO face_profiles(id,display_name,created_at,updated_at) VALUES(?,?,?,?)",
  ).run(id, "Prueba numérica", 1, 1);
  return id;
}
test("migration idempotent and vectors/settings persist across closing database", () => {
  const dir = mkdtempSync(join(tmpdir(), "face-db-")),
    path = join(dir, "test.sqlite");
  try {
    let db = openDatabase(path);
    const id = profile(db);
    db.prepare("INSERT INTO face_templates VALUES(?,?,?,?,?,?,?,?,?)").run(
      randomUUID(),
      id,
      encode(vector),
      1,
      0.8,
      "SFace",
      "test-version",
      1,
      1,
    );
    const cfg = settings(db);
    cfg.threshold = 0.62;
    db.prepare("UPDATE settings SET value=?").run(JSON.stringify(cfg));
    db.close();
    db = openDatabase(path);
    assert.equal(gallery(db, "test-version")[0].vectors.length, 1);
    assert.deepEqual(decode(encode(vector)), vector);
    assert.equal(settings(db).threshold, 0.62);
    assert.equal(db.pragma("user_version", { simple: true }), 2);
    db.close();
  } finally {
    rmSync(dir, { recursive: true });
  }
});
test("inactive profiles and incompatible models excluded", () => {
  const db = openDatabase(":memory:"),
    id = profile(db);
  db.prepare("INSERT INTO face_templates VALUES(?,?,?,?,?,?,?,?,?)").run(
    randomUUID(),
    id,
    encode(vector),
    1,
    0.8,
    "SFace",
    "old",
    1,
    1,
  );
  assert.equal(gallery(db, "new").length, 0);
  db.prepare("UPDATE face_profiles SET active=0").run();
  assert.equal(gallery(db, "old").length, 0);
  db.close();
});
test("duplicate checks can include inactive profiles", () => {
  const db = openDatabase(":memory:"),
    id = profile(db);
  db.prepare("UPDATE face_profiles SET active=0 WHERE id=?").run(id);
  db.prepare("INSERT INTO face_templates VALUES(?,?,?,?,?,?,?,?,?)").run(
    randomUUID(),
    id,
    encode(vector),
    1,
    0.8,
    "SFace",
    "current",
    1,
    1,
  );
  assert.equal(gallery(db, "current").length, 0);
  assert.equal(gallery(db, "current", true).length, 1);
  db.close();
});
test("deleting profile cascades templates and identifying logs", () => {
  const db = openDatabase(":memory:"),
    id = profile(db);
  db.prepare("INSERT INTO face_templates VALUES(?,?,?,?,?,?,?,?,?)").run(
    randomUUID(),
    id,
    encode(vector),
    1,
    0.8,
    "SFace",
    "test",
    1,
    1,
  );
  const lab = new Lab(db);
  lab.log(id, 0.8, 0.1, true, true, "identified");
  db.prepare("DELETE FROM face_profiles WHERE id=?").run(id);
  assert.equal(
    (db.prepare("SELECT count(*) n FROM face_templates").get() as any).n,
    0,
  );
  assert.equal(
    (db.prepare("SELECT count(*) n FROM face_identification_log").get() as any)
      .n,
    0,
  );
  db.close();
});
test("expired reused wrong-session challenges rejected", () => {
  const db = openDatabase(":memory:"),
    lab = new Lab(db),
    id = randomUUID();
  db.prepare(
    "INSERT INTO face_challenges(id,nonce,type,created_at,expires_at,used,session_id,purpose,profile_id) VALUES(?,?,?,?,?,?,?,?,?)",
  ).run(id, "nonce", "blink", 0, 1, 0, "session", "identify", null);
  assert.throws(
    () => lab.challenge(id, "nonce", "session"),
    /challenge_expired/,
  );
  assert.throws(() => lab.challenge(id, "nonce", "session"), /challenge_used/);
  assert.throws(() => lab.challenge(id, "nonce", "other"), /challenge_invalid/);
  db.close();
});
test("transaction preserves previous templates when new profile check fails", () => {
  const db = openDatabase(":memory:"),
    id = profile(db),
    lab = new Lab(db);
  db.prepare("INSERT INTO face_templates VALUES(?,?,?,?,?,?,?,?,?)").run(
    randomUUID(),
    id,
    encode(vector),
    1,
    0.8,
    "SFace",
    "v",
    1,
    1,
  );
  const challengeId = randomUUID();
  db.prepare(
    "INSERT INTO face_challenges(id,nonce,type,created_at,expires_at,used,session_id,purpose,profile_id) VALUES(?,?,?,?,?,?,?,?,?)",
  ).run(
    challengeId,
    "nonce",
    "left",
    Date.now(),
    Date.now() + 20000,
    0,
    "s",
    "enroll",
    id,
  );
  assert.throws(
    () =>
      lab.finish(
        {
          id: challengeId,
          nonce: "nonce",
          type: "left",
          expires_at: Date.now() + 20000,
          used: 0,
          session_id: "s",
          purpose: "enroll",
          profile_id: id,
        },
        {
          live: initialLive(),
          samples: [],
          busy: false,
          lastFrame: 0,
          lastSample: 0,
          frames: 0,
          profileUpdated: 0,
          version: "v",
          sampleTarget: 0,
          samplePromptedAt: 0,
        },
      ),
    /profile_changed/,
  );
  assert.equal(gallery(db, "v")[0].vectors.length, 1);
  db.close();
});
