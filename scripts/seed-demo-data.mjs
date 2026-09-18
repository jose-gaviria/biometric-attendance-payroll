// Datos enteramente ficticios para exponer la instalación local.
// Ejecutar dentro del contenedor con cwd=/opt/turnos y el archivo por stdin.
// Se niega a escribir si cualquiera de las dos bases ya contiene datos de uso.
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { DateTime } from 'luxon';
import { calculatePayroll } from '/opt/turnos/dist-server/payroll.js';

const TZ = 'America/Bogota';
const turnos = new Database('/data/turnos/attendance-payroll.sqlite');
const facial = new Database('/data/face/face-lab.sqlite', { readonly: true });
turnos.pragma('foreign_keys = ON');

const count = (db, table) =>
  Number(db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total);
const occupiedTurnos = [
  'employees',
  'shifts',
  'weekly_schedules',
  'bonuses',
  'manual_deductions',
  'payroll_runs',
  'payroll_entries',
  'face_links',
].some((table) => count(turnos, table) > 0);
const occupiedFace = ['face_profiles', 'face_templates'].some(
  (table) => count(facial, table) > 0,
);
if (occupiedTurnos || occupiedFace)
  throw new Error('La semilla demo exige bases de uso vacías.');

const now = new Date().toISOString();
const salary = 175090500;
const employees = [
  {
    code: 'DEMO-001',
    name: 'Valentina Rojas',
    document: 'DEMO-1001',
    role: 'Cocina · enrolamiento facial',
    pin: '4101',
    days: [1, 2, 3, 4, 5, 6],
    start: '08:00',
    end: '15:00',
    rest: 7,
    transport: 1,
    active: 1,
  },
  {
    code: 'DEMO-002',
    name: 'Santiago Pérez',
    document: 'DEMO-1002',
    role: 'Caja',
    pin: '4102',
    days: [1, 2, 3, 4, 5, 6],
    start: '09:00',
    end: '16:00',
    rest: 7,
    transport: 1,
    active: 1,
  },
  {
    code: 'DEMO-003',
    name: 'Camila Gómez',
    document: 'DEMO-1003',
    role: 'Servicio',
    pin: '4103',
    days: [2, 3, 4, 5, 6, 7],
    start: '12:00',
    end: '20:00',
    rest: 1,
    transport: 1,
    active: 1,
  },
  {
    code: 'DEMO-004',
    name: 'Mateo Rodríguez',
    document: 'DEMO-1004',
    role: 'Domicilios',
    pin: '4104',
    days: [1, 2, 3, 4, 5, 6],
    start: '10:00',
    end: '18:00',
    rest: 7,
    transport: 1,
    active: 1,
  },
  {
    code: 'DEMO-005',
    name: 'Daniela Torres',
    document: 'DEMO-1005',
    role: 'Administración',
    pin: '4105',
    days: [1, 2, 3, 4, 5],
    start: '08:00',
    end: '17:00',
    rest: 7,
    transport: 0,
    active: 1,
  },
  {
    code: 'DEMO-006',
    name: 'Nicolás Herrera',
    document: 'DEMO-1006',
    role: 'Auxiliar de producción',
    pin: '4106',
    days: [1, 2, 3, 4, 5, 6],
    start: '06:00',
    end: '13:00',
    rest: 7,
    transport: 1,
    active: 1,
  },
  {
    code: 'DEMO-007',
    name: 'Lucía Martínez',
    document: 'DEMO-1007',
    role: 'Trabajadora inactiva',
    pin: '4107',
    days: [1, 2, 3, 4, 5],
    start: '08:00',
    end: '17:00',
    rest: 7,
    transport: 1,
    active: 0,
  },
];

const localToUtc = (date, time) =>
  DateTime.fromISO(`${date}T${time}`, { zone: TZ }).toUTC().toISO();
const dateRange = (start, end) => {
  const dates = [];
  for (
    let day = DateTime.fromISO(start, { zone: TZ });
    day <= DateTime.fromISO(end, { zone: TZ });
    day = day.plus({ days: 1 })
  )
    dates.push(day.toISODate());
  return dates;
};

