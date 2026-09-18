import { FaceAdmin, FaceKiosk } from './face/Face';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type SyntheticEvent,
} from 'react';
import {
  Banknote,
  ArrowUpRight,
  ScanFace,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  KeyRound,
  Download,
  LogIn,
  LogOut,
  Plus,
  RefreshCw,
  Settings,
  FileText,
  ShieldCheck,
  Trash2,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';

type Employee = {
  id: number;
  code: string;
  name: string;
  document: string;
  role: string;
  monthly_salary_cents: number;
  transport_eligible: number;
  rest_day: number;
  active: number;
};
type Shift = {
  id: number;
  employee_id: number;
  employee_name: string;
  employee_code: string;
  clock_in: string;
  clock_out: string | null;
  source: string;
  note: string;
};
type Breakdown = {
  category: string;
  label: string;
  minutes: number;
  hours: number;
  amount_cents: number;
  rate_multiplier: number;
};
type Deduction = {
  category: string;
  label: string;
  rate: number;
  amount_cents: number;
};
type PayrollEntry = {
  employee_id: number;
  employee_name: string;
  employee_code: string;
  worked_hours: number;
  worked_days: number;
  calculated_days?: number;
  base_salary_cents: number;
  transport_cents: number;
  extras_cents: number;
  ibc_cents?: number;
  gross_total_cents?: number;
  health_deduction_cents?: number;
  pension_deduction_cents?: number;
  solidarity_deduction_cents?: number;
  total_deductions_cents?: number;
  net_total_cents?: number;
  total_cents: number;
  bonuses?: BonusLine[];
  bonus_total_cents?: number;
  bonus_salary_cents?: number;
  bonus_non_salary_cents?: number;
  non_salary_excess_cents?: number;
  breakdown: Breakdown[];
  deductions?: Deduction[];
  compliance_alerts?: Array<{ code: string; label: string; detail: string }>;
};
type DeletionImpact = {
  id: number;
  name: string;
  shifts: number;
  open_shifts: number;
  weekly_schedules: number;
  bonuses: number;
  manual_deductions: number;
  face_links: number;
  payroll_entries: number;
  can_delete: boolean;
};
type BonusLine = {
  id?: number;
  concept: string;
  amount_cents: number;
  constitutes_salary: boolean;
};
type Bonus = {
  id: number;
  employee_id: number;
  employee_name: string;
  effective_date: string;
  concept: string;
  amount_cents: number;
  constitutes_salary: boolean;
  note: string;
};
type ManualDeduction = {
  id: number;
  employee_id: number;
  employee_name: string;
  effective_date: string;
  concept: string;
  amount_cents: number;
  note: string;
};
type LegalRule = {
  id: number;
  effective_from: string;
  minimum_salary_cents: number;
  transport_allowance_cents: number;
  weekly_hours: number;
  night_start_hour: number;
  rest_day_surcharge: number;
};
type DashboardData = {
  stats: { activeEmployees: number; openShifts: number; entriesToday: number };
  recent: Shift[];
};
type Tab =
  | 'rostros'
  | 'resumen'
  | 'equipo'
  | 'turnos'
  | 'liquidacion'
  | 'configuracion';
type ClockResponse = {
  action: 'in' | 'out';
  employee: string;
  timestamp: string;
  minutes?: number;
};
type KioskEmployee = {
  id: number;
  name: string;
  role: string;
  is_clocked_in: number;
};
type ClockAction = 'in' | 'out';
type EmployeeForm = {
  code: string;
  name: string;
  document: string;
  role: string;
  monthly_salary: number;
  transport_eligible: boolean;
  pin: string;
  rest_day: number;
  active: boolean;
};
type ShiftForm = {
  employee_id: number | string;
  clock_in: string;
  clock_out: string;
  note: string;
};
type LegalRuleForm = {
  effective_from: string;
  minimum_salary: number;
  transport_allowance: number;
  weekly_hours: number;
  night_start_hour: number;
  rest_day_surcharge: number;
};
type PayrollRun = {
  id: number;
  start_date: string;
  end_date: string;
  created_at: string;
  employees: number;
  total_cents: number;
};
const currency = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});
const dateTime = new Intl.DateTimeFormat('es-CO', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/Bogota',
});
const today = new Date();
const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const halfStart =
  today.getDate() <= 15
    ? new Date(today.getFullYear(), today.getMonth(), 1)
    : new Date(today.getFullYear(), today.getMonth(), 16);
