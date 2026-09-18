import express from 'express';
import {
  allowedOrigin,
  kioskSession,
  setupFallback,
  fallbackState,
  resetFallback,
  beginAttempt,
  failAttempt,
} from './fallback.js';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';

// Borrar al trabajador debe llevarse también su rostro: si no, los perfiles y
// sus plantillas se acumulan en la base facial sin que nadie pueda usarlos.
export async function deleteFaceProfile(profileId: string, employeeId: number) {
  const key = process.env.FACE_BRIDGE_KEY_FILE
    ? readFileSync(process.env.FACE_BRIDGE_KEY_FILE, 'utf8').trim()
    : '';
  if (!key) throw new Error('Integración facial no iniciada.');
  const base = process.env.FACE_LAB_URL ?? 'http://face-app:8080';
  const response = await fetch(base + '/api/profiles/' + profileId, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      origin: process.env.FACE_LAB_ORIGIN ?? 'http://localhost:8091',
      'x-turnos-key': key,
      'x-turnos-session': createHash('sha256')
        .update('employee-deletion:' + employeeId)
        .digest('hex'),
      'x-turnos-role': 'admin',
    },
    signal: AbortSignal.timeout(12000),
  });
  // Un rostro que ya no existe cuenta como borrado; cualquier otro fallo no.
  if (!response.ok && response.status !== 404)
    throw new Error(
      'No se pudo eliminar el rostro en el laboratorio; no se borró nada.',
    );
}

