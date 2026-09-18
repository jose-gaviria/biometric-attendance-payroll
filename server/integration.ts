import { readFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import type { Request } from "express";

export function integrationSession(req: Request) {
  const file = process.env.TURNOS_BRIDGE_KEY_FILE;
  if (!file || !req.headers["x-turnos-key"]) return null;
  const expected = readFileSync(file, "utf8").trim();
  const supplied = req.get("x-turnos-key") ?? "";
  if (!/^[a-f0-9]{64}$/.test(expected) || !/^[a-f0-9]{64}$/.test(supplied) ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return null;
  const id = req.get("x-turnos-session") ?? "";
  const role = req.get("x-turnos-role");
  if (!/^[a-f0-9]{64}$/.test(id) || !["admin", "kiosk"].includes(role ?? "")) return null;
  return { id: "turnos:" + id, role };
}