const halfEnd =
  today.getDate() <= 15
    ? new Date(today.getFullYear(), today.getMonth(), 15)
    : new Date(today.getFullYear(), today.getMonth() + 1, 0);

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  headers.set('Content-Type', 'application/json');
  const response = await fetch(url, {
    ...options,
    headers,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(data.error || 'No fue posible completar la acción.');
  return data;
}

function Logo() {
  return (
    <div className="brand">
      <span>
        <strong>Biometric Attendance & Payroll</strong>
        <small>Turnos y nómina</small>
      </span>
    </div>
  );
}

function Kiosk({ onAdmin }: { onAdmin: () => void }) {
  const [fallback, setFallback] = useState<{
    action: 'in' | 'out';
    expires_at: number | null;
  } | null>(null);
  const [faceAction, setFaceAction] = useState<'in' | 'out' | null>(null);
  const [employees, setEmployees] = useState<KioskEmployee[]>([]);
  const [pending, setPending] = useState<{
    employee: KioskEmployee;
    action: ClockAction;
  } | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ClockResponse | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(() => setResult(null), 5000);
    return () => clearTimeout(timer);
  }, [result]);
  useEffect(() => {
    if (!fallback?.expires_at) return;
    const timer = setTimeout(
      () => {
        setFallback(null);
        setPending(null);
        setPin('');
      },
      Math.max(0, fallback.expires_at - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [fallback]);
  function success(data: ClockResponse) {
    setFaceAction(null);
    setFallback(null);
    setPending(null);
    setPin('');
    setError('');
    setResult(data);
    void loadEmployees();
  }

  async function loadEmployees() {
    try {
      setEmployees(await api<KioskEmployee[]>('/api/kiosk/employees'));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    void api<KioskEmployee[]>('/api/kiosk/employees')
      .then(setEmployees)
      .catch((e: Error) => setError(e.message));
  }, []);

  function choose(employee: KioskEmployee, action: ClockAction) {
    setPending({ employee, action });
    setPin('');
    setError('');
    setResult(null);
  }

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pending) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const data = await api<ClockResponse>('/api/clock', {
        method: 'POST',
        body: JSON.stringify({
          employee_id: pending.employee.id,
          action: pending.action,
          pin,
        }),
      });
      success(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="kiosk-page production-kiosk">
      <header className="kiosk-header">
        <Logo />
        <button className="quiet-button" onClick={onAdmin}>
          <ShieldCheck size={18} /> Administración
        </button>
      </header>
      {faceAction ? (
        <FaceKiosk
          action={faceAction}
          onSuccess={success}
          onFallback={(state) => {
            setFallback(state);
            setFaceAction(null);
            void loadEmployees();
          }}
          onClose={() => {
            setFaceAction(null);
            void loadEmployees();
          }}
        />
      ) : null}
      {result && (
        <output className="attendance-success-backdrop" aria-live="polite">
          <div className="attendance-success-card">
            <div className="attendance-success-check">
              <Check size={48} strokeWidth={3} />
            </div>
            <span className="eyebrow">REGISTRO EXITOSO</span>
            <h2>
              {result.action === 'in'
                ? '¡Entrada registrada!'
                : '¡Salida registrada!'}
            </h2>
            <p className="attendance-person">{result.employee}</p>
            <p>{dateTime.format(new Date(result.timestamp))}</p>
            <button className="quiet-button" onClick={() => setResult(null)}>
              Continuar
            </button>
            <small>Esta confirmación se cierra automáticamente.</small>
          </div>
        </output>
      )}
      <section className="kiosk-shell" hidden={!!faceAction}>
        <div className="terminal-heading">
          <div>
            <span className="eyebrow">CONTROL DE ASISTENCIA</span>
            <h1>Marcar turno</h1>
          </div>
          <span className="terminal-method">
            <ScanFace size={18} aria-hidden="true" /> Reconocimiento facial
          </span>
        </div>
        <LiveClock />
        {fallback ? (
          <section className="clock-card worker-picker">
            <div className="worker-picker-head">
              <div className="card-icon">
                <Users size={28} />
              </div>
              <div>
                <h2>
                  PIN habilitado para tu{' '}
                  {fallback.action === 'in' ? 'entrada' : 'salida'}
                </h2>
                <p>
                  No se pudo identificar el rostro en tres intentos. Selecciona
                  tu nombre.
                </p>
                <button
                  className="quiet-button"
                  onClick={() => {
                    setFallback(null);
                    setPending(null);
                    setPin('');
                    void api('/api/face/fallback', { method: 'DELETE' }).catch(
                      (e: Error) => setError(e.message),
                    );
                  }}
                >
                  Volver a cámara
                </button>
              </div>
            </div>
            {error && (
              <div className="message error">
                <X size={18} />
                {error}
              </div>
            )}
            {result && (
              <div className="message success">
                <Check size={20} />
                <div>
                  <strong>
                    {result.action === 'in'
                      ? 'Entrada registrada'
                      : 'Salida registrada'}
                  </strong>
                  <span>
                    {result.employee} ·{' '}
                    {dateTime.format(new Date(result.timestamp))}
                    {result.minutes != null
                      ? ` · ${Math.floor(result.minutes / 60)} h ${result.minutes % 60} min`
                      : ''}
                  </span>
                </div>
              </div>
            )}
            <div className="worker-list">
              {employees.length === 0 && !error && (
                <div className="empty">No hay trabajadores activos.</div>
              )}
              {employees.map((employee) => (
                <article className="worker-row" key={employee.id}>
                  <div className="worker-identity">
                    <span className="avatar" aria-hidden="true">
                      {employee.name.charAt(0)}
                    </span>
                    <span>
                      <strong>{employee.name}</strong>
                      <small>
                        {employee.role} ·{' '}
                        {employee.is_clocked_in
                          ? 'Trabajando'
                          : 'Sin turno abierto'}
                      </small>
                    </span>
                  </div>
                  <div className="worker-actions">
                    <button
                      type="button"
                      className="shift-action entry"
                      hidden={fallback.action !== 'in'}
                      disabled={busy || Boolean(employee.is_clocked_in)}
                      onClick={() => choose(employee, 'in')}
                    >
                      <LogIn size={18} /> Entrada
                    </button>
                    <button
                      type="button"
                      className="shift-action exit"
                      hidden={fallback.action !== 'out'}
                      disabled={busy || !employee.is_clocked_in}
                      onClick={() => choose(employee, 'out')}
                    >
                      <LogOut size={18} /> Salida
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : (
          <>
            <div className="terminal-actions">
              <button
                className="terminal-action terminal-entry"
                onClick={() => setFaceAction('in')}
                aria-label="Registrar entrada"
              >
                <span className="terminal-action-top">
                  <span className="terminal-action-icon">
                    <LogIn size={32} aria-hidden="true" />
                  </span>
                  <ArrowUpRight size={25} aria-hidden="true" />
                </span>
                <span className="terminal-action-name">Entrada</span>
                <span className="terminal-action-detail">Iniciar jornada</span>
                <span className="terminal-action-bottom">
                  <ScanFace size={19} aria-hidden="true" /> Abrir cámara
                </span>
              </button>
              <button
                className="terminal-action terminal-exit"
                onClick={() => setFaceAction('out')}
                aria-label="Registrar salida"
              >
                <span className="terminal-action-top">
                  <span className="terminal-action-icon">
                    <LogOut size={32} aria-hidden="true" />
                  </span>
                  <ArrowUpRight size={25} aria-hidden="true" />
                </span>
                <span className="terminal-action-name">Salida</span>
                <span className="terminal-action-detail">
                  Finalizar jornada
                </span>
                <span className="terminal-action-bottom">
                  <ScanFace size={19} aria-hidden="true" /> Abrir cámara
                </span>
              </button>
            </div>
            {error ? (
              <p className="message error" role="alert">
                {error}
              </p>
            ) : null}
            <p className="terminal-hint">
              Selecciona una opción y mira al frente de la cámara.
            </p>
          </>
        )}
      </section>
      {pending && (
        <Modal
          title={`Confirmar ${pending.action === 'in' ? 'entrada' : 'salida'}`}
          onClose={() => {
            if (!busy) setPending(null);
          }}
        >
          <form className="pin-confirm" onSubmit={submit}>
            <div className="pin-worker">
              <span className="avatar" aria-hidden="true">
                {pending.employee.name.charAt(0)}
              </span>
              <span>
                <strong>{pending.employee.name}</strong>
                <small>{pending.employee.role}</small>
              </span>
            </div>
            <label>
              PIN personal
              <input
                value={pin}
                onChange={(e) =>
                  setPin(e.target.value.replace(/\D/g, '').slice(0, 8))
                }
                type="password"
                inputMode="numeric"
                autoComplete="off"
                placeholder="••••"
              />
            </label>
            {error && <div className="message error">{error}</div>}
            <div className="form-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => setPending(null)}
              >
                Cancelar
              </button>
              <button
                className={`primary-button ${pending.action === 'out' ? 'exit-confirm' : ''}`}
                disabled={busy || pin.length < 4}
              >
                {busy ? (
                  <RefreshCw className="spin" size={18} />
                ) : pending.action === 'in' ? (
                  <LogIn size={18} />
                ) : (
                  <LogOut size={18} />
                )}
                {busy
                  ? 'Registrando…'
                  : `Registrar ${pending.action === 'in' ? 'entrada' : 'salida'}`}
              </button>
            </div>
          </form>
        </Modal>
      )}
      <footer className="kiosk-footer">
        <span>Biometric Attendance & Payroll · Registro de asistencia</span>
        <span>Colombia · UTC−5</span>
      </footer>
    </main>
  );
}

function LiveClock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="terminal-clock">
      <span className="terminal-date">
        {time.toLocaleDateString('es-CO', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          timeZone: 'America/Bogota',
        })}
      </span>
      <time dateTime={time.toISOString()}>
        {time.toLocaleTimeString('es-CO', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          timeZone: 'America/Bogota',
          hour12: false,
        })}
      </time>
    </div>
  );
}

// Primera entrada del equipo: no hay clave todavia y quien llega la define.
function PrimeraClave({
  onSuccess,
  onBack,
}: {
  onSuccess: () => void;
  onBack?: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/admin/password/setup', {
        method: 'POST',
        body: JSON.stringify({ password, confirm }),
      });
      onSuccess();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <div className="login-card">
        <Logo />
        <span className="eyebrow">Primera entrada</span>
        <h1>Define tu clave</h1>
        <p>
          Este equipo todavía no tiene clave de administración. La que escribas
          aquí será la que uses siempre para entrar. Anótala: no hay forma de
          recuperarla después.
        </p>
        <form onSubmit={submit}>
          <label>
            Clave de administración
            <input
              type="password"
              autoComplete="new-password"
              minLength={10}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label>
            Repite la clave
            <input
              type="password"
              autoComplete="new-password"
              minLength={10}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
          <p className="formula-note">Mínimo 10 caracteres.</p>
          {error && (
            <div className="message error">
              <X size={17} />
              {error}
            </div>
          )}
          <button className="primary-button" disabled={busy}>
            Guardar y entrar
          </button>
          {onBack && (
            <button type="button" className="text-button" onClick={onBack}>
              Volver a marcación
            </button>
          )}
        </form>
      </div>
    </main>
  );
}