const seed = turnos.transaction(() => {
  const addEmployee = turnos.prepare(`
    INSERT INTO employees
      (id,code,name,document,role,monthly_salary_cents,transport_eligible,
       pin_hash,work_days,scheduled_start,scheduled_end,rest_day,active,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  employees.forEach((employee, index) =>
    addEmployee.run(
      index + 1,
      employee.code,
      employee.name,
      employee.document,
      employee.role,
      salary,
      employee.transport,
      bcrypt.hashSync(employee.pin, 10),
      employee.days.join(','),
      employee.start,
      employee.end,
      employee.rest,
      employee.active,
      now,
      now,
    ),
  );

  const addShift = turnos.prepare(`
    INSERT INTO shifts
      (employee_id,clock_in,clock_out,source,note,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?)`);
  const sources = ['face', 'kiosk', 'admin'];
  for (const date of dateRange('2026-08-17', '2026-09-13')) {
    const weekday = DateTime.fromISO(date, { zone: TZ }).weekday;
    for (let index = 0; index < 6; index++) {
      const employee = employees[index];
      if (!employee.days.includes(weekday)) continue;
      let start = employee.start;
      let end = employee.end;
      if (employee.code === 'DEMO-001' && date === '2026-09-05') {
        start = '07:00';
        end = '18:00';
      } else if (employee.code === 'DEMO-002' && date === '2026-09-11') {
        start = '17:00';
        end = '23:00';
      } else if (employee.code === 'DEMO-003' && weekday === 7) {
        start = '12:00';
        end = '21:00';
      } else if (employee.code === 'DEMO-004' && date === '2026-09-07') {
        end = '20:00';
      } else if (employee.code === 'DEMO-006' && date === '2026-09-04') {
        start = '05:00';
        end = '14:00';
      }
      addShift.run(
        index + 1,
        localToUtc(date, start),
        localToUtc(date, end),
        sources[(index + weekday) % sources.length],
        'Dato ficticio de demostración',
        now,
        now,
      );
    }
  }
  addShift.run(
    4,
    localToUtc('2026-09-13', '11:00'),
    localToUtc('2026-09-13', '22:00'),
    'admin',
    'Descanso trabajado con recargos de demostración',
    now,
    now,
  );
  addShift.run(
    3,
    localToUtc('2026-09-07', '11:00'),
    localToUtc('2026-09-07', '22:00'),
    'admin',
    'Descanso trabajado al inicio de semana',
    now,
    now,
  );

  const addBonus = turnos.prepare(`
    INSERT INTO bonuses
      (employee_id,effective_date,concept,amount_cents,constitutes_salary,
       note,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?)`);
  [
    [1, '2026-09-10', 'Reconocimiento por desempeño', 15000000, 0],
    [2, '2026-09-12', 'Comisión de ventas', 9000000, 1],
    [3, '2026-09-06', 'Bonificación dominical', 7000000, 1],
    [4, '2026-08-28', 'Apoyo ocasional', 8000000, 0],
    [6, '2026-09-08', 'Meta de producción', 11000000, 1],
  ].forEach(([employeeId, date, concept, amount, salaryBonus]) =>
    addBonus.run(
      employeeId,
      date,
      concept,
      amount,
      salaryBonus,
      'Ejemplo para la exposición',
      now,
      now,
    ),
  );

  const addDeduction = turnos.prepare(`
    INSERT INTO manual_deductions
      (employee_id,effective_date,concept,amount_cents,note,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?)`);
  [
    [1, '2026-09-13', 'Anticipo autorizado', 7500000],
    [3, '2026-09-10', 'Cuota de préstamo', 12000000],
    [5, '2026-09-14', 'Descuento autorizado', 4500000],
  ].forEach(([employeeId, date, concept, amount]) =>
    addDeduction.run(
      employeeId,
      date,
      concept,
      amount,
      'Dato ficticio de demostración',
      now,
      now,
    ),
  );
});
seed();

const rules = turnos
  .prepare(`SELECT effective_from,minimum_salary_cents,transport_allowance_cents,
                   weekly_hours,night_start_hour,rest_day_surcharge
            FROM legal_rules ORDER BY effective_from`)
  .all();
const activeEmployees = turnos
  .prepare('SELECT * FROM employees WHERE active=1 ORDER BY name')
  .all();

function buildPeriod(startDate, endDate) {
  const start = DateTime.fromISO(startDate, { zone: TZ });
  const monthStart = start.startOf('month').toISODate();
  const monthEnd = start.endOf('month').toISODate();
  return activeEmployees.map((employee) => {
    const shifts = turnos
      .prepare(
        'SELECT clock_in,clock_out FROM shifts WHERE employee_id=? AND clock_out IS NOT NULL ORDER BY clock_in',
      )
      .all(employee.id);
    const monthlyBonuses = turnos
      .prepare(
        'SELECT id,effective_date,concept,amount_cents,constitutes_salary FROM bonuses WHERE employee_id=? AND effective_date BETWEEN ? AND ? ORDER BY effective_date,id',
      )
      .all(employee.id, monthStart, monthEnd);
    const monthly = calculatePayroll(
      employee,
      shifts,
      rules,
      monthStart,
      monthEnd,
      [],
      monthlyBonuses,
    );
    const periodBonuses = monthlyBonuses.filter(
      (bonus) =>
        bonus.effective_date >= startDate && bonus.effective_date <= endDate,
    );
    const deductions = turnos
      .prepare(
        'SELECT id,concept,amount_cents FROM manual_deductions WHERE employee_id=? AND effective_date BETWEEN ? AND ? ORDER BY effective_date,id',
      )
      .all(employee.id, startDate, endDate);
    return calculatePayroll(
      employee,
      shifts,
      rules,
      startDate,
      endDate,
      [],
      periodBonuses,
      {
        ibc_cents: monthly.ibc_cents,
        salary_earnings_cents: monthly.salary_earnings_cents,
      },
      deductions,
    );
  });
}

const savePayroll = turnos.transaction((startDate, endDate) => {
  const result = turnos
    .prepare(
      "INSERT INTO payroll_runs(start_date,end_date,created_at,status) VALUES (?,?,?,'saved')",
    )
    .run(startDate, endDate, now);
  const runId = Number(result.lastInsertRowid);
  const insert = turnos.prepare(
    'INSERT INTO payroll_entries(payroll_run_id,employee_id,snapshot_json) VALUES (?,?,?)',
  );
  for (const entry of buildPeriod(startDate, endDate))
    insert.run(runId, entry.employee_id, JSON.stringify(entry));
  return runId;
});
savePayroll('2026-08-16', '2026-08-31');
savePayroll('2026-09-01', '2026-09-15');

// Un turno abierto alimenta Resumen y permite mostrar la salida pendiente.
const liveStart = DateTime.now().setZone(TZ).minus({ minutes: 95 });
turnos
  .prepare(`
    INSERT INTO shifts
      (employee_id,clock_in,clock_out,source,note,created_at,updated_at)
    VALUES (1,?,NULL,'face','Turno abierto de demostración',?,?)`)
  .run(liveStart.toUTC().toISO(), now, now);

turnos
  .prepare(
    "INSERT INTO audit_log(action,entity_type,entity_id,detail,created_at) VALUES ('demo_data_loaded','system',NULL,?,?)",
  )
  .run(
    JSON.stringify({ synthetic: true, employees: employees.length }),
    now,
  );

turnos.pragma('wal_checkpoint(TRUNCATE)');
facial.close();
const summary = Object.fromEntries(
  [
    'employees',
    'shifts',
    'weekly_schedules',
    'bonuses',
    'manual_deductions',
    'payroll_runs',
    'payroll_entries',
    'face_links',
  ].map((table) => [table, count(turnos, table)]),
);
turnos.close();
console.log(JSON.stringify({ status: 'DEMO_DATA_READY', ...summary }));
