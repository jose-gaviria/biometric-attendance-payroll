import { useEffect, useState } from 'react';
import { Camera } from './Camera';
import type { Attendance, Fallback } from './Camera';
import { api } from './api';
import './face.css';

type Profile = {
  id: string;
  display_name: string;
  active: number;
  biometric_status: string;
};
type Employee = { id: number; name: string; code: string; active: number };
type Link = { employee_id: number; profile_id: string };

async function readData() {
  const [people, bindings] = await Promise.all([
    fetch('/api/admin/employees').then(async (r) => {
      if (!r.ok) throw new Error('Inicia sesión de nuevo.');
      return r.json();
    }),
    api<Link[]>('/links'),
  ]);
  const all: Profile[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await api<Profile[]>('/profiles?offset=' + offset);
    all.push(...page);
    if (page.length < 100) break;
  }

  return { people, bindings, all };
}

export function FaceKiosk({
  action,
  onClose,
  onSuccess,
  onFallback,
}: {
  action: 'in' | 'out';
  onClose: () => void;
  onSuccess: (attendance: Attendance) => void;
  onFallback: (state: Fallback) => void;
}) {
  return (
    <div className="face-module">
      <Camera
        action={action}
        debug={false}
        onClose={onClose}
        onSuccess={onSuccess}
        onFallback={onFallback}
        onEnrolled={() => {}}
      />
    </div>
  );
}
export function FaceAdmin() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [camera, setCamera] = useState<Profile | null>(null);
  async function load() {
    try {
      const { people, bindings, all } = await readData();
      setError('');
      setEmployees(people);
      setLinks(bindings);
      setProfiles(all);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    let active = true;
    void readData()
      .then(({ people, bindings, all }) => {
        if (active) {
          setEmployees(people);
          setLinks(bindings);
          setProfiles(all);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (active) {
          setError((e as Error).message);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await work();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (camera)
    return (
      <div className="face-module">
        <Camera
          profile={camera}
          debug={false}
          onClose={() => {
            setCamera(null);
            void load();
          }}
          onEnrolled={() => void load()}
        />
      </div>
    );
  return (
    <section className="face-module">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Administración</p>
          <h1>Rostros y trabajadores</h1>
        </div>
        <button onClick={() => void load()}>Actualizar</button>
      </div>
      <p>
        Vincula cada trabajador con su perfil facial. Los rostros que ya
        registraste están disponibles; no necesitas enrolarlos de nuevo.
      </p>
      <p>
        El enrolamiento es voluntario. La marcación por PIN sigue disponible.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {loading && <output>Cargando trabajadores y rostros…</output>}
      {!loading && !error && !employees.length && (
        <p>Crea primero los trabajadores en la sección Trabajadores.</p>
      )}
      <div className="face-people">
        {employees.map((employee) => {
          const link = links.find((l) => l.employee_id === employee.id);
          const profile = profiles.find((p) => p.id === link?.profile_id);
          return (
            <article className="panel" key={employee.id}>
              <h2>
                {employee.name}{' '}
                <small>
                  · {employee.code}
                  {!employee.active ? ' · Inactivo' : ''}
                </small>
              </h2>
              <label>
                Perfil facial
                <select
                  aria-label={'Perfil facial de ' + employee.name}
                  disabled={busy}
                  value={link?.profile_id ?? ''}
                  onChange={(e) => {
                    const id = e.target.value;
                    void run(async () => {
                      await api('/links/' + employee.id, 'PUT', {
                        profile_id: id || null,
                      });
                    });
                  }}
                >
                  <option value="">Sin vincular</option>
                  {profiles.map((p) => (
                    <option
                      key={p.id}
                      value={p.id}
                      disabled={links.some(
                        (l) =>
                          l.profile_id === p.id &&
                          l.employee_id !== employee.id,
                      )}
                    >
                      {p.display_name} ·{' '}
                      {p.active
                        ? p.biometric_status === 'registered'
                          ? 'Rostro registrado'
                          : p.biometric_status === 'outdated'
                            ? 'Actualizar rostro'
                            : 'Sin muestras'
                        : 'Inactivo'}
                    </option>
                  ))}
                </select>
              </label>
              <div className="face-actions">
                {!profile ? (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const created = await api<{ id: string }>(
                          '/profiles',
                          'POST',
                          {
                            display_name: employee.name,
                            external_reference: 'turnos:' + employee.id,
                          },
                        );
                        await api('/links/' + employee.id, 'PUT', {
                          profile_id: created.id,
                        });
                        setCamera({
                          id: created.id,
                          display_name: employee.name,
                          active: 1,
                          biometric_status: 'none',
                        });
                      })
                    }
                  >
                    Crear perfil y enrolar
                  </button>
                ) : (
                  <>
                    <button
                      disabled={busy || !profile.active}
                      onClick={() => setCamera(profile)}
                    >
                      {profile.biometric_status === 'none'
                        ? 'Registrar rostro'
                        : 'Actualizar rostro'}
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await api('/profiles/' + profile.id, 'PATCH', {
                            active: !profile.active,
                          });
                        })
                      }
                    >
                      {profile.active ? 'Desactivar rostro' : 'Activar rostro'}
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            '¿Eliminar las muestras faciales de ' +
                              profile.display_name +
                              '? El trabajador y sus turnos se conservarán.',
                          )
                        )
                          void run(async () => {
                            await api(
                              '/profiles/' + profile.id + '/face',
                              'DELETE',
                            );
                          });
                      }}
                    >
                      Eliminar muestras
                    </button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
