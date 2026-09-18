import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = process.env.DATA_DIR ?? path.resolve('data');
fs.mkdirSync(dataDir, { recursive: true });
export const db = new Database(path.join(dataDir, 'attendance-payroll.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    document TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'Operario',
    monthly_salary_cents INTEGER NOT NULL,
    transport_eligible INTEGER NOT NULL DEFAULT 1 CHECK (transport_eligible IN (0,1)),
    pin_hash TEXT NOT NULL,
    work_days TEXT NOT NULL DEFAULT '1,2,3,4,5,6',
    scheduled_start TEXT NOT NULL DEFAULT '08:00',
    scheduled_end TEXT NOT NULL DEFAULT '15:00',
    rest_day INTEGER NOT NULL DEFAULT 7 CHECK (rest_day BETWEEN 1 AND 7),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS shifts (
    id INTEGER PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    clock_in TEXT NOT NULL,
    clock_out TEXT,
    source TEXT NOT NULL DEFAULT 'kiosk',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (clock_out IS NULL OR clock_out > clock_in)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_shifts_one_open_per_employee ON shifts(employee_id) WHERE clock_out IS NULL;
  CREATE INDEX IF NOT EXISTS idx_shifts_employee_clock_in ON shifts(employee_id, clock_in);
  CREATE TABLE IF NOT EXISTS weekly_schedules (
    id INTEGER PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    work_date TEXT NOT NULL,
    is_work_day INTEGER NOT NULL CHECK (is_work_day IN (0,1)),
    is_rest_day INTEGER NOT NULL DEFAULT 0 CHECK (is_rest_day IN (0,1)),
    scheduled_start TEXT,
    scheduled_end TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(employee_id, work_date),
    CHECK (
      (is_work_day = 0 AND scheduled_start IS NULL AND scheduled_end IS NULL) OR
      (is_work_day = 1 AND scheduled_start IS NOT NULL AND scheduled_end IS NOT NULL AND scheduled_start <> scheduled_end)
    )
  );
  CREATE INDEX IF NOT EXISTS idx_weekly_schedules_date ON weekly_schedules(work_date, employee_id);
  CREATE TABLE IF NOT EXISTS bonuses (
    id INTEGER PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    effective_date TEXT NOT NULL,
    concept TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    constitutes_salary INTEGER NOT NULL DEFAULT 0 CHECK (constitutes_salary IN (0,1)),
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_bonuses_employee_date ON bonuses(employee_id, effective_date);
  CREATE TABLE IF NOT EXISTS manual_deductions (
    id INTEGER PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    effective_date TEXT NOT NULL,
    concept TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_manual_deductions_employee_date ON manual_deductions(employee_id, effective_date);
  CREATE TABLE IF NOT EXISTS legal_rules (
    id INTEGER PRIMARY KEY,
    effective_from TEXT NOT NULL UNIQUE,
    minimum_salary_cents INTEGER NOT NULL,
    transport_allowance_cents INTEGER NOT NULL,
    weekly_hours INTEGER NOT NULL,
    night_start_hour INTEGER NOT NULL,
    rest_day_surcharge REAL NOT NULL
  );
  CREATE TABLE IF NOT EXISTS payroll_runs (
    id INTEGER PRIMARY KEY,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'saved'
  );
  CREATE TABLE IF NOT EXISTS payroll_entries (
    id INTEGER PRIMARY KEY,
    payroll_run_id INTEGER NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
    employee_id INTEGER NOT NULL,
    snapshot_json TEXT NOT NULL,
    UNIQUE(payroll_run_id, employee_id)
  );
  CREATE TABLE IF NOT EXISTS admin_credential (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id INTEGER,
    detail TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
`);

const scheduleColumns = db.pragma('table_info(weekly_schedules)') as Array<{
  name: string;
}>;
if (!scheduleColumns.some((column) => column.name === 'is_rest_day')) {
  db.exec(
    `ALTER TABLE weekly_schedules ADD COLUMN is_rest_day INTEGER NOT NULL DEFAULT 0 CHECK (is_rest_day IN (0,1));`,
  );
  db.exec(
    `UPDATE weekly_schedules SET is_rest_day=1 WHERE strftime('%w', work_date)='0';`,
  );
}

const employeeColumns = db.pragma('table_info(employees)') as Array<{
  name: string;
}>;
if (!employeeColumns.some((column) => column.name === 'rest_day')) {
  db.exec(
    `ALTER TABLE employees ADD COLUMN rest_day INTEGER NOT NULL DEFAULT 7 CHECK (rest_day BETWEEN 1 AND 7);`,
  );
  // Conserva la última elección que hubiera hecho cada persona en el sistema
  // semanal anterior. Si nunca tuvo una, su descanso recurrente es el domingo.
  db.exec(`
    UPDATE employees
       SET rest_day = COALESCE((
         SELECT CASE strftime('%w', ws.work_date)
           WHEN '0' THEN 7 ELSE CAST(strftime('%w', ws.work_date) AS INTEGER)
         END
           FROM weekly_schedules ws
          WHERE ws.employee_id = employees.id AND ws.is_rest_day = 1
          ORDER BY ws.work_date DESC
          LIMIT 1
       ), 7);
  `);
}

// Una liquidación guardada tiene que sobrevivir al borrado del trabajador: su
// snapshot ya contiene nombre, código y montos, así que la referencia a
// employees solo estorbaba. Se reconstruye la tabla una sola vez.
const entriesReferenceEmployees = (
  db
    .prepare(
      `SELECT COUNT(*) total FROM pragma_foreign_key_list('payroll_entries') WHERE "table"='employees'`,
    )
    .get() as { total: number }
).total;
if (entriesReferenceEmployees > 0) {
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE payroll_entries_nuevo (
        id INTEGER PRIMARY KEY,
        payroll_run_id INTEGER NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
        employee_id INTEGER NOT NULL,
        snapshot_json TEXT NOT NULL,
        UNIQUE(payroll_run_id, employee_id)
      );
      INSERT INTO payroll_entries_nuevo (id,payroll_run_id,employee_id,snapshot_json)
        SELECT id,payroll_run_id,employee_id,snapshot_json FROM payroll_entries;
      DROP TABLE payroll_entries;
      ALTER TABLE payroll_entries_nuevo RENAME TO payroll_entries;
    `);
  })();
  db.pragma('foreign_keys = ON');
  const rotas = db.pragma('foreign_key_check') as unknown[];
  if (rotas.length > 0)
    throw new Error('La migración de liquidaciones dejó referencias rotas.');
}

const insertRule = db.prepare(`INSERT OR IGNORE INTO legal_rules
  (effective_from, minimum_salary_cents, transport_allowance_cents, weekly_hours, night_start_hour, rest_day_surcharge)
  VALUES (?, ?, ?, ?, ?, ?)`);
insertRule.run('2025-01-01', 142350000, 20000000, 44, 21, 0.75);
insertRule.run('2025-07-01', 142350000, 20000000, 44, 21, 0.8);
insertRule.run('2025-12-25', 142350000, 20000000, 44, 19, 0.8);
insertRule.run('2026-01-01', 175090500, 24909500, 44, 19, 0.8);
insertRule.run('2026-07-01', 175090500, 24909500, 44, 19, 0.9);
insertRule.run('2026-07-15', 175090500, 24909500, 42, 19, 0.9);
// No se precarga 2027 con el salario de 2026: sería silenciosamente incorrecto.
// El motor conoce el piso del recargo del 100% desde 2027-07-01, pero antes
// de liquidar ese año se deben cargar su SMLMV y auxilio oficiales.
db.prepare(`DELETE FROM legal_rules
  WHERE effective_from='2027-07-01' AND minimum_salary_cents=175090500
    AND transport_allowance_cents=24909500`).run();

export function audit(
  action: string,
  entityType: string,
  entityId: number | null,
  detail: unknown = '',
) {
  db.prepare(
    'INSERT INTO audit_log (action, entity_type, entity_id, detail, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(
    action,
    entityType,
    entityId,
    typeof detail === 'string' ? detail : JSON.stringify(detail),
    new Date().toISOString(),
  );
}

// La clave de administracion vive cifrada en la base, no en un archivo de
// configuracion: la define el usuario al entrar por primera vez y puede
// cambiarla desde el panel.
export function adminCredential() {
  return db
    .prepare('SELECT password_hash FROM admin_credential WHERE id = 1')
    .get() as { password_hash: string } | undefined;
}

export function setAdminPassword(password: string) {
  const timestamp = new Date().toISOString();
  db.prepare(
    `INSERT INTO admin_credential (id, password_hash, created_at, updated_at)
     VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET password_hash = excluded.password_hash,
     updated_at = excluded.updated_at`,
  ).run(bcrypt.hashSync(password, 12), timestamp, timestamp);
}

export function verifyPin(pin: string, hash: string) {
  return bcrypt.compareSync(pin, hash);
}

export function hashPin(pin: string) {
  return bcrypt.hashSync(pin, 10);
}

const legacyPassword = process.env.ADMIN_PASSWORD;
if (!adminCredential() && legacyPassword) {
  setAdminPassword(legacyPassword);
  audit('admin_password_migrated', 'session', null, 'desde la configuracion');
}

db.pragma('optimize');
