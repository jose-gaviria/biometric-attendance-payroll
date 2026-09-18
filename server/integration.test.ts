import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Request } from "express";
import { integrationSession } from "./integration.js";

test("bridge requires server key, bounded session and explicit role", () => {
  const dir = mkdtempSync(join(tmpdir(), "face-bridge-test-"));
  const old = process.env.TURNOS_BRIDGE_KEY_FILE;
  try {
    const key = "a".repeat(64), session = "b".repeat(64);
    writeFileSync(join(dir, "key"), key);
    process.env.TURNOS_BRIDGE_KEY_FILE = join(dir, "key");
    const request = (token: string, role = "kiosk", id = session) => {
      const headers: Record<string, string> = { "x-turnos-key": token, "x-turnos-role": role, "x-turnos-session": id };
      return { headers, get: (name: string) => headers[name] } as Request;
    };
    assert.deepEqual(integrationSession(request(key)), { id: "turnos:" + session, role: "kiosk" });
    assert.equal(integrationSession(request("c".repeat(64))), null);
    assert.equal(integrationSession(request("á".repeat(64))), null);
    assert.equal(integrationSession(request(key, "root")), null);
    assert.equal(integrationSession(request(key, "admin", "invalid")), null);
    delete process.env.TURNOS_BRIDGE_KEY_FILE;
    assert.equal(integrationSession(request(key, "admin")), null);
  } finally {
    if (old) process.env.TURNOS_BRIDGE_KEY_FILE = old;
    else delete process.env.TURNOS_BRIDGE_KEY_FILE;
    rmSync(dir, { recursive: true });
  }
});