function Login({
  onSuccess,
  onBack,
}: {
  onSuccess: () => void;
  onBack?: () => void;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      onSuccess();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <div className="login-card">
        <Logo />
        <span className="eyebrow">Acceso protegido</span>
        <h1>Administración</h1>
        <form onSubmit={submit}>
          <label>
            Clave de administración
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <div className="message error">
              <X size={17} />
              {error}
            </div>
          )}
          <button className="primary-button" disabled={busy}>
            Entrar
          </button>
          {onBack && (
            <button type="button" className="text-button" onClick={onBack}>
              Volver a marcación
            </button>
          )}
        </form>
      </div>
    </main>
  );
}

// Cambiar la clave exige la actual. Al hacerlo, cualquier sesion abierta en
// otro equipo deja de valer, porque la cookie se deriva de la clave vigente.
function CambiarClave({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ current: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [listo, setListo] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/admin/password', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setListo(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Cambiar clave de administración" onClose={onClose}>
      {listo ? (
        <div className="form-grid">
          <div className="message success full">
            <strong>Clave cambiada.</strong>
            <span>
              Úsala la próxima vez que entres. Si habías dejado la sesión
              abierta en otro equipo, ahí tendrá que entrar de nuevo.
            </span>
          </div>
          <div className="form-actions full">
            <button type="button" className="primary-button" onClick={onClose}>
              Entendido
            </button>
          </div>
        </div>
      ) : (
        <form className="form-grid" onSubmit={submit}>
          <label className="full">
            Clave actual
            <input
              type="password"
              autoComplete="current-password"
              required
              value={form.current}
              onChange={(e) => setForm({ ...form, current: e.target.value })}
            />
          </label>
          <label className="full">
            Clave nueva
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </label>
          <label className="full">
            Repite la clave nueva
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              value={form.confirm}
              onChange={(e) => setForm({ ...form, confirm: e.target.value })}
            />
          </label>
          <p className="formula-note full">
            Mínimo 10 caracteres. Anótala: no hay forma de recuperarla.
          </p>
          {error && (
            <div className="message error full">
              <X size={17} />
              {error}
            </div>
          )}
          <div className="form-actions full">
            <button
              type="button"
              className="secondary-button"
              onClick={onClose}
            >
              Cancelar
            </button>
            <button className="primary-button" disabled={busy}>
              Guardar clave nueva
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

const navItems: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: 'resumen', label: 'Resumen', icon: CalendarDays },
  { id: 'equipo', label: 'Trabajadores', icon: Users },
  { id: 'rostros', label: 'Rostros', icon: ShieldCheck },
  { id: 'turnos', label: 'Turnos', icon: Clock3 },
  { id: 'liquidacion', label: 'Liquidación', icon: Banknote },
  { id: 'configuracion', label: 'Reglas legales', icon: Settings },
];

function Admin({ onExit }: { onExit: () => void }) {
  const [tab, setTab] = useState<Tab>('resumen');
  const [cambiarClave, setCambiarClave] = useState(false);
  async function logout() {
    await api('/api/admin/logout', { method: 'POST' });
    onExit();
  }
  return (
    <div className="admin-layout">
      <aside className="sidebar">
        <Logo />
        <nav>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={tab === item.id ? 'active' : ''}
                onClick={() => setTab(item.id)}
              >
                <Icon size={19} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <button
          className="logout cambiar-clave"
          onClick={() => setCambiarClave(true)}
        >
          <KeyRound size={18} />
          Cambiar clave
        </button>
        <button className="logout" onClick={logout}>
          <LogOut size={18} />
          Salir
        </button>
      </aside>
      {cambiarClave && <CambiarClave onClose={() => setCambiarClave(false)} />}
      <main className="admin-main">
        <div className="mobile-admin-nav">
          <Logo />
          <select value={tab} onChange={(e) => setTab(e.target.value as Tab)}>
            {navItems.map((i) => (
              <option value={i.id} key={i.id}>
                {i.label}
              </option>
            ))}
          </select>
        </div>
        {tab === 'resumen' && <Dashboard onGo={setTab} />}{' '}
        {tab === 'equipo' && <Employees />}
        {tab === 'rostros' && <FaceAdmin />}
        {tab === 'turnos' && <Shifts />}
        {tab === 'liquidacion' && <Payroll />}
        {tab === 'configuracion' && <LegalRules />}
      </main>
    </div>
  );
}

function PageHead({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="page-head">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </header>
  );
}

function Dashboard({ onGo }: { onGo: (tab: Tab) => void }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(
    () =>
      api<DashboardData>('/api/admin/dashboard')
        .then(setData)
        .catch((e) => setError(e.message)),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <>
      <PageHead
        eyebrow="Hoy en el restaurante"
        title="Resumen de jornada"
        description="Entradas, salidas y turnos abiertos en tiempo real."
        action={
          <button className="secondary-button" onClick={load}>
            <RefreshCw size={17} />
            Actualizar
          </button>
        }
      />
      {error && <div className="message error">{error}</div>}
      <section className="stat-grid">
        <Stat
          label="Trabajadores activos"
          value={data?.stats.activeEmployees ?? '—'}
          icon={<Users />}
        />
        <Stat
          label="Entradas de hoy"
          value={data?.stats.entriesToday ?? '—'}
          icon={<LogIn />}
        />
        <Stat
          label="Trabajando ahora"
          value={data?.stats.openShifts ?? '—'}
          icon={<Clock3 />}
          accent
        />
      </section>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Movimientos recientes</h2>
            <p>Últimas marcaciones registradas.</p>
          </div>
          <button className="text-button" onClick={() => onGo('turnos')}>
            Ver todos →
          </button>
        </div>
        <ShiftTable rows={data?.recent ?? []} />
      </section>
    </>
  );
}
function Stat({
  label,
  value,
  icon,
  accent = false,
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className={'stat ' + (accent ? 'accent' : '')}>
      <span className="stat-icon">{icon}</span>
      <strong>{value}</strong>
      <p>{label}</p>
    </div>
  );
}

const emptyEmployee = {
  code: '',
  name: '',
  document: '',
  role: 'Operario',
  monthly_salary: 1750905,
  transport_eligible: true,
  pin: '',
  rest_day: 7,
  active: true,
};
const weekdayNames = [
  '',
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
  'domingo',
];
function Employees() {
  const [rows, setRows] = useState<Employee[]>([]);
  const [currentMinimum, setCurrentMinimum] = useState(1750905);
  const [open, setOpen] = useState(false);
  const [impact, setImpact] = useState<DeletionImpact | null>(null);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [form, setForm] = useState<EmployeeForm>(emptyEmployee);
  const [error, setError] = useState('');
  const load = useCallback(
    () =>
      Promise.all([
        api<Employee[]>('/api/admin/employees'),
        api<LegalRule[]>('/api/admin/legal-rules'),
      ]).then(([employees, rules]) => {
        setRows(employees);
        const current = rules
          .filter((rule) => rule.effective_from <= isoDay(new Date()))
          .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
        if (current) setCurrentMinimum(current.minimum_salary_cents / 100);
      }),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  function startEdit(row?: Employee) {
    setEditing(row ?? null);
    setForm(
      row
        ? {
            code: row.code,
            name: row.name,
            document: row.document,
            role: row.role,
            monthly_salary: currentMinimum,
            transport_eligible: Boolean(row.transport_eligible),
            pin: '',
            rest_day: row.rest_day,
            active: Boolean(row.active),
          }
        : { ...emptyEmployee, monthly_salary: currentMinimum },
    );
    setOpen(true);
    setImpact(null);
    setError('');
  }
  async function save(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    try {
      await api(
        editing ? `/api/admin/employees/${editing.id}` : '/api/admin/employees',
        { method: editing ? 'PUT' : 'POST', body: JSON.stringify(form) },
      );
      setOpen(false);
      void load();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function askDelete() {
    if (!editing) return;
    setError('');
    try {
      setImpact(
        await api<DeletionImpact>(
          `/api/admin/employees/${editing.id}/deletion`,
        ),
      );
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function confirmDelete() {
    if (!editing) return;
    setError('');
    try {
      await api(`/api/admin/employees/${editing.id}`, { method: 'DELETE' });
      setImpact(null);
      setOpen(false);
      void load();
    } catch (err) {
      setError((err as Error).message);
      setImpact(null);
    }
  }
  return (
    <>
      <PageHead
        eyebrow="Equipo"
        title="Trabajadores"
        description="Configura los datos laborales y el acceso de marcación."
        action={
          <button className="primary-button" onClick={() => startEdit()}>
            <Plus size={18} />
            Nuevo trabajador
          </button>
        }
      />
      <section className="cards-list">
        {rows.map((row) => (
          <button
            className="employee-card"
            key={row.id}
            onClick={() => startEdit(row)}
          >
            <span className="avatar">
              {row.name
                .split(' ')
                .map((x) => x[0])
                .slice(0, 2)
                .join('')}
            </span>
            <span className="employee-info">
              <strong>{row.name}</strong>
              <small>
                {row.code} · {row.role}
              </small>
            </span>
            <span className="employee-schedule">
              <strong>7 h ordinarias al día</strong>
              <small>Descansa el {weekdayNames[row.rest_day]}</small>
            </span>
            <span className={'status ' + (row.active ? 'ok' : 'off')}>
              {row.active ? 'Activo' : 'Inactivo'}
            </span>
          </button>
        ))}
      </section>
      {open && (
        <Modal
          title={editing ? 'Editar trabajador' : 'Nuevo trabajador'}
          onClose={() => setOpen(false)}
        >
          <form className="form-grid" onSubmit={save}>
            <label>
              Nombre completo
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label>
              Código para marcar
              <input
                value={form.code}
                onChange={(e) =>
                  setForm({ ...form, code: e.target.value.toUpperCase() })
                }
              />
            </label>
            <label>
              Documento
              <input
                value={form.document}
                onChange={(e) => setForm({ ...form, document: e.target.value })}
              />
            </label>
            <label>
              Cargo
              <input
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
              />
            </label>
            <label>
              Salario mínimo mensual vigente
              <input type="number" value={form.monthly_salary} readOnly />
              <small>
                Se actualiza desde Reglas legales y aplica igual a todo el
                equipo.
              </small>
            </label>
            <label>
              Día de descanso semanal
              <select
                value={form.rest_day}
                onChange={(e) =>
                  setForm({ ...form, rest_day: Number(e.target.value) })
                }
              >
                {weekdayNames.slice(1).map((name, index) => (
                  <option value={index + 1} key={name}>
                    {name[0].toUpperCase() + name.slice(1)}
                  </option>
                ))}
              </select>
              <small>
                Se repite cada semana. Si trabaja ese día, se aplica el recargo
                de descanso.
              </small>
            </label>
            <label>
              {editing
                ? 'Nuevo PIN (déjalo vacío para conservarlo)'
                : 'PIN de 4 a 8 números'}
              <input
                type="password"
                inputMode="numeric"
                value={form.pin}
                onChange={(e) =>
                  setForm({
                    ...form,
                    pin: e.target.value.replace(/\D/g, '').slice(0, 8),
                  })
                }
              />
            </label>
            <label className="check full">
              <input
                type="checkbox"
                checked={form.transport_eligible}
                onChange={(e) =>
                  setForm({ ...form, transport_eligible: e.target.checked })
                }
              />
              Recibe auxilio de transporte
            </label>
            <label className="check full">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />
              Trabajador activo
            </label>
            <p className="formula-note full">
              No necesitas crear horarios semanales: en cada día trabajado, las
              primeras 7 horas son ordinarias y el tiempo adicional se cuenta
              automáticamente como extra.
            </p>
            {error && <div className="message error full">{error}</div>}
            {impact && (
              <div className="delete-confirm full">
                <strong>¿Eliminar a {impact.name}?</strong>
                <p>
                  Se borra para siempre de la base de datos, junto con{' '}
                  {impact.shifts} turno(s) registrado(s),{' '}
                  {impact.weekly_schedules} registro(s) histórico(s) de horario,
                  {impact.bonuses} bonificación(es) y {impact.manual_deductions}{' '}
                  deducción(es).
                  {impact.open_shifts > 0 &&
                    ' Tiene una entrada sin salida que también se borrará.'}
                  {impact.face_links > 0 &&
                    ' Su rostro registrado también se borra del reconocimiento facial.'}
                </p>
                {impact.payroll_entries > 0 && (
                  <p>
                    Sus {impact.payroll_entries} liquidación(es) guardada(s) se
                    conservan con su nombre y sus montos, y caducan solas como
                    todas las demás.
                  </p>
                )}
                <p className="delete-alternative">
                  Si solo quieres que deje de aparecer en el kiosco, desmarca
                  «Trabajador activo» y guarda: conserva su historial completo.
                </p>
                <div className="form-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setImpact(null)}
                  >
                    Conservar
                  </button>
                  <button
                    type="button"
                    className="danger-button"
                    onClick={() => void confirmDelete()}
                  >
                    <Trash2 size={17} />
                    Sí, eliminar
                  </button>
                </div>
              </div>
            )}
            <div className="form-actions full">
              {editing && !impact && (
                <button
                  type="button"
                  className="text-button danger-text"
                  onClick={() => void askDelete()}
                >
                  <Trash2 size={16} />
                  Eliminar trabajador
                </button>
              )}
              <button
                type="button"
                className="secondary-button"
                onClick={() => setOpen(false)}
              >
                Cancelar
              </button>
              <button className="primary-button">Guardar trabajador</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function Shifts() {
  const [rows, setRows] = useState<Shift[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [range, setRange] = useState({
    start: isoDay(new Date(today.getFullYear(), today.getMonth(), 1)),
    end: isoDay(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
  });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Shift | null>(null);
  const [form, setForm] = useState<ShiftForm>({
    employee_id: '',
    clock_in: '',
    clock_out: '',
    note: 'Ajuste administrativo',
  });
  const [error, setError] = useState('');
  const load = useCallback(
    () =>
      api<Shift[]>(
        `/api/admin/shifts?start=${range.start}&end=${range.end}`,
      ).then(setRows),
    [range],
  );
  useEffect(() => {
    void load();
    void api<Employee[]>('/api/admin/employees').then(setEmployees);
  }, [load]);
  function edit(row?: Shift) {
    setEditing(row ?? null);
    setForm(
      row
        ? {
            employee_id: row.employee_id,
            clock_in: toLocalInput(row.clock_in),
            clock_out: row.clock_out ? toLocalInput(row.clock_out) : '',
            note: row.note || 'Corrección administrativa',
          }
        : {
            employee_id: employees[0]?.id || '',
            clock_in: '',
            clock_out: '',
            note: 'Ajuste administrativo',
          },
    );
    setOpen(true);
  }
  async function save(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    try {
      await api(
        editing ? `/api/admin/shifts/${editing.id}` : '/api/admin/shifts',
        { method: editing ? 'PUT' : 'POST', body: JSON.stringify(form) },
      );
      setOpen(false);
      void load();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <>
      <PageHead
        eyebrow="Registro verificable"
        title="Turnos"
        description="Consulta y corrige marcaciones. Cada ajuste queda en la auditoría."
        action={
          <button className="primary-button" onClick={() => edit()}>
            <Plus size={18} />
            Agregar turno
          </button>
        }
      />
      <div className="filters">
        <label>
          Desde
          <input
            type="date"
            value={range.start}
            onChange={(e) => setRange({ ...range, start: e.target.value })}
          />
        </label>
        <label>
          Hasta
          <input
            type="date"
            value={range.end}
            onChange={(e) => setRange({ ...range, end: e.target.value })}
          />
        </label>
      </div>
      <section className="panel">
        <ShiftTable rows={rows} onEdit={edit} />
      </section>
      {open && (
        <Modal
          title={editing ? 'Corregir turno' : 'Agregar turno'}
          onClose={() => setOpen(false)}
        >
          <form className="form-grid" onSubmit={save}>
            <label className="full">
              Trabajador
              <select
                value={form.employee_id}
                onChange={(e) =>
                  setForm({ ...form, employee_id: Number(e.target.value) })
                }
              >
                {employees.map((x) => (
                  <option value={x.id} key={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Entrada
              <input
                type="datetime-local"
                value={form.clock_in}
                onChange={(e) => setForm({ ...form, clock_in: e.target.value })}
              />
            </label>
            <label>
              Salida
              <input
                type="datetime-local"
                value={form.clock_out}
                onChange={(e) =>
                  setForm({ ...form, clock_out: e.target.value })
                }
              />
            </label>
            <label className="full">
              Motivo del ajuste
              <input
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </label>
            {error && <div className="message error full">{error}</div>}
            <div className="form-actions full">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setOpen(false)}
              >
                Cancelar
              </button>
              <button className="primary-button">Guardar turno</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function ShiftTable({
  rows,
  onEdit,
}: {
  rows: Shift[];
  onEdit?: (row: Shift) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Trabajador</th>
            <th>Entrada</th>
            <th>Salida</th>
            <th>Duración</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="empty">
                Aún no hay turnos en este rango.
              </td>
            </tr>
          )}
          {rows.map((row) => {
            const mins = row.clock_out
              ? Math.round(
                  (Date.parse(row.clock_out) - Date.parse(row.clock_in)) /
                    60000,
                )
              : null;
            return (
              <tr
                key={row.id}
                onClick={() => onEdit?.(row)}
                className={onEdit ? 'clickable' : ''}
              >
                <td>
                  <strong>{row.employee_name}</strong>
                  <small>{row.employee_code}</small>
                </td>
                <td>{dateTime.format(new Date(row.clock_in))}</td>
                <td>
                  {row.clock_out
                    ? dateTime.format(new Date(row.clock_out))
                    : '—'}
                </td>
                <td>
                  {mins == null
                    ? 'En curso'
                    : `${Math.floor(mins / 60)} h ${mins % 60} min`}
                </td>
                <td>
                  <span
                    className={'status ' + (row.clock_out ? 'ok' : 'working')}
                  >
                    {row.clock_out ? 'Cerrado' : 'Trabajando'}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Payroll() {
  const [range, setRange] = useState({
    start_date: isoDay(halfStart),
    end_date: isoDay(halfEnd),
  });
  const [data, setData] = useState<{
    run_id: number;
    entries: PayrollEntry[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [bonuses, setBonuses] = useState<Bonus[]>([]);
  const [manualDeductions, setManualDeductions] = useState<ManualDeduction[]>(
    [],
  );
  const loadRuns = useCallback(
    () => api<PayrollRun[]>('/api/admin/payroll-runs').then(setRuns),
    [],
  );
  const loadBonuses = useCallback(
    () =>
      api<Bonus[]>(
        `/api/admin/bonuses?start_date=${range.start_date}&end_date=${range.end_date}`,
      )
        .then(setBonuses)
        .catch(() => setBonuses([])),
    [range.start_date, range.end_date],
  );
  const loadManualDeductions = useCallback(
    () =>
      api<ManualDeduction[]>(
        `/api/admin/deductions?start_date=${range.start_date}&end_date=${range.end_date}`,
      )
        .then(setManualDeductions)
        .catch(() => setManualDeductions([])),
    [range.start_date, range.end_date],
  );
  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);
  useEffect(() => {
    void loadBonuses();
  }, [loadBonuses]);
  useEffect(() => {
    void loadManualDeductions();
  }, [loadManualDeductions]);
  async function generate() {
    setBusy(true);
    setError('');
    try {
      const generated = await api<{ run_id: number; entries: PayrollEntry[] }>(
        '/api/admin/payroll',
        {
          method: 'POST',
          body: JSON.stringify(range),
        },
      );
      setData(generated);
      setExpanded(generated.entries[0]?.employee_id ?? null);
      void loadRuns();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const totals = useMemo(
    () =>
      data?.entries.reduce(
        (sum, entry) => ({
          gross:
            sum.gross +
            (entry.gross_total_cents ??
              entry.base_salary_cents +
                entry.transport_cents +
                entry.extras_cents),
          deductions: sum.deductions + (entry.total_deductions_cents ?? 0),
          net: sum.net + (entry.net_total_cents ?? entry.total_cents),
        }),
        { gross: 0, deductions: 0, net: 0 },
      ) ?? { gross: 0, deductions: 0, net: 0 },
    [data],
  );
  async function openRun(run: PayrollRun) {
    setBusy(true);
    setError('');
    try {
      const saved = await api<{ id: number; entries: PayrollEntry[] }>(
        `/api/admin/payroll/${run.id}`,
      );
      setRange({ start_date: run.start_date, end_date: run.end_date });
      setData({ run_id: saved.id, entries: saved.entries });
      setExpanded(saved.entries[0]?.employee_id ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHead
        eyebrow="Cierre quincenal"
        title="Liquidación"
        description="Desglosa ingresos, seguridad social y el valor neto que recibe cada trabajador."
      />
      <section className="payroll-toolbar">
        <label>
          Inicio
          <input
            type="date"
            value={range.start_date}
            onChange={(e) => setRange({ ...range, start_date: e.target.value })}
          />
        </label>
        <label>
          Fin
          <input
            type="date"
            value={range.end_date}
            onChange={(e) => setRange({ ...range, end_date: e.target.value })}
          />
        </label>
        <button className="primary-button" onClick={generate} disabled={busy}>
          {busy ? (
            <RefreshCw className="spin" size={18} />
          ) : (
            <Banknote size={18} />
          )}
          Calcular quincena
        </button>
        {data && (
          <>
            <a
              className="secondary-button"
              href={`/api/admin/payroll/${data.run_id}/pdf`}
            >
              <FileText size={17} />
              Liquidación en PDF
            </a>
            <a
              className="secondary-button"
              href={`/api/admin/payroll/${data.run_id}/csv`}
            >
              <Download size={17} />
              Descargar CSV
            </a>
          </>
        )}
      </section>
      <BonusPanel
        range={range}
        bonuses={bonuses}
        onChange={() => void loadBonuses()}
      />
      <ManualDeductionPanel
        range={range}
        deductions={manualDeductions}
        onChange={() => void loadManualDeductions()}
      />
      {runs.length > 0 && (
        <section className="saved-runs" aria-label="Liquidaciones guardadas">
          <span>Guardadas</span>
          <div>
            {runs.slice(0, 6).map((run) => (
              <button key={run.id} onClick={() => void openRun(run)}>
                <strong>
                  {run.start_date.slice(8)}–{run.end_date.slice(8)}/
                  {run.end_date.slice(5, 7)}
                </strong>
                <small>{currency.format(run.total_cents / 100)}</small>
              </button>
            ))}
          </div>
        </section>
      )}
      <p className="retention-note">
        Las liquidaciones guardadas se borran solas cuando su quincena cumple
        dos meses. Descarga el CSV de la quincena si necesitas conservarla: una
        vez retirada no hay forma de recuperarla.
      </p>
      {error && <div className="message error">{error}</div>}
      {data && (
        <>
          <div className="payroll-total payroll-overview">
            <div>
              <span>Total devengado</span>
              <strong>{currency.format(totals.gross / 100)}</strong>
            </div>
            <div>
              <span>Total deducciones</span>
              <strong>{currency.format(totals.deductions / 100)}</strong>
            </div>
            <div className="net-overview">
              <span>Neto total a pagar</span>
              <strong>{currency.format(totals.net / 100)}</strong>
            </div>
          </div>
          <section className="payroll-list">
            {data.entries.map((entry) => {
              const gross =
                entry.gross_total_cents ??
                entry.base_salary_cents +
                  entry.transport_cents +
                  entry.extras_cents;
              const deductions = entry.total_deductions_cents ?? 0;
              const net = entry.net_total_cents ?? entry.total_cents;
              return (
                <article className="payroll-card" key={entry.employee_id}>
                  <button
                    className="payroll-summary"
                    onClick={() =>
                      setExpanded(
                        expanded === entry.employee_id
                          ? null
                          : entry.employee_id,
                      )
                    }
                  >
                    <span>
                      <strong>{entry.employee_name}</strong>
                      <small>
                        {entry.worked_hours} horas registradas ·{' '}
                        {entry.worked_days} días con marcación
                      </small>
                    </span>
                    <span className="money">
                      <strong>{currency.format(net / 100)}</strong>
                      <small>Neto a pagar</small>
                    </span>
                    <ChevronDown
                      className={expanded === entry.employee_id ? 'rotate' : ''}
                    />
                  </button>
                  {expanded === entry.employee_id && (
                    <div className="payroll-detail">
                      {(entry.compliance_alerts?.length ?? 0) > 0 && (
                        <div className="message error payroll-alerts">
                          <strong>Revisión laboral requerida</strong>
                          {entry.compliance_alerts?.map((alert) => (
                            <p key={`${alert.code}-${alert.detail}`}>
                              {alert.detail}
                            </p>
                          ))}
                        </div>
                      )}
                      <div className="payroll-actions">
                        <a
                          className="secondary-button"
                          href={`/api/admin/payroll/${data.run_id}/employee/${entry.employee_id}/pdf`}
                        >
                          <FileText size={16} />
                          Comprobante en PDF
                        </a>
                      </div>
                      <div className="payroll-meta">
                        <div>
                          <span>Días calculados</span>
                          <strong>{entry.calculated_days ?? '—'}</strong>
                        </div>
                        <div>
                          <span>IBC seguridad social</span>
                          <strong>
                            {currency.format((entry.ibc_cents ?? 0) / 100)}
                          </strong>
                        </div>
                      </div>
                      <div className="pay-summary-grid">
                        <Line name="Salario" value={entry.base_salary_cents} />
                        <Line
                          name="Ingresos adicionales"
                          value={
                            entry.transport_cents +
                            entry.extras_cents +
                            (entry.bonus_total_cents ?? 0)
                          }
                        />
                        <Line name="Deducciones" value={deductions} />
                        <Line name="Neto a pagar" value={net} />
                      </div>
                      <div className="payroll-columns">
                        <section>
                          <h3>Ingresos</h3>
                          <div className="table-wrap">
                            <table>
                              <thead>
                                <tr>
                                  <th>Concepto</th>
                                  <th>Cantidad</th>
                                  <th>Valor</th>
                                </tr>
                              </thead>
                              <tbody>
                                <tr>
                                  <td>Salario base quincenal</td>
                                  <td>—</td>
                                  <td>
                                    {currency.format(
                                      entry.base_salary_cents / 100,
                                    )}
                                  </td>
                                </tr>
                                <tr>
                                  <td>Auxilio de transporte</td>
                                  <td>—</td>
                                  <td>
                                    {currency.format(
                                      entry.transport_cents / 100,
                                    )}
                                  </td>
                                </tr>
                                {entry.breakdown.map((line) => (
                                  <tr key={line.category}>
                                    <td>{line.label}</td>
                                    <td>{line.hours.toFixed(2)} h</td>
                                    <td>
                                      {currency.format(line.amount_cents / 100)}
                                    </td>
                                  </tr>
                                ))}
                                {(entry.bonuses ?? []).map((line, index) => (
                                  <tr key={line.id ?? `bono-${index}`}>
                                    <td>{line.concept}</td>
                                    <td>
                                      {line.constitutes_salary
                                        ? 'Bonificación salarial'
                                        : 'Bonificación no salarial'}
                                    </td>
                                    <td>
                                      {currency.format(line.amount_cents / 100)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot>
                                <tr>
                                  <th colSpan={2}>Total devengado</th>
                                  <th>{currency.format(gross / 100)}</th>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        </section>
                        <section>
                          <h3>Deducciones</h3>
                          <div className="table-wrap">
                            <table>
                              <thead>
                                <tr>
                                  <th>Concepto</th>
                                  <th>Porcentaje</th>
                                  <th>Valor</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(entry.deductions ?? []).map((line) => (
                                  <tr key={`${line.category}-${line.label}`}>
                                    <td>{line.label}</td>
                                    <td>
                                      {line.category === 'manual'
                                        ? 'Valor fijo'
                                        : `${(line.rate * 100).toFixed(2)}%`}
                                    </td>
                                    <td>
                                      {currency.format(line.amount_cents / 100)}
                                    </td>
                                  </tr>
                                ))}
                                {(entry.deductions ?? []).length === 0 && (
                                  <tr>
                                    <td colSpan={3}>
                                      Liquidación anterior sin deducciones
                                      calculadas.
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                              <tfoot>
                                <tr>
                                  <th colSpan={2}>Total deducciones</th>
                                  <th>{currency.format(deductions / 100)}</th>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        </section>
                      </div>
                      <div className="formula-note">
                        Salud y pensión se calculan sobre el IBC: salario más
                        recargos y horas extra, sin incluir el auxilio de
                        transporte. ARL y demás aportes exclusivos del empleador
                        no se descuentan al trabajador. Una bonificación marcada
                        como no salarial se paga completa y no aporta al IBC;
                        una marcada como salarial sí aporta.
                        {(entry.non_salary_excess_cents ?? 0) > 0 && (
                          <>
                            {' '}
                            En esta quincena las bonificaciones no salariales
                            superan el 40% del total, así que{' '}
                            {currency.format(
                              (entry.non_salary_excess_cents ?? 0) / 100,
                            )}{' '}
                            sí entró al IBC.
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </section>
        </>
      )}
    </>
  );
}
// Bonificaciones de la quincena: premios por buen comportamiento o cualquier
// concepto que decida el jefe. Se suman al total y, salvo que se marquen como
// salariales, no aportan al IBC.
function BonusPanel({
  range,
  bonuses,
  onChange,
}: {
  range: { start_date: string; end_date: string };
  bonuses: Bonus[];
  onChange: () => void;
}) {
  const empty = {
    employee_id: '',
    effective_date: '',
    concept: '',
    amount: '',
    constitutes_salary: false,
    note: '',
  };
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  useEffect(() => {
    void api<Employee[]>('/api/admin/employees')
      .then((list) => setEmployees(list.filter((item) => item.active)))
      .catch(() => setEmployees([]));
  }, []);
  // Sin fecha elegida vale el primer día de la quincena mostrada.
  const effectiveDate = form.effective_date || range.start_date;
  const total = bonuses.reduce((sum, bonus) => sum + bonus.amount_cents, 0);

  async function add(event: SyntheticEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/admin/bonuses', {
        method: 'POST',
        body: JSON.stringify({
          employee_id: Number(form.employee_id),
          effective_date: effectiveDate,
          concept: form.concept,
          amount: Number(form.amount),
          constitutes_salary: form.constitutes_salary,
          note: form.note,
        }),
      });
      setForm({ ...empty, effective_date: effectiveDate });
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(bonus: Bonus) {
    setError('');
    try {
      await api(`/api/admin/bonuses/${bonus.id}`, { method: 'DELETE' });
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section className="panel bonus-panel">
      <div className="panel-head">
        <div>
          <h2>Bonificaciones</h2>
          <p>
            Premios por buen comportamiento o cualquier concepto adicional de
            esta quincena. Se suman al total de cada trabajador.
          </p>
        </div>
        <div className="bonus-head-actions">
          <strong>{currency.format(total / 100)}</strong>
          <button
            className="secondary-button"
            onClick={() => setOpen((value) => !value)}
          >
            <Plus size={17} />
            {open ? 'Cerrar' : 'Agregar'}
          </button>
        </div>
      </div>
      {open && (
        <form className="bonus-form" onSubmit={(event) => void add(event)}>
          <label>
            Trabajador
            <select
              required
              value={form.employee_id}
              onChange={(event) =>
                setForm({ ...form, employee_id: event.target.value })
              }
            >
              <option value="">Elige…</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Fecha
            <input
              type="date"
              required
              min={range.start_date}
              max={range.end_date}
              value={effectiveDate}
              onChange={(event) =>
                setForm({ ...form, effective_date: event.target.value })
              }
            />
          </label>
          <label className="bonus-concept">
            Concepto
            <input
              required
              minLength={2}
              maxLength={120}
              placeholder="Bonificación por buen comportamiento"
              value={form.concept}
              onChange={(event) =>
                setForm({ ...form, concept: event.target.value })
              }
            />
          </label>
          <label>
            Valor
            <input
              type="number"
              required
              min="1"
              step="1"
              placeholder="50000"
              value={form.amount}
              onChange={(event) =>
                setForm({ ...form, amount: event.target.value })
              }
            />
          </label>
          <label className="check bonus-salary">
            <input
              type="checkbox"
              checked={form.constitutes_salary}
              onChange={(event) =>
                setForm({ ...form, constitutes_salary: event.target.checked })
              }
            />
            Constituye salario (aporta a salud y pensión)
          </label>
          <div className="form-actions bonus-actions">
            <button className="primary-button" disabled={busy}>
              <Check size={17} />
              Agregar bonificación
            </button>
          </div>
        </form>
      )}
      {error && <div className="message error">{error}</div>}
      {bonuses.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Trabajador</th>
                <th>Fecha</th>
                <th>Concepto</th>
                <th>Tipo</th>
                <th>Valor</th>
                <th>
                  <span className="sr-only">Quitar</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {bonuses.map((bonus) => (
                <tr key={bonus.id}>
                  <td>{bonus.employee_name}</td>
                  <td>{bonus.effective_date}</td>
                  <td>{bonus.concept}</td>
                  <td>
                    {bonus.constitutes_salary ? 'Salarial' : 'No salarial'}
                  </td>
                  <td>{currency.format(bonus.amount_cents / 100)}</td>
                  <td>
                    <button
                      className="text-button"
                      onClick={() => void remove(bonus)}
                      aria-label={`Quitar ${bonus.concept}`}
                    >
                      <X size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">
          Sin bonificaciones en esta quincena. Las que agregues aquí entran al
          calcularla.
        </div>
      )}
      <p className="schedule-note">
        Vuelve a calcular la quincena después de cambiar una bonificación. Las
        liquidaciones ya guardadas conservan su propia copia y no se alteran.
      </p>
    </section>
  );
}

function ManualDeductionPanel({
  range,
  deductions,
  onChange,
}: {
  range: { start_date: string; end_date: string };
  deductions: ManualDeduction[];
  onChange: () => void;
}) {
  const empty = {
    employee_id: '',
    effective_date: '',
    concept: '',
    amount: '',
    note: '',
  };
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  useEffect(() => {
    void api<Employee[]>('/api/admin/employees')
      .then((list) => setEmployees(list.filter((item) => item.active)))
      .catch(() => setEmployees([]));
  }, []);
  const effectiveDate = form.effective_date || range.start_date;
  const total = deductions.reduce((sum, item) => sum + item.amount_cents, 0);

  async function add(event: SyntheticEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/admin/deductions', {
        method: 'POST',
        body: JSON.stringify({
          employee_id: Number(form.employee_id),
          effective_date: effectiveDate,
          concept: form.concept,
          amount: Number(form.amount),
          note: form.note,
        }),
      });
      setForm({ ...empty, effective_date: effectiveDate });
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: ManualDeduction) {
    setError('');
    try {
      await api(`/api/admin/deductions/${item.id}`, { method: 'DELETE' });
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section className="panel bonus-panel">
      <div className="panel-head">
        <div>
          <h2>Deducciones</h2>
          <p>
            Deudas, adelantos u otros descuentos autorizados de esta quincena.
          </p>
        </div>
        <div className="bonus-head-actions">
          <strong>{currency.format(total / 100)}</strong>
          <button
            className="secondary-button"
            onClick={() => setOpen((value) => !value)}
          >
            <Plus size={17} /> {open ? 'Cerrar' : 'Agregar'}
          </button>
        </div>
      </div>
      {open && (
        <form className="bonus-form" onSubmit={(event) => void add(event)}>
          <label>
            Trabajador
            <select
              required
              value={form.employee_id}
              onChange={(event) =>
                setForm({ ...form, employee_id: event.target.value })
              }
            >
              <option value="">Elige…</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Fecha
            <input
              type="date"
              required
              min={range.start_date}
              max={range.end_date}
              value={effectiveDate}
              onChange={(event) =>
                setForm({ ...form, effective_date: event.target.value })
              }
            />
          </label>
          <label className="bonus-concept">
            Concepto
            <input
              required
              minLength={2}
              maxLength={120}
              placeholder="Adelanto de nómina"
              value={form.concept}
              onChange={(event) =>
                setForm({ ...form, concept: event.target.value })
              }
            />
          </label>
          <label>
            Valor
            <input
              type="number"
              required
              min="1"
              step="1"
              placeholder="50000"
              value={form.amount}
              onChange={(event) =>
                setForm({ ...form, amount: event.target.value })
              }
            />
          </label>
          <div className="form-actions bonus-actions">
            <button className="primary-button" disabled={busy}>
              <Check size={17} /> Agregar deducción
            </button>
          </div>
        </form>
      )}
      {error && <div className="message error">{error}</div>}
      {deductions.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Trabajador</th>
                <th>Fecha</th>
                <th>Concepto</th>
                <th>Valor</th>
                <th>
                  <span className="sr-only">Quitar</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {deductions.map((item) => (
                <tr key={item.id}>
                  <td>{item.employee_name}</td>
                  <td>{item.effective_date}</td>
                  <td>{item.concept}</td>
                  <td>{currency.format(item.amount_cents / 100)}</td>
                  <td>
                    <button
                      className="text-button"
                      onClick={() => void remove(item)}
                      aria-label={`Quitar ${item.concept}`}
                    >
                      <X size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">
          Sin deducciones adicionales en esta quincena.
        </div>
      )}
      <p className="schedule-note">
        Vuelve a calcular la quincena después de cambiar una deducción. Verifica
        que el descuento esté autorizado y respete el mínimo protegido por la
        ley.
      </p>
    </section>
  );
}

function Line({ name, value }: { name: string; value: number }) {
  return (
    <div>
      <span>{name}</span>
      <strong>{currency.format(value / 100)}</strong>
    </div>
  );
}

function LegalRules() {
  const [rules, setRules] = useState<LegalRule[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState<LegalRuleForm>({
    effective_from: isoDay(today),
    minimum_salary: 1750905,
    transport_allowance: 249095,
    weekly_hours: 42,
    night_start_hour: 19,
    rest_day_surcharge: 0.9,
  });
  const load = useCallback(
    () => api<LegalRule[]>('/api/admin/legal-rules').then(setRules),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const currentRule = rules.find(
    (rule) => rule.effective_from <= isoDay(today),
  );
  const currentHourlyCents = currentRule
    ? currentRule.minimum_salary_cents / (currentRule.weekly_hours * 5)
    : 0;
  const hourlyPrices = currentRule
    ? ([
        ['Hora ordinaria diurna', 1, 0],
        ['Hora ordinaria nocturna', 1.35, 0.35],
        ['Hora extra diurna', 1.25, 0.25],
        ['Hora extra nocturna', 1.75, 0.75],
        [
          'Hora dominical/festiva diurna',
          1 + currentRule.rest_day_surcharge,
          currentRule.rest_day_surcharge,
        ],
        [
          'Hora dominical/festiva nocturna',
          1 + currentRule.rest_day_surcharge + 0.35,
          currentRule.rest_day_surcharge + 0.35,
        ],
        [
          'Hora extra dominical/festiva diurna',
          1 + currentRule.rest_day_surcharge + 0.25,
          currentRule.rest_day_surcharge + 0.25,
        ],
        [
          'Hora extra dominical/festiva nocturna',
          1 + currentRule.rest_day_surcharge + 0.75,
          currentRule.rest_day_surcharge + 0.75,
        ],
      ] as const)
    : [];
  async function save(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      await api('/api/admin/legal-rules', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setOpen(false);
      void load();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <>
      <PageHead
        eyebrow="Parámetros versionados"
        title="Reglas legales"
        description="Los cálculos usan la regla vigente en la fecha de cada minuto trabajado."
        action={
          <button className="primary-button" onClick={() => setOpen(true)}>
            <Plus size={18} />
            Nueva vigencia
          </button>
        }
      />
      <div className="legal-callout">
        <ShieldCheck />
        <div>
          <strong>Configuración vigente precargada para Colombia</strong>
          <p>
            Desde el 15 de julio de 2026: 42 horas semanales, jornada nocturna
            desde las 7:00 p. m. y recargo dominical/festivo del 90%. Salario
            mínimo 2026: {currency.format(1750905)}; auxilio:{' '}
            {currency.format(249095)}.
          </p>
        </div>
      </div>
      {currentRule && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Valor actual de cada hora</h2>
              <p>
                Vigente desde {currentRule.effective_from}, calculado con
                salario mínimo de{' '}
                {currency.format(currentRule.minimum_salary_cents / 100)} y
                divisor de {currentRule.weekly_hours * 5} horas mensuales.
              </p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tipo de hora</th>
                  <th>Factor</th>
                  <th>Valor total</th>
                  <th>Adicional sobre la hora base</th>
                </tr>
              </thead>
              <tbody>
                {hourlyPrices.map(([label, multiplier, additional]) => (
                  <tr key={label}>
                    <td>{label}</td>
                    <td>{multiplier.toFixed(2)}×</td>
                    <td>
                      {currency.format((currentHourlyCents * multiplier) / 100)}
                    </td>
                    <td>
                      {additional === 0
                        ? 'Incluida en el salario'
                        : currency.format(
                            (currentHourlyCents * additional) / 100,
                          )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="schedule-note">
            La hora base es {currency.format(currentHourlyCents / 100)}. Los
            valores se redondean al peso solo para mostrarlos; la liquidación
            conserva la precisión interna.
          </p>
        </section>
      )}
      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Desde</th>
                <th>Salario mínimo</th>
                <th>Aux. transporte</th>
                <th>Jornada</th>
                <th>Noche</th>
                <th>Descanso/festivo</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td>{r.effective_from}</td>
                  <td>{currency.format(r.minimum_salary_cents / 100)}</td>
                  <td>{currency.format(r.transport_allowance_cents / 100)}</td>
                  <td>{r.weekly_hours} h/sem</td>
                  <td>{r.night_start_hour}:00</td>
                  <td>{Math.round(r.rest_day_surcharge * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <p className="disclaimer">
        Esta herramienta produce una preliquidación operativa. Los contratos,
        ausencias, incapacidades, compensatorios, deducciones y prestaciones
        deben ser revisados por la persona responsable de nómina o un asesor
        laboral.
      </p>
      {open && (
        <Modal title="Nueva vigencia legal" onClose={() => setOpen(false)}>
          <form className="form-grid" onSubmit={save}>
            <label>
              Fecha de vigencia
              <input
                type="date"
                value={form.effective_from}
                onChange={(e) =>
                  setForm({ ...form, effective_from: e.target.value })
                }
              />
            </label>
            <label>
              Salario mínimo
              <input
                type="number"
                value={form.minimum_salary}
                onChange={(e) =>
                  setForm({ ...form, minimum_salary: Number(e.target.value) })
                }
              />
            </label>
            <label>
              Auxilio transporte
              <input
                type="number"
                value={form.transport_allowance}
                onChange={(e) =>
                  setForm({
                    ...form,
                    transport_allowance: Number(e.target.value),
                  })
                }
              />
            </label>
            <label>
              Horas semanales
              <input
                type="number"
                value={form.weekly_hours}
                onChange={(e) =>
                  setForm({ ...form, weekly_hours: Number(e.target.value) })
                }
              />
            </label>
            <label>
              Inicio noche (hora 0–23)
              <input
                type="number"
                min="0"
                max="23"
                value={form.night_start_hour}
                onChange={(e) =>
                  setForm({ ...form, night_start_hour: Number(e.target.value) })
                }
              />
            </label>
            <label>
              Recargo descanso (decimal)
              <input
                type="number"
                step="0.01"
                value={form.rest_day_surcharge}
                onChange={(e) =>
                  setForm({
                    ...form,
                    rest_day_surcharge: Number(e.target.value),
                  })
                }
              />
            </label>
            {error && <div className="message error full">{error}</div>}
            <div className="form-actions full">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setOpen(false)}
              >
                Cancelar
              </button>
              <button className="primary-button">Guardar vigencia</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="modal-backdrop">
      <dialog open className="modal" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button onClick={onClose} aria-label="Cerrar">
            <X />
          </button>
        </header>
        {children}
      </dialog>
    </div>
  );
}
function toLocalInput(iso: string) {
  const d = new Date(iso);
  const local = new Date(
    d.toLocaleString('en-US', { timeZone: 'America/Bogota' }),
  );
  return new Date(local.getTime() - local.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

export default function App() {
  const [mode, setMode] = useState<
    'checking' | 'kiosk' | 'login' | 'estrenar' | 'admin'
  >('checking');
  const [configurada, setConfigurada] = useState(true);
  const localBrowser = ['localhost', '127.0.0.1', '::1'].includes(
    window.location.hostname,
  );
  useEffect(() => {
    void api<{ authenticated: boolean; configured: boolean }>(
      '/api/admin/session',
    )
      .then((x) => {
        setConfigurada(x.configured);
        setMode(
          x.authenticated
            ? 'admin'
            : x.configured
              ? localBrowser
                ? 'kiosk'
                : 'login'
              : 'estrenar',
        );
      })
      .catch(() => setMode(localBrowser ? 'kiosk' : 'login'));
  }, [localBrowser]);
  if (mode === 'checking')
    return (
      <div className="loading-screen">
        <Logo />
        <RefreshCw className="spin" />
      </div>
    );
  if (mode === 'kiosk')
    return (
      <Kiosk onAdmin={() => setMode(configurada ? 'login' : 'estrenar')} />
    );
  if (mode === 'estrenar')
    return (
      <PrimeraClave
        onSuccess={() => {
          setConfigurada(true);
          setMode('admin');
        }}
        onBack={localBrowser ? () => setMode('kiosk') : undefined}
      />
    );
  if (mode === 'login')
    return (
      <Login
        onSuccess={() => setMode('admin')}
        onBack={localBrowser ? () => setMode('kiosk') : undefined}
      />
    );
  return <Admin onExit={() => setMode(localBrowser ? 'kiosk' : 'login')} />;
}
