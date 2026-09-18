import express from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DateTime } from 'luxon';
import { z } from 'zod';
import {
  adminCredential,
  audit,
  db,
  hashPin,
  setAdminPassword,
  verifyPin,
} from './db.js';
import { deleteFaceProfile, faceRouter } from './face.js';
import { employeePayrollPdf, runPayrollPdf } from './payroll-pdf.js';
import {
  allowedOrigin,
  fallbackState,
  kioskSession,
  resetFallback,
} from './fallback.js';
import {
  calculatePayroll,
  TIME_ZONE,
  type Bonus,
  type Employee,
  type LegalRule,
  type ManualDeduction,
  type Shift,
} from './payroll.js';

const app = express();
const port = Number(process.env.PORT ?? 3001);
const sessionSecret = process.env.SESSION_SECRET ?? 'attendance-local';
// La cookie se deriva tambien del hash de la clave vigente: al cambiarla, las
// sesiones abiertas en otros equipos dejan de valer sin tocar nada mas.
function sessionValue() {
  return crypto
    .createHmac('sha256', sessionSecret)
    .update('admin-session-v2:' + (adminCredential()?.password_hash ?? ''))
    .digest('hex');
}
const backupDir = process.env.BACKUP_DIR ?? path.resolve('backups');

app.disable('x-powered-by');
app.use(express.json({ limit: '500kb' }));
app.use(cookieParser());

const asyncRoute =
  (handler: express.RequestHandler): express.RequestHandler =>
  (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };

function isAdmin(req: express.Request) {
  const value = req.cookies?.attendance_admin;
  // Sin clave definida no hay sesion posible: aun no existe administrador.
  if (!adminCredential()) return false;
  const expected = sessionValue();
  return (
    typeof value === 'string' &&
    value.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(value), Buffer.from(expected))
  );
}

function abrirSesion(res: express.Response) {
  res.cookie('attendance_admin', sessionValue(), {
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 12 * 60 * 60 * 1000,
  });
}

const claveSchema = z.string().min(10).max(200);
const loginFailures = new Map<
  string,
  { failures: number; blockedUntil: number; lastFailureAt: number }
>();

function loginState(req: express.Request) {
  const key = req.ip || req.socket.remoteAddress || 'local';
  const state = loginFailures.get(key);
  const currentTime = Date.now();
  const blockExpired =
    state && state.blockedUntil > 0 && state.blockedUntil <= currentTime;
  const failuresExpired =
    state &&
    state.blockedUntil === 0 &&
    currentTime - state.lastFailureAt > 15 * 60_000;
  if (blockExpired || failuresExpired) {
    loginFailures.delete(key);
    return { key, failures: 0, blockedUntil: 0, lastFailureAt: 0 };
  }
  return {
    key,
    failures: state?.failures ?? 0,
    blockedUntil: state?.blockedUntil ?? 0,
    lastFailureAt: state?.lastFailureAt ?? 0,
  };
}

function requireAdmin(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  if (!isAdmin(req))
    return res.status(401).json({ error: 'Inicia sesión como administrador.' });
  next();
}

function now() {
  return new Date().toISOString();
}

function isLoopbackRequest(req: express.Request) {
  const hostname = req.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return ['localhost', '127.0.0.1', '::1'].includes(hostname);
}

function isConfiguredLanHost(req: express.Request) {
  const configured = process.env.LAN_ORIGIN;
  if (!configured) return false;
  try {
    return (
      req.get('host')?.toLowerCase() === new URL(configured).host.toLowerCase()
    );
  } catch {
    return false;
  }
}

// El puerto 8080 puede publicarse en la LAN, pero desde otra PC solo expone
// Administración. Marcación, lista del kiosco y fallos/PIN siguen limitados a
// localhost, tal como pidió el usuario.
app.use('/api', (req, res, next) => {
  if (isLoopbackRequest(req)) return next();
  if (!isConfiguredLanHost(req))
    return res.status(403).json({ error: 'Equipo no autorizado.' });
  if (req.path.startsWith('/admin/')) return next();
  if (req.path.startsWith('/face/') && isAdmin(req)) return next();
  return res.status(403).json({
    error: 'La marcación solo está disponible en el equipo principal.',
  });
});

app.use('/api/face', faceRouter(db, isAdmin));
function moneyToCents(value: number) {
  return Math.round(value * 100);
}

app.get('/api/health', (_req, res) => res.json({ ok: true, time: now() }));
app.get('/api/admin/session', (req, res) =>
  res.json({
    authenticated: isAdmin(req),
    configured: Boolean(adminCredential()),
  }),
);

// Primera entrada: quien llega define la clave. Solo funciona mientras no
// exista ninguna, de modo que nadie puede reemplazarla despues por aqui.
app.post('/api/admin/password/setup', (req, res) => {
  if (adminCredential())
    return res.status(409).json({
      error:
        'La clave ya está definida. Entra con ella y cámbiala desde Administración.',
    });
  const parsed = z
    .object({ password: claveSchema, confirm: claveSchema })
    .safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({ error: 'La clave debe tener al menos 10 caracteres.' });
  if (parsed.data.password !== parsed.data.confirm)
    return res.status(400).json({ error: 'Las dos claves no coinciden.' });
  setAdminPassword(parsed.data.password);
  audit('admin_password_created', 'session', null);
  abrirSesion(res);
  res.status(201).json({ ok: true });
});

app.post(
  '/api/admin/login',
  asyncRoute(async (req, res) => {
    const attempt = loginState(req);
    if (attempt.blockedUntil > Date.now()) {
      res.setHeader(
        'Retry-After',
        String(Math.ceil((attempt.blockedUntil - Date.now()) / 1000)),
      );
      return res.status(429).json({
        error: 'Demasiados intentos. Espera cinco minutos antes de reintentar.',
      });
    }
    const credencial = adminCredential();
    if (!credencial)
      return res
        .status(409)
        .json({ error: 'Todavía no hay clave definida en este equipo.' });
    const parsed = z
      .object({ password: z.string().min(1).max(200) })
      .safeParse(req.body);
    if (
      !parsed.success ||
      !verifyPin(parsed.data.password, credencial.password_hash)
    ) {
      const failures = attempt.failures + 1;
      loginFailures.set(attempt.key, {
        failures,
        blockedUntil: failures >= 5 ? Date.now() + 5 * 60_000 : 0,
        lastFailureAt: Date.now(),
      });
      audit('admin_login_failed', 'session', null);
      return res.status(401).json({ error: 'Clave incorrecta.' });
    }
    loginFailures.delete(attempt.key);
    abrirSesion(res);
    audit('admin_login', 'session', null);
    res.json({ ok: true });
  }),
);