type DB = Database.Database;
export function setupFaceTables(db: DB) {
  setupFallback(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS face_links (
      employee_id INTEGER PRIMARY KEY REFERENCES employees(id),
      profile_id TEXT NOT NULL UNIQUE,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS face_attempts (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, action TEXT NOT NULL,
      expires_at INTEGER NOT NULL, result_json TEXT
    );
  `);
}

export function recordFaceClock(
  db: DB,
  attemptId: string,
  session: string,
  profile: string,
) {
  return db.transaction(() => {
    const attempt = db
      .prepare('SELECT * FROM face_attempts WHERE id=? AND session_id=?')
      .get(attemptId, session) as
      | { action: string; expires_at: number; result_json: string | null }
      | undefined;
    if (!attempt || attempt.expires_at < Date.now())
      throw new Error('Intento caducado. Vuelve a identificarte.');
    if (attempt.result_json) return JSON.parse(attempt.result_json);
    const employee = db
      .prepare(`SELECT e.id,e.name FROM employees e JOIN face_links f ON f.employee_id=e.id
      WHERE f.profile_id=? AND e.active=1`)
      .get(profile) as { id: number; name: string } | undefined;
    if (!employee)
      throw new Error(
        'Rostro identificado, pero no está vinculado a un trabajador activo. Consulta al administrador.',
      );
    const open = db
      .prepare(
        'SELECT id,clock_in FROM shifts WHERE employee_id=? AND clock_out IS NULL',
      )
      .get(employee.id) as { id: number; clock_in: string } | undefined;
    if (attempt.action === 'in' && open)
      throw new Error('Ya tienes una entrada registrada.');
    if (attempt.action === 'out' && !open)
      throw new Error('No tienes una entrada pendiente de salida.');
    const timestamp = new Date().toISOString();
    if (open && timestamp <= open.clock_in)
      throw new Error('La salida debe ser posterior a la entrada.');
    const shiftId = open
      ? open.id
      : Number(
          db
            .prepare(
              "INSERT INTO shifts(employee_id,clock_in,source,created_at,updated_at) VALUES (?,?,'face',?,?)",
            )
            .run(employee.id, timestamp, timestamp, timestamp).lastInsertRowid,
        );
    if (open)
      db.prepare('UPDATE shifts SET clock_out=?,updated_at=? WHERE id=?').run(
        timestamp,
        timestamp,
        open.id,
      );
    db.prepare(
      'INSERT INTO audit_log(action,entity_type,entity_id,detail,created_at) VALUES (?,?,?,?,?)',
    ).run(
      'face_clock_' + attempt.action,
      'shift',
      shiftId,
      JSON.stringify({ employee: employee.id, attempt: attemptId }),
      timestamp,
    );
    const result = {
      action: attempt.action,
      employee: employee.name,
      timestamp,
    };
    db.prepare('UPDATE face_attempts SET result_json=? WHERE id=?').run(
      JSON.stringify(result),
      attemptId,
    );
    resetFallback(db, session);
    return result;
  })();
}

export function faceRouter(db: DB, isAdmin: (req: express.Request) => boolean) {
  setupFaceTables(db);
  const router = express.Router();
  const key = process.env.FACE_BRIDGE_KEY_FILE
    ? readFileSync(process.env.FACE_BRIDGE_KEY_FILE, 'utf8').trim()
    : '';
  const base = process.env.FACE_LAB_URL ?? 'http://face-app:8080';
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!key && !req.path.startsWith('/attempts') && req.path !== '/fallback')
      return res.status(503).json({
        error: 'Integración facial no iniciada. Usa iniciar-integrado.bat.',
      });
    if (
      req.get('sec-fetch-site') === 'cross-site' ||
      (req.method !== 'GET' && !allowedOrigin(req))
    )
      return res.status(403).json({ error: 'Origen no permitido.' });
    res.locals.faceSession = kioskSession(req, res);
    next();
  });
  router.get('/fallback', (req, res) => {
    if (
      typeof req.query.action !== 'string' ||
      !['in', 'out'].includes(req.query.action)
    )
      return res.status(400).json({ error: 'Elige Entrada o Salida.' });
    res.json(fallbackState(db, res.locals.faceSession, req.query.action));
  });
  router.delete('/fallback', (_req, res) => {
    resetFallback(db, res.locals.faceSession);
    res.json({ ok: true });
  });
  router.post('/attempts', (req, res) => {
    if (!['in', 'out'].includes(req.body.action))
      return res.status(400).json({ error: 'Elige Entrada o Salida.' });
    res.json({ id: beginAttempt(db, res.locals.faceSession, req.body.action) });
  });
  router.post('/attempts/:id/camera-error', (req, res) => {
    // Hardware availability can only be reported by the browser. A server-issued,
    // session-bound attempt is consumed once; repeated reports never add failures.
    if (
      ![
        'NotAllowedError',
        'NotFoundError',
        'NotReadableError',
        'OverconstrainedError',
        'AbortError',
        'unsupported',
        'disconnected',
      ].includes(req.body.reason)
    )
      return res.status(400).json({ error: 'Error de cámara inválido.' });
    const attempt = db
      .prepare(
        'SELECT action FROM kiosk_attempts WHERE id=? AND session_id=? AND expires_at>?',
      )
      .get(req.params.id, res.locals.faceSession, Date.now()) as
      | { action: string }
      | undefined;
    if (!attempt)
      return res.status(404).json({ error: 'Intento no disponible.' });
    failAttempt(db, res.locals.faceSession, String(req.params.id));
    res.json(fallbackState(db, res.locals.faceSession, attempt.action));
  });
  async function upstream(
    req: express.Request,
    session: string,
    path: string,
    body?: unknown,
  ) {
    const response = await fetch(base + '/api' + path, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        origin: process.env.FACE_LAB_ORIGIN ?? 'http://localhost:8091',
        'x-turnos-key': key,
        'x-turnos-session': session,
        'x-turnos-role': isAdmin(req) ? 'admin' : 'kiosk',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });
    return { status: response.status, data: await response.json() };
  }
  router.get('/links', (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'admin_required' });
    res.json(db.prepare('SELECT employee_id,profile_id FROM face_links').all());
  });
  router.put('/links/:employee', (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'admin_required' });
    const id = Number(req.params.employee),
      profile = req.body.profile_id;
    if (
      !Number.isInteger(id) ||
      !db.prepare('SELECT id FROM employees WHERE id=?').get(id) ||
      (profile !== null &&
        (typeof profile !== 'string' || !/^[a-f0-9-]{36}$/.test(profile)))
    )
      return res.status(400).json({ error: 'Vinculación inválida.' });
    try {
      db.transaction(() => {
        if (profile === null)
          db.prepare('DELETE FROM face_links WHERE employee_id=?').run(id);
        else
          db.prepare(
            `INSERT INTO face_links VALUES (?,?,?) ON CONFLICT(employee_id) DO UPDATE SET profile_id=excluded.profile_id,updated_at=excluded.updated_at`,
          ).run(id, profile, new Date().toISOString());
        db.prepare(
          'INSERT INTO audit_log(action,entity_type,entity_id,detail,created_at) VALUES (?,?,?,?,?)',
        ).run(
          'face_link_updated',
          'employee',
          id,
          JSON.stringify({ profile_id: profile }),
          new Date().toISOString(),
        );
      })();
      res.json({ ok: true });
    } catch {
      res
        .status(409)
        .json({ error: 'Ese rostro ya está vinculado a otro trabajador.' });
    }
  });
  router.use(async (req, res) => {
    const path = req.path,
      method = req.method,
      session = res.locals.faceSession as string;
    const challenge = /^\/challenges\/([a-f0-9-]{36})(\/frame)?$/.exec(path);
    const publicAllowed =
      (path === '/challenges' &&
        method === 'POST' &&
        req.body.purpose === 'identify') ||
      (challenge &&
        ((method === 'POST' && challenge[2]) ||
          (method === 'DELETE' && !challenge[2])));
    const adminAllowed =
      (path === '/profiles' && ['GET', 'POST'].includes(method)) ||
      (/^\/profiles\/[a-f0-9-]{36}(\/face)?$/.test(path) &&
        ['PATCH', 'DELETE'].includes(method)) ||
      (path === '/challenges' && method === 'POST');
    if (!publicAllowed && !(isAdmin(req) && adminAllowed))
      return res.status(403).json({ error: 'admin_required' });
    let attemptId: string | undefined;
    try {
      const body =
        method === 'GET' || method === 'DELETE' ? undefined : { ...req.body };
      if (path === '/challenges' && body?.purpose === 'identify') {
        if (!['in', 'out'].includes(body.action))
          return res.status(400).json({ error: 'Elige Entrada o Salida.' });
        attemptId = body.attempt_id ?? beginAttempt(db, session, body.action);
        const attempt = db
          .prepare(
            "SELECT id FROM kiosk_attempts WHERE id=? AND session_id=? AND action=? AND state='pending' AND challenge_id IS NULL AND expires_at>?",
          )
          .get(attemptId, session, body.action, Date.now());
        if (!attempt)
          return res
            .status(409)
            .json({ error: 'Intento caducado. Reintenta.' });
        delete body.attempt_id;
        delete body.action;
      }
      if (challenge) {
        attemptId = (
          db
            .prepare(
              'SELECT id FROM kiosk_attempts WHERE challenge_id=? AND session_id=?',
            )
            .get(challenge[1], session) as { id: string } | undefined
        )?.id;
      }
      if (challenge && method === 'POST') {
        const cached = db
          .prepare(
            'SELECT result_json FROM face_attempts WHERE id=? AND session_id=? AND expires_at>?',
          )
          .get(challenge[1], session, Date.now()) as
          | { result_json: string | null }
          | undefined;
        if (cached?.result_json)
          return res.json({
            status: 'result',
            accepted: true,
            reason: 'ok',
            attendance: JSON.parse(cached.result_json),
          });
      }
      const response = await upstream(
        req,
        session,
        path + (method === 'GET' ? req.url.slice(path.length) : ''),
        body,
      );
      if (
        response.status < 300 &&
        path === '/challenges' &&
        body?.purpose === 'identify'
      ) {
        db.prepare('DELETE FROM face_attempts WHERE expires_at<?').run(
          Date.now() - 86400000,
        );
        db.prepare(
          'INSERT INTO face_attempts(id,session_id,action,expires_at) VALUES(?,?,?,?)',
        ).run(
          response.data.id,
          session,
          req.body.action,
          response.data.expires_at + 60000,
        );
        db.prepare('UPDATE kiosk_attempts SET challenge_id=? WHERE id=?').run(
          response.data.id,
          attemptId,
        );
      }
      if (
        attemptId &&
        method === 'POST' &&
        (response.status >= 500 ||
          response.data.error === 'challenge_expired' ||
          (response.data.status === 'result' && !response.data.accepted))
      )
        failAttempt(db, session, attemptId);
      if (attemptId && method === 'DELETE')
        db.prepare(
          "UPDATE kiosk_attempts SET state='closed' WHERE id=? AND state='pending'",
        ).run(attemptId);
      if (response.data.status === 'result' && response.data.accepted) {
        if (attemptId)
          db.prepare("UPDATE kiosk_attempts SET state='closed' WHERE id=?").run(
            attemptId,
          );
        try {
          response.data.attendance = recordFaceClock(
            db,
            challenge![1],
            session,
            response.data.profile_id,
          );
        } catch (error) {
          response.data.attendance_error = (error as Error).message;
        }
      }
      delete response.data.profile_id;
      res.status(response.status).json(response.data);
    } catch {
      if (attemptId && method === 'POST') failAttempt(db, session, attemptId);
      res.status(503).json({ error: 'face_service_unavailable' });
    }
  });
  return router;
}
