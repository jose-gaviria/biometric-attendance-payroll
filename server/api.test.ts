import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { createApp } from "./app.js";
import { encode, openDatabase } from "./db.js";
import type { Server } from "node:http";
let server: Server,
  url: string,
  cookie = "",
  id = "";
const db = openDatabase(":memory:"),
  password = randomBytes(24).toString("hex");
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  auth = true,
  origin = "http://localhost:8091",
) {
  return fetch(url + "/api" + path, {
    method,
    headers: {
      Origin: origin,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(auth ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
before(async () => {
  db.prepare("INSERT INTO admins VALUES(?,?)").run(
    "admin",
    await bcrypt.hash(password, 12),
  );
  server = createApp(db).app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  url = "http://127.0.0.1:" + (server.address() as any).port;
});
after(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  db.close();
});
test("unauthenticated administration blocked", async () =>
  assert.equal(
    (await request("/profiles", "GET", undefined, false)).status,
    401,
  ));
test("cross-site mutation blocked", async () =>
  assert.equal(
    (
      await request(
        "/login",
        "POST",
        { password },
        false,
        "https://example.com",
      )
    ).status,
    403,
  ));
test("incorrect credentials rejected", async () =>
  assert.equal(
    (await request("/login", "POST", { password: "incorrect" }, false)).status,
    401,
  ));
test("same machine written as 127.0.0.1 is not rejected", async () =>
  assert.notEqual(
    (
      await request(
        "/login",
        "POST",
        { password: "incorrect" },
        false,
        "http://127.0.0.1:8091",
      )
    ).status,
    403,
  ));
test("another port on the same machine stays rejected", async () =>
  assert.equal(
    (
      await request(
        "/login",
        "POST",
        { password: "incorrect" },
        false,
        "http://127.0.0.1:9999",
      )
    ).status,
    403,
  ));
test("login sets strict HttpOnly cookie", async () => {
  const r = await request("/login", "POST", { password }, false);
  assert.equal(r.status, 200);
  const c = r.headers.get("set-cookie")!;
  assert.match(c, /HttpOnly/);
  assert.match(c, /SameSite=Strict/);
  cookie = c.split(";")[0];
});
test("create profile real HTTP and SQLite", async () => {
  const r = await request("/profiles", "POST", {
    display_name: "Prueba API",
    external_reference: "LOCAL-1",
  });
  assert.equal(r.status, 201);
  id = (await r.json()).id;
});
test("edit profile and validate fields", async () => {
  assert.equal(
    (
      await request("/profiles/" + id, "PATCH", {
        display_name: "Prueba editada",
      })
    ).status,
    200,
  );
  assert.equal(
    (await request("/profiles", "POST", { display_name: "", injected: true }))
      .status,
    400,
  );
});
test("profile serialization never includes embeddings", async () => {
  const r = await request("/profiles");
  const text = await r.text();
  assert.match(text, /Prueba editada/);
  assert.doesNotMatch(text, /embedding/);
});
test("deactivate and reactivate profile", async () => {
  assert.equal(
    (await request("/profiles/" + id, "PATCH", { active: false })).status,
    200,
  );
  assert.equal(
    (db.prepare("SELECT active FROM face_profiles WHERE id=?").get(id) as any)
      .active,
    0,
  );
  await request("/profiles/" + id, "PATCH", { active: true });
});
test("reactivation cannot create two active profiles with the same face", async () => {
  const other = randomUUID(),
    now = Date.now(),
    vector = Array.from({ length: 128 }, (_, index) => Number(index === 0));
  db.prepare(
    "INSERT INTO face_profiles(id,display_name,created_at,updated_at) VALUES(?,?,?,?)",
  ).run(other, "Duplicado", now, now);
  const insert = db.prepare(
    "INSERT INTO face_templates(id,profile_id,embedding,sample_number,quality_score,model_name,model_version,created_at) VALUES(?,?,?,?,?,?,?,?)",
  );
  insert.run(randomUUID(), id, encode(vector), 1, 0.9, "SFace", "v", now);
  insert.run(randomUUID(), other, encode(vector), 1, 0.9, "SFace", "v", now);
  await request("/profiles/" + id, "PATCH", { active: false });
  assert.equal(
    (await request("/profiles/" + id, "PATCH", { active: true })).status,
    409,
  );
  db.prepare("DELETE FROM face_profiles WHERE id=?").run(other);
  db.prepare("DELETE FROM face_templates WHERE profile_id=?").run(id);
  assert.equal(
    (await request("/profiles/" + id, "PATCH", { active: true })).status,
    200,
  );
});
test("missing consent prevents enrollment", async () =>
  assert.equal(
    (
      await request("/challenges", "POST", {
        purpose: "enroll",
        profile_id: id,
      })
    ).status,
    403,
  ));
test("face-service unavailable returns safe error", async () => {
  const r = await request("/challenges", "POST", { purpose: "identify" });
  assert.equal(r.status, 503);
  assert.doesNotMatch(await r.text(), /stack|Traceback|ECONNREFUSED/);
});
test("settings persist and reject impossible thresholds", async () => {
  assert.equal(
    (
      await request("/settings", "PUT", {
        threshold: 0.6,
        margin: 0.1,
        minQuality: 0.6,
        duplicateThreshold: 0.6,
      })
    ).status,
    200,
  );
  assert.equal((await (await request("/settings")).json()).threshold, 0.6);
  assert.equal(
    (await request("/settings", "PUT", { threshold: -1 })).status,
    400,
  );
  assert.equal(
    (
      await request("/settings", "PUT", {
        threshold: 0.45,
        margin: 0.01,
        minQuality: 0.3,
        duplicateThreshold: 0.85,
      })
    ).status,
    400,
  );
});
test("delete biometric data retains profile and audits", async () => {
  assert.equal(
    (await request("/profiles/" + id + "/face", "DELETE")).status,
    200,
  );
  assert.ok(db.prepare("SELECT id FROM face_profiles WHERE id=?").get(id));
  const r = await (await request("/logs")).json();
  assert.ok(r.actions.some((a: any) => a.action === "face_deleted"));
});
test("delete profile real HTTP", async () =>
  assert.equal((await request("/profiles/" + id, "DELETE")).status, 200));
test("kiosk role cannot list profiles or change settings", async () => {
  assert.equal((await request("/kiosk", "POST", {})).status, 200);
  assert.equal((await request("/profiles")).status, 403);
  assert.equal((await request("/settings")).status, 403);
  assert.equal(
    (
      await request("/challenges", "POST", {
        purpose: "enroll",
        profile_id: id,
        consent: true,
      })
    ).status,
    403,
  );
});
test("logout revokes session", async () => {
  await request("/logout", "POST", {});
  assert.equal((await request("/session")).status, 401);
});