// Cambio de clave: exige la actual antes de aceptar la nueva.
app.post(
  '/api/admin/password',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const credencial = adminCredential();
    const parsed = z
      .object({
        current: z.string().min(1).max(200),
        password: claveSchema,
        confirm: claveSchema,
      })
      .safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({ error: 'La clave nueva debe tener al menos 10 caracteres.' });
    if (
      !credencial ||
      !verifyPin(parsed.data.current, credencial.password_hash)
    ) {
      audit('admin_password_change_failed', 'session', null);
      return res.status(401).json({ error: 'La clave actual no es correcta.' });
    }
    if (parsed.data.password !== parsed.data.confirm)
      return res
        .status(400)
        .json({ error: 'Las dos claves nuevas no coinciden.' });
    if (parsed.data.password === parsed.data.current)
      return res
        .status(400)
        .json({ error: 'La clave nueva debe ser distinta de la actual.' });
    setAdminPassword(parsed.data.password);
    audit('admin_password_changed', 'session', null);
    // La cookie cambia con la clave: se renueva la de quien la cambio y
    // cualquier otra sesion abierta queda invalidada.
    abrirSesion(res);
    res.json({ ok: true });
  }),
);
app.post('/api/admin/logout', requireAdmin, (req, res) => {
  res.clearCookie('attendance_admin');
  res.json({ ok: true });
});

app.get('/api/kiosk/employees', (_req, res) => {
  const employees = db
    .prepare(
      `SELECT e.id, e.name, e.role,
       EXISTS(SELECT 1 FROM shifts s WHERE s.employee_id = e.id AND s.clock_out IS NULL) AS is_clocked_in
       FROM employees e WHERE e.active = 1 ORDER BY e.name`,
    )
    .all();
  res.json(employees);
});

app.post(
  '/api/clock',
  asyncRoute(async (req, res) => {
    const parsed = z
      .object({
        employee_id: z.coerce.number().int().positive(),
        action: z.enum(['in', 'out']),
        pin: z.string().regex(/^\d{4,8}$/),
      })
      .safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({ error: 'Elige un trabajador y escribe su PIN.' });
    const session = kioskSession(req);
    if (
      !allowedOrigin(req) ||
      !fallbackState(db, session, parsed.data.action).allowed
    )
      return res.status(403).json({
        error:
          'El PIN se habilita únicamente después de tres intentos faciales fallidos para esta entrada o salida.',
      });
    const employee = db
      .prepare('SELECT * FROM employees WHERE id = ? AND active = 1')
      .get(parsed.data.employee_id) as
      | (Employee & { pin_hash: string })
      | undefined;
    if (!employee || !verifyPin(parsed.data.pin, employee.pin_hash)) {
      audit('clock_denied', 'employee', employee?.id ?? null, {
        employee_id: parsed.data.employee_id,
        action: parsed.data.action,
      });
      return res.status(401).json({ error: 'PIN incorrecto.' });
    }
    const open = db
      .prepare(
        'SELECT * FROM shifts WHERE employee_id = ? AND clock_out IS NULL',
      )
      .get(employee.id) as { id: number; clock_in: string } | undefined;
    const timestamp = now();
    if (parsed.data.action === 'out') {
      if (!open)
        return res.status(409).json({
          error: `${employee.name} no tiene una entrada pendiente de salida.`,
        });
      db.prepare(
        'UPDATE shifts SET clock_out = ?, updated_at = ? WHERE id = ?',
      ).run(timestamp, timestamp, open.id);
      audit('clock_out', 'shift', open.id, { employee: employee.id });
      resetFallback(db, session);
      const minutes = Math.max(
        0,
        Math.round((Date.parse(timestamp) - Date.parse(open.clock_in)) / 60000),
      );
      return res.json({
        action: 'out',
        employee: employee.name,
        timestamp,
        minutes,
      });
    }
    if (open)
      return res.status(409).json({
        error: `${employee.name} ya tiene una entrada registrada.`,
      });
    const result = db
      .prepare(
        'INSERT INTO shifts (employee_id, clock_in, created_at, updated_at) VALUES (?, ?, ?, ?)',
      )
      .run(employee.id, timestamp, timestamp, timestamp);
    audit('clock_in', 'shift', Number(result.lastInsertRowid), {
      employee: employee.id,
    });
    resetFallback(db, session);
    res.json({ action: 'in', employee: employee.name, timestamp });
  }),
);

app.get('/api/admin/dashboard', requireAdmin, (_req, res) => {
  const todayStart = DateTime.now()
    .setZone(TIME_ZONE)
    .startOf('day')
    .toUTC()
    .toISO();
  const stats = {
    activeEmployees: (
      db
        .prepare('SELECT COUNT(*) count FROM employees WHERE active = 1')
        .get() as { count: number }
    ).count,
    openShifts: (
      db
        .prepare('SELECT COUNT(*) count FROM shifts WHERE clock_out IS NULL')
        .get() as { count: number }
    ).count,
    entriesToday: (
      db
        .prepare('SELECT COUNT(*) count FROM shifts WHERE clock_in >= ?')
        .get(todayStart) as { count: number }
    ).count,
  };
  const recent = db
    .prepare(`SELECT s.*, e.name employee_name, e.code employee_code FROM shifts s
    JOIN employees e ON e.id = s.employee_id ORDER BY s.clock_in DESC LIMIT 12`)
    .all();
  res.json({ stats, recent });
});

