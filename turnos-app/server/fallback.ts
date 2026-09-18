import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import type Database from 'better-sqlite3';
type DB = Database.Database;
const TTL = 10 * 60_000;
export function setupFallback(db: DB) {
  db.exec(`CREATE TABLE IF NOT EXISTS kiosk_attempts (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, action TEXT NOT NULL,
    expires_at INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
    challenge_id TEXT UNIQUE);
    CREATE INDEX IF NOT EXISTS kiosk_attempt_session ON kiosk_attempts(session_id,action);`);
}
export function allowedOrigin(req: Request) {
  const configured = new URL(process.env.APP_ORIGIN ?? 'http://localhost:8080');
  const origins = new Set([configured.origin]);
  if (['localhost', '127.0.0.1'].includes(configured.hostname)) {
    configured.hostname =
      configured.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
    origins.add(configured.origin);
  }
  // Acceso opcional a Administración desde otra PC de la misma red local. Se
  // exige coincidencia exacta de un único origen elegido a mano; nunca se
  // acepta cualquier origen, para no perder la protección contra otros sitios.
  const lan = process.env.LAN_ORIGIN;
  if (lan) {
    try {
      origins.add(new URL(lan).origin);
    } catch {
      // Un LAN_ORIGIN mal escrito no debe tumbar el servidor: se ignora.
    }
  }
  return (
    req.get('sec-fetch-site') !== 'cross-site' &&
    origins.has(req.get('origin') ?? '')
  );
}
export function kioskSession(req: Request, res?: Response) {
  let token = req.cookies?.turnos_kiosk;
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
    if (!res) return '';
    token = randomBytes(32).toString('hex');
    res.cookie('turnos_kiosk', token, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/api',
      maxAge: 12 * 3600_000,
    });
  }
  return createHash('sha256').update(token).digest('hex');
}
export function fallbackState(db: DB, session: string, action: string) {
  const row = db
    .prepare(`SELECT COUNT(*) AS failures, MIN(expires_at) AS expires_at
    FROM kiosk_attempts WHERE session_id=? AND action=? AND state='failed' AND expires_at>?`)
    .get(session, action, Date.now()) as {
    failures: number;
    expires_at: number | null;
  };
  return {
    action,
    failures: Math.min(3, row.failures),
    allowed: row.failures >= 3,
    expires_at: row.expires_at,
  };
}
export function resetFallback(db: DB, session: string) {
  // Closing pending attempts prevents a late error from unlocking the next person's PIN.
  db.prepare("UPDATE kiosk_attempts SET state='closed' WHERE session_id=?").run(
    session,
  );
}
export function beginAttempt(db: DB, session: string, action: string) {
  db.prepare('DELETE FROM kiosk_attempts WHERE expires_at<?').run(Date.now());
  db.prepare(
    "UPDATE kiosk_attempts SET state='closed' WHERE session_id=? AND action=? AND state='pending'",
  ).run(session, action);
  const id = randomUUID();
  db.prepare(
    'INSERT INTO kiosk_attempts(id,session_id,action,expires_at) VALUES(?,?,?,?)',
  ).run(id, session, action, Date.now() + TTL);
  return id;
}
export function failAttempt(db: DB, session: string, id: string) {
  db.prepare(
    "UPDATE kiosk_attempts SET state='failed' WHERE id=? AND session_id=? AND state='pending' AND expires_at>?",
  ).run(id, session, Date.now());
}