app.get('/api/admin/employees', requireAdmin, (_req, res) => {
  res.json(
    db
      .prepare(`SELECT id, code, name, document, role, monthly_salary_cents, transport_eligible,
    rest_day, active, created_at, updated_at FROM employees ORDER BY active DESC, name`)
      .all(),
  );
});

const employeeSchema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(2).max(100),
  document: z.string().trim().max(30).default(''),
  role: z.string().trim().min(2).max(60),
  monthly_salary: z.coerce.number().positive(),
  transport_eligible: z.boolean().default(true),
  pin: z.string().regex(/^\d{4,8}$/),
  rest_day: z.coerce.number().int().min(1).max(7).default(7),
  // Se aceptan temporalmente los campos del cliente anterior para que una
  // instalación sin actualizar no falle durante el cambio de imagen.
  work_days: z.array(z.number().int().min(1).max(7)).optional(),
  scheduled_start: z.string().optional(),
  scheduled_end: z.string().optional(),
  active: z.boolean().default(true),
});
const employeeUpdateSchema = employeeSchema.extend({
  pin: z.union([z.literal(''), z.string().regex(/^\d{4,8}$/)]),
});

function currentLegalRule() {
  const today = DateTime.now().setZone(TIME_ZONE).toISODate();
  return db
    .prepare(
      'SELECT * FROM legal_rules WHERE effective_from <= ? ORDER BY effective_from DESC LIMIT 1',
    )
    .get(today) as LegalRule;
}

app.post('/api/admin/employees', requireAdmin, (req, res) => {
  const parsed = employeeSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({
      error: 'Revisa los datos del trabajador.',
    });
  const salary = currentLegalRule().minimum_salary_cents;
  try {
    const data = parsed.data;
    const workDays = [1, 2, 3, 4, 5, 6, 7].filter(
      (day) => day !== data.rest_day,
    );
    // No se reutilizan identificadores de personas eliminadas porque las
    // liquidaciones históricas conservan ese número en su snapshot.
    const nextId = (
      db
        .prepare(
          `SELECT COALESCE(MAX(employee_id),0)+1 AS id FROM (
             SELECT id AS employee_id FROM employees
             UNION ALL SELECT employee_id FROM payroll_entries
           )`,
        )
        .get() as { id: number }
    ).id;
    const result = db
      .prepare(`INSERT INTO employees
      (id,code,name,document,role,monthly_salary_cents,transport_eligible,pin_hash,work_days,scheduled_start,scheduled_end,rest_day,active,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
        nextId,
        data.code,
        data.name,
        data.document,
        data.role,
        salary,
        Number(data.transport_eligible),
        hashPin(data.pin),
        workDays.join(','),
        '08:00',
        '15:00',
        data.rest_day,
        Number(data.active),
        now(),
        now(),
      );
    audit('employee_created', 'employee', Number(result.lastInsertRowid), {
      code: data.code,
      name: data.name,
    });
    res.status(201).json({ id: Number(result.lastInsertRowid) });
  } catch (error) {
    if (String(error).includes('UNIQUE'))
      return res
        .status(409)
        .json({ error: 'Ese código de trabajador ya existe.' });
    throw error;
  }
});

app.put('/api/admin/employees/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const parsed = employeeUpdateSchema.safeParse(req.body);
  if (!Number.isInteger(id) || !parsed.success)
    return res.status(400).json({ error: 'Revisa los datos del trabajador.' });
  const data = parsed.data;
  const workDays = [1, 2, 3, 4, 5, 6, 7].filter(
    (day) => day !== data.rest_day,
  );
  const salary = currentLegalRule().minimum_salary_cents;
  const pinHash = data.pin
    ? hashPin(data.pin)
    : (
        db.prepare('SELECT pin_hash FROM employees WHERE id=?').get(id) as
          | {
              pin_hash: string;
            }
          | undefined
      )?.pin_hash;
  if (!pinHash)
    return res.status(404).json({ error: 'Trabajador no encontrado.' });
  db.prepare(
    `UPDATE employees SET code=?,name=?,document=?,role=?,monthly_salary_cents=?,transport_eligible=?,pin_hash=?,work_days=?,scheduled_start=?,scheduled_end=?,rest_day=?,active=?,updated_at=? WHERE id=?`,
  ).run(
    data.code,
    data.name,
    data.document,
    data.role,
    salary,
    Number(data.transport_eligible),
    pinHash,
    workDays.join(','),
    '08:00',
    '15:00',
    data.rest_day,
    Number(data.active),
    now(),
    id,
  );
  audit('employee_updated', 'employee', id, { code: data.code });
  res.json({ ok: true });
});

// Qué arrastra consigo borrar a un trabajador. Se consulta antes de confirmar
// para que nadie borre a ciegas.
function deletionImpact(id: number) {
  const count = (sql: string) =>
    (db.prepare(sql).get(id) as { total: number }).total;
  return {
    shifts: count('SELECT COUNT(*) total FROM shifts WHERE employee_id=?'),
    open_shifts: count(
      'SELECT COUNT(*) total FROM shifts WHERE employee_id=? AND clock_out IS NULL',
    ),
    weekly_schedules: count(
      'SELECT COUNT(*) total FROM weekly_schedules WHERE employee_id=?',
    ),
    bonuses: count('SELECT COUNT(*) total FROM bonuses WHERE employee_id=?'),
    manual_deductions: count(
      'SELECT COUNT(*) total FROM manual_deductions WHERE employee_id=?',
    ),
    face_links: count(
      'SELECT COUNT(*) total FROM face_links WHERE employee_id=?',
    ),
    payroll_entries: count(
      'SELECT COUNT(*) total FROM payroll_entries WHERE employee_id=?',
    ),
  };
}

app.get('/api/admin/employees/:id/deletion', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0)
    return res.status(400).json({ error: 'Trabajador inválido.' });
  const employee = db
    .prepare('SELECT id,name FROM employees WHERE id=?')
    .get(id) as { id: number; name: string } | undefined;
  if (!employee)
    return res.status(404).json({ error: 'Trabajador no encontrado.' });
  res.json({ ...employee, ...deletionImpact(id), can_delete: true });
});

app.delete(
  '/api/admin/employees/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0)
      return res.status(400).json({ error: 'Trabajador inválido.' });
    const employee = db
      .prepare('SELECT id,code,name FROM employees WHERE id=?')
      .get(id) as { id: number; code: string; name: string } | undefined;
    if (!employee)
      return res.status(404).json({ error: 'Trabajador no encontrado.' });
    const impact = deletionImpact(id);
    // El rostro vive en la otra base, así que se borra primero: si el
    // laboratorio falla no se toca nada de Turnos y no queda a medias.
    const link = db
      .prepare('SELECT profile_id FROM face_links WHERE employee_id=?')
      .get(id) as { profile_id: string } | undefined;
    if (link) {
      try {
        await deleteFaceProfile(link.profile_id, id);
      } catch (error) {
        return res.status(502).json({ error: (error as Error).message });
      }
    }
    // Las liquidaciones guardadas no se tocan: cada una conserva su propia copia
    // con nombre y montos, así que siguen consultándose sin el trabajador.
    const remove = db.transaction(() => {
      db.prepare('DELETE FROM bonuses WHERE employee_id=?').run(id);
      db.prepare('DELETE FROM manual_deductions WHERE employee_id=?').run(id);
      db.prepare('DELETE FROM weekly_schedules WHERE employee_id=?').run(id);
      db.prepare('DELETE FROM face_links WHERE employee_id=?').run(id);
      db.prepare('DELETE FROM shifts WHERE employee_id=?').run(id);
      db.prepare('DELETE FROM employees WHERE id=?').run(id);
    });
    remove();
    audit('employee_deleted', 'employee', id, {
      code: employee.code,
      name: employee.name,
      face_profile_deleted: Boolean(link),
      ...impact,
    });
    res.json({ ok: true, ...impact });
  }),
);

app.get('/api/admin/shifts', requireAdmin, (req, res) => {
  const start =
    typeof req.query.start === 'string'
      ? req.query.start
      : DateTime.now().setZone(TIME_ZONE).startOf('month').toISODate()!;
  const end =
    typeof req.query.end === 'string'
      ? req.query.end
      : DateTime.now().setZone(TIME_ZONE).endOf('month').toISODate()!;
  const from = DateTime.fromISO(start, { zone: TIME_ZONE })
    .startOf('day')
    .toUTC()
    .toISO();
  const to = DateTime.fromISO(end, { zone: TIME_ZONE })
    .endOf('day')
    .toUTC()
    .toISO();
  const rows = db
    .prepare(`SELECT s.*, e.name employee_name, e.code employee_code FROM shifts s JOIN employees e ON e.id=s.employee_id
    WHERE s.clock_in <= ? AND (s.clock_out IS NULL OR s.clock_out >= ?) ORDER BY s.clock_in DESC`)
    .all(to, from);
  res.json(rows);
});

const shiftSchema = z.object({
  employee_id: z.coerce.number().int().positive(),
  clock_in: z.string().min(10),
  clock_out: z.string().min(10),
  note: z.string().max(300).default('Ajuste administrativo'),
});

function shiftConflict(
  employeeId: number,
  clockIn: string,
  clockOut: string,
  excludedId?: number,
) {
  return db
    .prepare(
      `SELECT id FROM shifts
       WHERE employee_id=? AND id<>? AND clock_in<?
         AND COALESCE(clock_out,'9999-12-31T23:59:59.999Z')>?
       LIMIT 1`,
    )
    .get(employeeId, excludedId ?? -1, clockOut, clockIn) as
    | { id: number }
    | undefined;
}

app.post('/api/admin/shifts', requireAdmin, (req, res) => {
  const parsed = shiftSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: 'Revisa las horas del turno.' });
  const clockIn = DateTime.fromISO(parsed.data.clock_in, {
    zone: TIME_ZONE,
  }).toUTC();
  const clockOut = DateTime.fromISO(parsed.data.clock_out, {
    zone: TIME_ZONE,
  }).toUTC();
  if (!clockIn.isValid || !clockOut.isValid || clockOut <= clockIn)
    return res
      .status(400)
      .json({ error: 'La salida debe ser posterior a la entrada.' });
  if (
    !db
      .prepare('SELECT id FROM employees WHERE id=?')
      .get(parsed.data.employee_id)
  )
    return res.status(400).json({ error: 'El trabajador no existe.' });
  if (
    shiftConflict(parsed.data.employee_id, clockIn.toISO()!, clockOut.toISO()!)
  )
    return res.status(409).json({
      error: 'Ese horario se cruza con otro turno del trabajador.',
    });
  const result = db
    .prepare(
      `INSERT INTO shifts (employee_id,clock_in,clock_out,source,note,created_at,updated_at) VALUES (?,?,?,'admin',?,?,?)`,
    )
    .run(
      parsed.data.employee_id,
      clockIn.toISO(),
      clockOut.toISO(),
      parsed.data.note,
      now(),
      now(),
    );
  audit(
    'shift_created_admin',
    'shift',
    Number(result.lastInsertRowid),
    parsed.data,
  );
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

app.put('/api/admin/shifts/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const parsed = shiftSchema.safeParse(req.body);
  if (!Number.isInteger(id) || !parsed.success)
    return res.status(400).json({ error: 'Revisa las horas del turno.' });
  const clockIn = DateTime.fromISO(parsed.data.clock_in, {
    zone: TIME_ZONE,
  }).toUTC();
  const clockOut = DateTime.fromISO(parsed.data.clock_out, {
    zone: TIME_ZONE,
  }).toUTC();
  if (!clockIn.isValid || !clockOut.isValid || clockOut <= clockIn)
    return res
      .status(400)
      .json({ error: 'La salida debe ser posterior a la entrada.' });
  if (!db.prepare('SELECT id FROM shifts WHERE id=?').get(id))
    return res.status(404).json({ error: 'Turno no encontrado.' });
  if (
    !db
      .prepare('SELECT id FROM employees WHERE id=?')
      .get(parsed.data.employee_id)
  )
    return res.status(400).json({ error: 'El trabajador no existe.' });
  if (
    shiftConflict(
      parsed.data.employee_id,
      clockIn.toISO()!,
      clockOut.toISO()!,
      id,
    )
  )
    return res.status(409).json({
      error: 'Ese horario se cruza con otro turno del trabajador.',
    });
  db.prepare(
    `UPDATE shifts SET employee_id=?,clock_in=?,clock_out=?,source='admin',note=?,updated_at=? WHERE id=?`,
  ).run(
    parsed.data.employee_id,
    clockIn.toISO(),
    clockOut.toISO(),
    parsed.data.note,
    now(),
    id,
  );
  audit('shift_updated_admin', 'shift', id, parsed.data);
  res.json({ ok: true });
});

app.get('/api/admin/legal-rules', requireAdmin, (_req, res) => {
  res.json(
    db.prepare('SELECT * FROM legal_rules ORDER BY effective_from DESC').all(),
  );
});

const legalRuleSchema = z.object({
  effective_from: z.iso.date(),
  minimum_salary: z.coerce.number().positive(),
  transport_allowance: z.coerce.number().nonnegative(),
  weekly_hours: z.coerce.number().int().min(1).max(48),
  night_start_hour: z.coerce.number().int().min(0).max(23),
  rest_day_surcharge: z.coerce.number().min(0).max(2),
});
app.post('/api/admin/legal-rules', requireAdmin, (req, res) => {
  const parsed = legalRuleSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: 'Revisa la configuración legal.' });
  const data = parsed.data;
  const today = DateTime.now().setZone(TIME_ZONE).toISODate()!;
  const existing = db
    .prepare('SELECT id FROM legal_rules WHERE effective_from=?')
    .get(data.effective_from);
  if (existing && data.effective_from <= today)
    return res.status(409).json({
      error: 'Una vigencia legal que ya comenzó no se puede sobrescribir.',
    });
  db.prepare(`INSERT INTO legal_rules (effective_from,minimum_salary_cents,transport_allowance_cents,weekly_hours,night_start_hour,rest_day_surcharge)
    VALUES (?,?,?,?,?,?) ON CONFLICT(effective_from) DO UPDATE SET minimum_salary_cents=excluded.minimum_salary_cents,
    transport_allowance_cents=excluded.transport_allowance_cents,weekly_hours=excluded.weekly_hours,night_start_hour=excluded.night_start_hour,rest_day_surcharge=excluded.rest_day_surcharge`).run(
    data.effective_from,
    moneyToCents(data.minimum_salary),
    moneyToCents(data.transport_allowance),
    data.weekly_hours,
    data.night_start_hour,
    data.rest_day_surcharge,
  );
  audit('legal_rule_saved', 'legal_rule', null, data);
  res.json({ ok: true });
});

const bonusSchema = z.object({
  employee_id: z.coerce.number().int().positive(),
  effective_date: z.iso.date(),
  concept: z.string().trim().min(2).max(120),
  amount: z.coerce.number().positive().max(1_000_000_000),
  constitutes_salary: z.boolean().default(false),
  note: z.string().trim().max(300).default(''),
});

app.get('/api/admin/bonuses', requireAdmin, (req, res) => {
  const range = z
    .object({ start_date: z.iso.date(), end_date: z.iso.date() })
    .safeParse(req.query);
  if (!range.success || range.data.end_date < range.data.start_date)
    return res.status(400).json({ error: 'Elige una quincena válida.' });
  const rows = db
    .prepare(
      `SELECT b.id,b.employee_id,e.name AS employee_name,b.effective_date,b.concept,
              b.amount_cents,b.constitutes_salary,b.note
       FROM bonuses b JOIN employees e ON e.id=b.employee_id
       WHERE b.effective_date BETWEEN ? AND ?
       ORDER BY e.name,b.effective_date,b.id`,
    )
    .all(range.data.start_date, range.data.end_date) as Array<{
    constitutes_salary: number;
  }>;
  res.json(
    rows.map((row) => ({
      ...row,
      constitutes_salary: Boolean(row.constitutes_salary),
    })),
  );
});

app.post('/api/admin/bonuses', requireAdmin, (req, res) => {
  const parsed = bonusSchema.safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({ error: 'Revisa los datos de la bonificación.' });
  const data = parsed.data;
  const employee = db
    .prepare('SELECT id FROM employees WHERE id=? AND active=1')
    .get(data.employee_id);
  if (!employee)
    return res.status(400).json({ error: 'Elige un trabajador activo.' });
  const amountCents = moneyToCents(data.amount);
  if (amountCents <= 0)
    return res.status(400).json({ error: 'El valor debe ser mayor que cero.' });
  const result = db
    .prepare(
      `INSERT INTO bonuses (employee_id,effective_date,concept,amount_cents,constitutes_salary,note,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    .run(
      data.employee_id,
      data.effective_date,
      data.concept,
      amountCents,
      Number(data.constitutes_salary),
      data.note,
      now(),
      now(),
    );
  audit('bonus_created', 'bonus', Number(result.lastInsertRowid), {
    employee_id: data.employee_id,
    concept: data.concept,
    amount_cents: amountCents,
    constitutes_salary: data.constitutes_salary,
  });
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

app.delete('/api/admin/bonuses/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0)
    return res.status(400).json({ error: 'Bonificación inválida.' });
  const result = db.prepare('DELETE FROM bonuses WHERE id=?').run(id);
  if (result.changes === 0)
    return res.status(404).json({ error: 'La bonificación ya no existe.' });
  // Las liquidaciones guardadas conservan su copia: borrar aquí no reescribe el pasado.
  audit('bonus_deleted', 'bonus', id, '');
  res.json({ ok: true });
});

const manualDeductionSchema = z.object({
  employee_id: z.coerce.number().int().positive(),
  effective_date: z.iso.date(),
  concept: z.string().trim().min(2).max(120),
  amount: z.coerce.number().positive().max(1_000_000_000),
  note: z.string().trim().max(300).default(''),
});

app.get('/api/admin/deductions', requireAdmin, (req, res) => {
  const range = z
    .object({ start_date: z.iso.date(), end_date: z.iso.date() })
    .safeParse(req.query);
  if (!range.success || range.data.end_date < range.data.start_date)
    return res.status(400).json({ error: 'Elige una quincena válida.' });
  res.json(
    db
      .prepare(
        `SELECT d.id,d.employee_id,e.name AS employee_name,d.effective_date,
              d.concept,d.amount_cents,d.note
       FROM manual_deductions d JOIN employees e ON e.id=d.employee_id
       WHERE d.effective_date BETWEEN ? AND ?
       ORDER BY e.name,d.effective_date,d.id`,
      )
      .all(range.data.start_date, range.data.end_date),
  );
});

app.post('/api/admin/deductions', requireAdmin, (req, res) => {
  const parsed = manualDeductionSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: 'Revisa los datos de la deducción.' });
  const data = parsed.data;
  const employee = db
    .prepare('SELECT id FROM employees WHERE id=? AND active=1')
    .get(data.employee_id);
  if (!employee)
    return res.status(400).json({ error: 'Elige un trabajador activo.' });
  const amountCents = moneyToCents(data.amount);
  const result = db
    .prepare(
      `INSERT INTO manual_deductions
       (employee_id,effective_date,concept,amount_cents,note,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?)`,
    )
    .run(
      data.employee_id,
      data.effective_date,
      data.concept,
      amountCents,
      data.note,
      now(),
      now(),
    );
  audit(
    'manual_deduction_created',
    'manual_deduction',
    Number(result.lastInsertRowid),
    {
      employee_id: data.employee_id,
      concept: data.concept,
      amount_cents: amountCents,
    },
  );
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

app.delete('/api/admin/deductions/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0)
    return res.status(400).json({ error: 'Deducción inválida.' });
  const result = db.prepare('DELETE FROM manual_deductions WHERE id=?').run(id);
  if (result.changes === 0)
    return res.status(404).json({ error: 'La deducción ya no existe.' });
  audit('manual_deduction_deleted', 'manual_deduction', id, '');
  res.json({ ok: true });
});

// El usuario pidió que las liquidaciones no se guarden para siempre. Se borran
// solas cuando su quincena supera esta antigüedad. Es irreversible: el CSV de
// cada quincena es la única copia que queda si no se descarga antes.
const configuredRetentionMonths = Number(
  process.env.PAYROLL_RETENTION_MONTHS ?? 2,
);
const payrollRetentionMonths =
  Number.isInteger(configuredRetentionMonths) && configuredRetentionMonths >= 1
    ? configuredRetentionMonths
    : 2;

function purgeExpiredPayroll() {
  const limit = DateTime.now()
    .setZone(TIME_ZONE)
    .minus({ months: payrollRetentionMonths })
    .toISODate();
  const expired = db
    .prepare(
      'SELECT id,start_date,end_date FROM payroll_runs WHERE end_date < ?',
    )
    .all(limit) as { id: number; start_date: string; end_date: string }[];
  if (expired.length === 0) return expired;
  const purge = db.transaction(() => {
    const remove = db.prepare('DELETE FROM payroll_runs WHERE id=?');
    for (const run of expired) {
      // Queda constancia de que existió y se retiró, sin conservar su contenido.
      audit('payroll_expired', 'payroll_run', run.id, {
        start_date: run.start_date,
        end_date: run.end_date,
        retention_months: payrollRetentionMonths,
      });
      remove.run(run.id);
    }
  });
  purge();
  return expired;
}

function buildPayroll(startDate: string, endDate: string) {
  const employees = db
    .prepare('SELECT * FROM employees WHERE active=1 ORDER BY name')
    .all() as Employee[];
  const rules = db
    .prepare(
      'SELECT effective_from,minimum_salary_cents,transport_allowance_cents,weekly_hours,night_start_hour,rest_day_surcharge FROM legal_rules ORDER BY effective_from',
    )
    .all() as LegalRule[];
  const periodStart = DateTime.fromISO(startDate, { zone: TIME_ZONE });
  const monthStart = periodStart.startOf('month');
  const monthEnd = periodStart.endOf('month');
  const from = monthStart.startOf('week').startOf('day').toUTC().toISO();
  const to = monthEnd.toUTC().toISO();
  return employees.map((employee) => {
    const shifts = db
      .prepare(
        `SELECT clock_in,clock_out FROM shifts WHERE employee_id=? AND clock_out IS NOT NULL AND clock_in<=? AND clock_out>=? ORDER BY clock_in`,
      )
      .all(employee.id, to, from) as Shift[];
    const monthlyBonuses = db
      .prepare(
        `SELECT id,effective_date,concept,amount_cents,constitutes_salary
         FROM bonuses WHERE employee_id=? AND effective_date BETWEEN ? AND ? ORDER BY effective_date,id`,
      )
      .all(
        employee.id,
        monthStart.toISODate(),
        monthEnd.toISODate(),
      ) as Bonus[];
    const monthly = calculatePayroll(
      employee,
      shifts,
      rules,
      monthStart.toISODate()!,
      monthEnd.toISODate()!,
      [],
      monthlyBonuses,
    );
    const bonuses = monthlyBonuses.filter((bonus) => {
      const row = bonus as Bonus & { effective_date?: string };
      return (
        !row.effective_date ||
        (row.effective_date >= startDate && row.effective_date <= endDate)
      );
    });
    const manualDeductions = db
      .prepare(
        `SELECT id,concept,amount_cents FROM manual_deductions
         WHERE employee_id=? AND effective_date BETWEEN ? AND ?
         ORDER BY effective_date,id`,
      )
      .all(employee.id, startDate, endDate) as ManualDeduction[];
    return calculatePayroll(
      employee,
      shifts,
      rules,
      startDate,
      endDate,
      [],
      bonuses,
      {
        ibc_cents: monthly.ibc_cents,
        salary_earnings_cents: monthly.salary_earnings_cents,
      },
      manualDeductions,
    );
  });
}

app.post('/api/admin/payroll', requireAdmin, (req, res) => {
  const parsed = z
    .object({ start_date: z.iso.date(), end_date: z.iso.date() })
    .safeParse(req.body);
  if (!parsed.success || parsed.data.end_date < parsed.data.start_date)
    return res.status(400).json({ error: 'Elige una quincena válida.' });
  const { start_date, end_date } = parsed.data;
  const startLocal = DateTime.fromISO(start_date, { zone: TIME_ZONE });
  const endLocal = DateTime.fromISO(end_date, { zone: TIME_ZONE });
  const isFirstHalf =
    startLocal.day === 1 &&
    endLocal.day === 15 &&
    startLocal.hasSame(endLocal, 'month');
  const isSecondHalf =
    startLocal.day === 16 &&
    endLocal.day === endLocal.endOf('month').day &&
    startLocal.hasSame(endLocal, 'month');
  if (!isFirstHalf && !isSecondHalf)
    return res.status(400).json({
      error:
        'La liquidación debe cubrir del 1 al 15 o del 16 al último día del mes.',
    });
  const annualRule = db
    .prepare(
      `SELECT id FROM legal_rules
       WHERE effective_from BETWEEN ? AND ? AND effective_from <= ?
       ORDER BY effective_from DESC LIMIT 1`,
    )
    .get(`${startLocal.year}-01-01`, `${startLocal.year}-12-31`, start_date);
  if (!annualRule)
    return res.status(409).json({
      error: `Falta cargar el salario mínimo y el auxilio de transporte de ${startLocal.year} en Reglas legales.`,
    });
  const periodEndUtc = endLocal.endOf('day').toUTC().toISO();
  const openShifts = db
    .prepare(
      `SELECT e.name FROM shifts s JOIN employees e ON e.id=s.employee_id
       WHERE s.clock_out IS NULL AND s.clock_in <= ? ORDER BY e.name`,
    )
    .all(periodEndUtc) as { name: string }[];
  if (openShifts.length > 0)
    return res.status(409).json({
      error: `No se puede liquidar: hay turnos sin salida de ${openShifts.map((row) => row.name).join(', ')}.`,
    });
  const entries = buildPayroll(start_date, end_date);
  const transaction = db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO payroll_runs (start_date,end_date,created_at,status) VALUES (?,?,?,'saved')`,
      )
      .run(start_date, end_date, now());
    const run = { id: Number(result.lastInsertRowid) };
    const insert = db.prepare(
      'INSERT INTO payroll_entries (payroll_run_id,employee_id,snapshot_json) VALUES (?,?,?)',
    );
    entries.forEach((entry) =>
      insert.run(run.id, entry.employee_id, JSON.stringify(entry)),
    );
    audit('payroll_generated', 'payroll_run', run.id, {
      start_date,
      end_date,
      employees: entries.length,
    });
    return run.id;
  });
  const runId = transaction();
  res.json({ run_id: runId, start_date, end_date, entries });
});

app.get('/api/admin/payroll-runs', requireAdmin, (_req, res) => {
  purgeExpiredPayroll();
  const runs = db
    .prepare('SELECT * FROM payroll_runs ORDER BY created_at DESC LIMIT 24')
    .all() as {
    id: number;
    start_date: string;
    end_date: string;
    created_at: string;
    status: string;
  }[];
  const entryQuery = db.prepare(
    'SELECT snapshot_json FROM payroll_entries WHERE payroll_run_id=?',
  );
  res.json(
    runs.map((run) => {
      const entries = entryQuery.all(run.id) as { snapshot_json: string }[];
      const total_cents = entries.reduce((sum, entry) => {
        const snapshot = JSON.parse(entry.snapshot_json);
        return sum + Number(snapshot.net_total_cents ?? snapshot.total_cents);
      }, 0);
      return { ...run, employees: entries.length, total_cents };
    }),
  );
});

app.get('/api/admin/payroll/:id', requireAdmin, (req, res) => {
  const run = db
    .prepare('SELECT * FROM payroll_runs WHERE id=?')
    .get(Number(req.params.id));
  if (!run)
    return res.status(404).json({ error: 'Liquidación no encontrada.' });
  const entries = db
    .prepare(
      'SELECT snapshot_json FROM payroll_entries WHERE payroll_run_id=? ORDER BY id',
    )
    .all(Number(req.params.id)) as { snapshot_json: string }[];
  res.json({
    ...(run as object),
    entries: entries.map((entry) => JSON.parse(entry.snapshot_json)),
  });
});

function liquidacionGuardada(id: number) {
  const run = db.prepare('SELECT * FROM payroll_runs WHERE id=?').get(id) as
    | { id: number; start_date: string; end_date: string }
    | undefined;
  if (!run) return null;
  const entries = (
    db
      .prepare(
        'SELECT snapshot_json FROM payroll_entries WHERE payroll_run_id=? ORDER BY id',
      )
      .all(id) as { snapshot_json: string }[]
  ).map((fila) => JSON.parse(fila.snapshot_json));
  return { run, entries };
}

function enviarPdf(
  res: express.Response,
  doc: PDFKit.PDFDocument,
  nombre: string,
) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
  doc.pipe(res);
}

app.get('/api/admin/payroll/:id/pdf', requireAdmin, (req, res) => {
  const guardada = liquidacionGuardada(Number(req.params.id));
  if (!guardada) return res.status(404).send('No encontrada');
  enviarPdf(
    res,
    runPayrollPdf(guardada.run, guardada.entries),
    `liquidacion-${guardada.run.start_date}-a-${guardada.run.end_date}.pdf`,
  );
});

app.get(
  '/api/admin/payroll/:id/employee/:employee/pdf',
  requireAdmin,
  (req, res) => {
    const guardada = liquidacionGuardada(Number(req.params.id));
    if (!guardada) return res.status(404).send('No encontrada');
    const entrada = guardada.entries.find(
      (fila) => fila.employee_id === Number(req.params.employee),
    );
    if (!entrada)
      return res.status(404).send('Ese trabajador no está en la liquidación');
    const limpio = String(entrada.employee_code || entrada.employee_id).replace(
      /[^A-Za-z0-9_-]/g,
      '',
    );
    enviarPdf(
      res,
      employeePayrollPdf(guardada.run, entrada),
      `nomina-${limpio}-${guardada.run.start_date}.pdf`,
    );
  },
);

app.get('/api/admin/payroll/:id/csv', requireAdmin, (req, res) => {
  const run = db
    .prepare('SELECT * FROM payroll_runs WHERE id=?')
    .get(Number(req.params.id)) as
    | { start_date: string; end_date: string }
    | undefined;
  if (!run) return res.status(404).send('No encontrada');
  const rows = db
    .prepare(
      'SELECT snapshot_json FROM payroll_entries WHERE payroll_run_id=? ORDER BY id',
    )
    .all(Number(req.params.id)) as { snapshot_json: string }[];
  const categories = [
    ['ordinary_day', 'Ordinaria diurna'],
    ['ordinary_night', 'Ordinaria nocturna'],
    ['overtime_day', 'Extra diurna'],
    ['overtime_night', 'Extra nocturna'],
    ['rest_day_day', 'Dominical festiva diurna'],
    ['rest_day_night', 'Dominical festiva nocturna'],
    ['overtime_rest_day', 'Extra dominical festiva diurna'],
    ['overtime_rest_night', 'Extra dominical festiva nocturna'],
  ];
  const header = [
    'Trabajador',
    'Código',
    'Horas totales',
    'Base',
    'Auxilio transporte',
    'Recargos y extras',
    'Bonificaciones',
    'Bonificaciones salariales',
    'Bonificaciones no salariales',
    'Total devengado',
    'IBC seguridad social',
    'Salud trabajador',
    'Pensión trabajador',
    'Fondo solidaridad pensional',
    'Otras deducciones',
    'Total deducciones',
    'Neto a pagar',
    'Alertas de cumplimiento',
    ...categories.flatMap(([, label]) => [`${label} horas`, `${label} valor`]),
  ];
  const csvRows = rows.map(({ snapshot_json }) => {
    const e = JSON.parse(snapshot_json);
    const breakdown = new Map(
      e.breakdown.map(
        (line: { category: string; hours: number; amount_cents: number }) => [
          line.category,
          line,
        ],
      ),
    );
    return [
      e.employee_name,
      e.employee_code,
      e.worked_hours,
      e.base_salary_cents / 100,
      e.transport_cents / 100,
      e.extras_cents / 100,
      (e.bonus_total_cents ?? 0) / 100,
      (e.bonus_salary_cents ?? 0) / 100,
      (e.bonus_non_salary_cents ?? 0) / 100,
      (e.gross_total_cents ?? e.total_cents) / 100,
      (e.ibc_cents ?? 0) / 100,
      (e.health_deduction_cents ?? 0) / 100,
      (e.pension_deduction_cents ?? 0) / 100,
      (e.solidarity_deduction_cents ?? 0) / 100,
      (e.manual_deduction_total_cents ?? 0) / 100,
      (e.total_deductions_cents ?? 0) / 100,
      (e.net_total_cents ?? e.total_cents) / 100,
      (e.compliance_alerts ?? [])
        .map((alert: { detail: string }) => alert.detail)
        .join(' | '),
      ...categories.flatMap(([category]) => {
        const line = breakdown.get(category) as
          | { hours: number; amount_cents: number }
          | undefined;
        return [line?.hours ?? 0, (line?.amount_cents ?? 0) / 100];
      }),
    ]
      .map((value) => `"${String(value).replaceAll('"', '""')}"`)
      .join(',');
  });
  res
    .type('text/csv')
    .setHeader(
      'Content-Disposition',
      `attachment; filename="nomina-${run.start_date}-${run.end_date}.csv"`,
    );
  res.send('\uFEFF' + [header.join(','), ...csvRows].join('\n'));
});

async function createBackup() {
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date()
    .toISOString()
    .replaceAll(':', '-')
    .replace('.000Z', 'Z');
  const target = path.join(backupDir, `attendance-payroll-${stamp}.sqlite`);
  await db.backup(target);
  const files = fs
    .readdirSync(backupDir)
    .filter((name) => /^attendance-payroll-.*\.sqlite$/.test(name))
    .map((name) => ({
      name,
      time: fs.statSync(path.join(backupDir, name)).mtimeMs,
    }))
    .sort((a, b) => b.time - a.time);
  files
    .slice(30)
    .forEach(({ name }) => fs.unlinkSync(path.join(backupDir, name)));
  return target;
}

app.post(
  '/api/admin/backup',
  requireAdmin,
  asyncRoute(async (_req, res) => {
    const target = await createBackup();
    audit('backup_created', 'database', null, { file: path.basename(target) });
    res.json({ ok: true, file: path.basename(target) });
  }),
);

const here = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.resolve(here, '..', 'dist');
app.use('/api', (_req, res) =>
  res.status(404).json({ error: 'Ruta no disponible.' }),
);
app.use(express.static(staticDir));
app.get(/.*/, (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));

app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(error);
    res.status(500).json({
      error: 'Ocurrió un error interno. El intento quedó registrado.',
    });
  },
);

app.listen(port, '0.0.0.0', () => {
  console.log(`Biometric Attendance & Payroll disponible en http://localhost:${port}`);
  const caducadas = purgeExpiredPayroll();
  if (caducadas.length > 0)
    console.log(
      `Liquidaciones retiradas por antigüedad (${payrollRetentionMonths} meses): ${caducadas.length}`,
    );
  setInterval(
    () => {
      try {
        purgeExpiredPayroll();
      } catch (error) {
        console.error('No fue posible retirar liquidaciones vencidas', error);
      }
    },
    6 * 60 * 60 * 1000,
  ).unref();
  createBackup().catch((error) =>
    console.error('No fue posible crear el respaldo inicial', error),
  );
  setInterval(
    () =>
      createBackup().catch((error) =>
        console.error('No fue posible crear el respaldo automático', error),
      ),
    24 * 60 * 60 * 1000,
  ).unref();
});
