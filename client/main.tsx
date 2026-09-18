import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, ApiError } from "./api";
import { Camera } from "./Camera";
import "./style.css";
type Profile = {
  id: string;
  display_name: string;
  external_reference: string | null;
  active: number;
  templates: number;
  biometric_status: string;
};
const bioLabels: Record<string, string> = {
  none: "Sin registrar",
  registered: "Rostro registrado",
  outdated: "Requiere actualización",
};
function App() {
  const [role, setRole] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [configured, setConfigured] = useState(true),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [page, setPage] = useState("home"),
    [status, setStatus] = useState<any>(null),
    [profiles, setProfiles] = useState<Profile[]>([]),
    [search, setSearch] = useState(""),
    [offset, setOffset] = useState(0),
    [edit, setEdit] = useState<Profile | "new" | null>(null),
    [enroll, setEnroll] = useState<Profile | undefined>();
  const [name, setName] = useState(""),
    [reference, setReference] = useState(""),
    [config, setConfig] = useState<any>(null),
    [notice, setNotice] = useState(""),
    [logs, setLogs] = useState<any>(null);
  useEffect(() => {
    void Promise.all([
      api("/setup-status").then((s) => setConfigured(s.configured)),
      api("/session")
        .then((s) => setRole(s.role))
        .catch(() => {}),
    ])
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  const refreshStatus = useCallback(() => {
    void api("/status")
      .then(setStatus)
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) setRole(null);
        else setStatus(null);
      });
  }, []);
  useEffect(() => {
    if (!role) return;
    refreshStatus();
    const interval = setInterval(refreshStatus, 10000);
    return () => clearInterval(interval);
  }, [role, refreshStatus]);
  const refreshProfiles = useCallback(
    () =>
      api<Profile[]>(
        "/profiles?q=" + encodeURIComponent(search) + "&offset=" + offset,
      )
        .then(setProfiles)
        .catch((e) => setError(e.message)),
    [search, offset],
  );
  useEffect(() => {
    if (role !== "admin") return;
    if (page === "people") {
      const t = setTimeout(() => void refreshProfiles(), 180);
      return () => clearTimeout(t);
    }
    if (page === "settings")
      void api("/settings")
        .then(setConfig)
        .catch((e) => setError(e.message));
    if (page === "logs")
      void api("/logs")
        .then(setLogs)
        .catch((e) => setError(e.message));
  }, [page, role, refreshProfiles]);
  async function action(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function go(next: string) {
    setPage(next);
    setEnroll(undefined);
    setError("");
    setNotice("");
    setEdit(null);
  }
  function openEdit(p: Profile | "new") {
    setEdit(p);
    setName(p === "new" ? "" : p.display_name);
    setReference(p === "new" ? "" : (p.external_reference ?? ""));
  }
  if (loading)
    return (
      <main className="login">
        <p>Conectando con el laboratorio local…</p>
      </main>
    );
  if (!role)
    return (
      <main className="login">
        <div className="login-card panel">
          <div className="brand">
            <span className="brand-mark">T</span>
            <span>
              ATTENDANCE <small>LABORATORIO FACIAL</small>
            </span>
          </div>
          <h1>
            {configured ? "Acceso al laboratorio" : "Configurar administrador"}
          </h1>
          {configured ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void action(async () => {
                  const s = await api("/login", "POST", { password });
                  setRole(s.role);
                  setPassword("");
                  go("home");
                });
              }}
            >
              <label>
                Contraseña administrativa
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  maxLength={128}
                  required
                />
              </label>
              <button disabled={busy}>
                {busy ? "Ingresando…" : "Ingresar"}
              </button>
            </form>
          ) : (
            <>
              <p>
                Antes del primer uso, crea una contraseña privada desde este
                computador.
              </p>
              <code>configurar-admin.bat</code>
              <p className="muted">
                Está en la carpeta del proyecto. Abre el archivo y sigue las
                instrucciones.
              </p>
              <button
                onClick={() =>
                  void action(async () => {
                    const s = await api("/setup-status");
                    setConfigured(s.configured);
                    if (!s.configured)
                      setNotice("La configuración aún no se ha completado.");
                  })
                }
              >
                Ya configuré el administrador
              </button>
            </>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {notice && <p>{notice}</p>}
          <div className="privacy-line">
            <span className="dot" /> Local · Sin nube · Sin fotografías
            guardadas
          </div>
        </div>
      </main>
    );
  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <span className="brand-mark">T</span>
          <span>
            ATTENDANCE <small>LABORATORIO FACIAL</small>
          </span>
        </div>
        <nav aria-label="Principal">
          {(role === "admin"
            ? [
                ["home", "Resumen"],
                ["identify", "Identificación"],
                ["people", "Personas"],
                ["settings", "Configuración"],
                ["logs", "Actividad"],
              ]
            : [["identify", "Identificación"]]
          ).map(([key, label]) => (
            <button
              key={key}
              className={"nav-link " + (page === key ? "selected" : "")}
              onClick={() => go(key)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="local-badge">
            <span className="dot" /> Instalación local
          </span>
          <p>{role === "admin" ? "Administrador" : "Modo kiosco"}</p>
          <button
            className="secondary"
            onClick={() =>
              void action(async () => {
                await api("/logout", "POST", {});
                setRole(null);
              })
            }
          >
            Cerrar sesión
          </button>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>Laboratorio de identificación</span>
          <span className={"health " + (status?.face ? "ok" : "bad")}>
            <span className="dot" />
            {status?.face ? "Sistema operativo" : "Servicio no disponible"}
          </span>
        </header>
        <div className="content">
          {error && (
            <div className="error global" role="alert">
              {error}
              <button className="text-button" onClick={() => setError("")}>
                Cerrar
              </button>
            </div>
          )}
          {notice && (
            <p className="notice" role="status">
              {notice}
            </p>
          )}
          {page === "identify" || page === "enroll" ? (
            <Camera
              key={enroll?.id ?? "identify"}
              profile={enroll}
              debug={status?.debug ?? false}
              onClose={() => go(role === "admin" ? "home" : "idle")}
              onEnrolled={() => {
                refreshStatus();
                setNotice("Rostro registrado correctamente.");
              }}
            />
          ) : page === "home" ? (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">VISIÓN GENERAL</p>
                  <h1>Sistema facial</h1>
                  <p>
                    Identificación de personas registradas en este computador.
                  </p>
                </div>
                <button onClick={() => go("identify")}>
                  Abrir identificación <span aria-hidden="true">↗</span>
                </button>
              </div>
              <div className="stats">
                <article className="panel">
                  <span>Perfiles</span>
                  <strong>{status?.stats?.profiles ?? "—"}</strong>
                  <small>Personas en el laboratorio</small>
                </article>
                <article className="panel">
                  <span>Rostros registrados</span>
                  <strong>{status?.stats?.registered ?? "—"}</strong>
                  <small>Con templates locales</small>
                </article>
                <article className="panel">
                  <span>Servicio facial</span>
                  <strong className="status-word">
                    {status?.face ? "Operativo" : "No disponible"}
                  </strong>
                  <small>Inferencia en CPU</small>
                </article>
              </div>
              <div className="home-grid">
                <section className="panel start-panel">
                  <span className="eyebrow">IDENTIFICACIÓN 1:N</span>
                  <div className="scan-icon" aria-hidden="true">
                    ◎
                  </div>
                  <h2>Colócate frente a la cámara</h2>
                  <p>Mira al frente y obtén el resultado automáticamente.</p>
                  <button onClick={() => go("identify")}>Iniciar cámara</button>
                </section>
                <section className="panel">
                  <h2>Preparar el laboratorio</h2>
                  <ol className="onboarding">
                    <li>
                      <span>01</span>
                      <div>
                        <h3>Crea un perfil</h3>
                        <p>Nombre y referencia opcional.</p>
                      </div>
                    </li>
                    <li>
                      <span>02</span>
                      <div>
                        <h3>Registra el rostro</h3>
                        <p>Consentimiento, presencia y seis muestras.</p>
                      </div>
                    </li>
                    <li>
                      <span>03</span>
                      <div>
                        <h3>Prueba la identificación</h3>
                        <p>Valida registrados y personas desconocidas.</p>
                      </div>
                    </li>
                  </ol>
                  <button className="secondary" onClick={() => go("people")}>
                    Gestionar personas
                  </button>
                </section>
              </div>
              <div className="panel kiosk-row">
                <div>
                  <h3>Dejar el equipo en modo kiosco</h3>
                  <p>
                    Oculta la administración y permite únicamente identificar.
                    Para administrar otra vez necesitarás la contraseña.
                  </p>
                </div>
                <button
                  className="secondary"
                  onClick={() =>
                    void action(async () => {
                      await api("/kiosk", "POST", {});
                      setRole("kiosk");
                      go("identify");
                    })
                  }
                >
                  Activar kiosco
                </button>
              </div>
            </>
          ) : page === "people" ? (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">REGISTRO LOCAL</p>
                  <h1>Personas</h1>
                  <p>Administra perfiles y datos faciales.</p>
                </div>
                <button onClick={() => openEdit("new")}>+ Crear perfil</button>
              </div>
              <div className="search-row">
                <label className="sr-only" htmlFor="search">
                  Buscar personas
                </label>
                <input
                  id="search"
                  type="search"
                  placeholder="Buscar por nombre…"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setOffset(0);
                  }}
                />
                <span className="muted">
                  {profiles.length} perfiles en esta página
                </span>
              </div>
              <div className="people-list">
                {profiles.length === 0 ? (
                  <div className="empty panel">
                    <h2>
                      {search
                        ? "Sin resultados"
                        : "Aún no hay personas registradas"}
                    </h2>
                    <p>
                      {search
                        ? "Prueba con otro nombre."
                        : "Crea el primer perfil para registrar su rostro."}
                    </p>
                  </div>
                ) : (
                  profiles.map((p) => (
                    <article key={p.id} className="person panel">
                      <div className="avatar" aria-hidden="true">
                        {p.display_name
                          .split(" ")
                          .slice(0, 2)
                          .map((s) => s[0])
                          .join("")
                          .toUpperCase()}
                      </div>
                      <div className="person-info">
                        <h2>
                          {p.display_name}{" "}
                          {!p.active && <span className="tag">Inactivo</span>}
                        </h2>
                        <p>
                          {p.external_reference || "Sin referencia externa"}
                        </p>
                        <span className={"bio " + p.biometric_status}>
                          {p.biometric_status === "registered" ? "✓ " : ""}
                          {bioLabels[p.biometric_status]}
                        </span>
                        {p.biometric_status === "outdated" && (
                          <p className="muted">
                            Este perfil utiliza una versión anterior del modelo
                            facial. Vuelve a registrar el rostro.
                          </p>
                        )}
                      </div>
                      <div className="person-actions">
                        <button
                          disabled={!p.active || busy}
                          onClick={() => {
                            setEnroll(p);
                            setPage("enroll");
                          }}
                        >
                          {p.templates
                            ? "Actualizar rostro"
                            : "Registrar rostro"}
                        </button>
                        <button
                          className="secondary"
                          onClick={() => openEdit(p)}
                        >
                          Editar
                        </button>
                        <details>
                          <summary>Más opciones</summary>
                          <div className="more-actions">
                            <button
                              className="secondary"
                              disabled={busy}
                              onClick={() =>
                                void action(async () => {
                                  await api("/profiles/" + p.id, "PATCH", {
                                    active: !p.active,
                                  });
                                  await refreshProfiles();
                                  refreshStatus();
                                })
                              }
                            >
                              {p.active ? "Desactivar" : "Activar"}
                            </button>
                            <button
                              className="danger"
                              disabled={!p.templates || busy}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `¿Eliminar los datos faciales de ${p.display_name}? Se conservará su perfil.`,
                                  )
                                )
                                  void action(async () => {
                                    await api(
                                      "/profiles/" + p.id + "/face",
                                      "DELETE",
                                    );
                                    await refreshProfiles();
                                    refreshStatus();
                                  });
                              }}
                            >
                              Eliminar datos faciales
                            </button>
                            <button
                              className="danger"
                              disabled={busy}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `¿Eliminar el perfil de ${p.display_name} y todos sus datos faciales?`,
                                  )
                                )
                                  void action(async () => {
                                    await api("/profiles/" + p.id, "DELETE");
                                    await refreshProfiles();
                                    refreshStatus();
                                  });
                              }}
                            >
                              Eliminar perfil
                            </button>
                          </div>
                        </details>
                      </div>
                    </article>
                  ))
                )}
              </div>
              <div className="pagination">
                <button
                  className="secondary"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - 100))}
                >
                  Anterior
                </button>
                <span>Página {offset / 100 + 1}</span>
                <button
                  className="secondary"
                  disabled={profiles.length < 100}
                  onClick={() => setOffset(offset + 100)}
                >
                  Siguiente
                </button>
              </div>
            </>
          ) : page === "settings" ? (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">ADMINISTRACIÓN</p>
                  <h1>Configuración facial</h1>
                  <p>Los cambios se conservan en este computador.</p>
                </div>
              </div>
              {config && (
                <div className="settings-grid">
                  <section className="panel">
                    <h2>Modelos y presencia</h2>
                    <dl>
                      <dt>Reconocimiento</dt>
                      <dd>{config.model}</dd>
                      <dt>Detector</dt>
                      <dd>{config.detector}</dd>
                      <dt>Landmarks</dt>
                      <dd>{config.landmarks}</dd>
                      <dt>Liveness activo</dt>
                      <dd>Solo en enrolamiento</dd>
                      <dt>Identificación</dt>
                      <dd>Automática, rostro frontal</dd>
                      <dt>Vigencia del reto</dt>
                      <dd>{config.ttl} segundos</dd>
                      <dt>Versión de templates</dt>
                      <dd className="mono">{config.version}</dd>
                    </dl>
                  </section>
                  <form
                    className="panel"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void action(async () => {
                        await api("/settings", "PUT", {
                          threshold: Number(config.threshold),
                          margin: Number(config.margin),
                          minQuality: Number(config.minQuality),
                          duplicateThreshold: Number(config.duplicateThreshold),
                        });
                        setNotice("Configuración guardada.");
                      });
                    }}
                  >
                    <h2>Criterios de comparación</h2>
                    {[
                      ["threshold", "Umbral de coincidencia", 0.45, 0.95],
                      ["margin", "Margen de ambigüedad", 0.05, 0.5],
                      ["minQuality", "Calidad mínima", 0.5, 1],
                      ["duplicateThreshold", "Umbral de duplicado", 0.45, 0.85],
                    ].map(([key, label, min, max]) => (
                      <label key={key}>
                        {label}
                        <input
                          type="number"
                          min={Number(min)}
                          max={Number(max)}
                          step="0.01"
                          required
                          value={config[key as string]}
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              [key as string]: e.target.value,
                            })
                          }
                        />
                      </label>
                    ))}
                    <p className="muted">
                      La similitud no es un porcentaje de certeza. Calibra con
                      personas registradas y desconocidas antes de confiar en
                      los valores. El sistema impide configuraciones que anulan
                      las protecciones mínimas.
                    </p>
                    <button disabled={busy}>Guardar configuración</button>
                  </form>
                </div>
              )}
            </>
          ) : page === "logs" ? (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">ÚLTIMOS 100 EVENTOS · 30 DÍAS</p>
                  <h1>Actividad del laboratorio</h1>
                </div>
                <button
                  className="secondary"
                  onClick={() =>
                    void action(async () => setLogs(await api("/logs")))
                  }
                >
                  Actualizar
                </button>
              </div>
              <div className="panel table-wrap">
                <h2>Identificaciones</h2>
                <table>
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Resultado</th>
                      <th>Presencia</th>
                      <th>Top 1</th>
                      <th>Top 2</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs?.identifications.map((r: any) => (
                      <tr key={r.id}>
                        <td>
                          {new Date(r.created_at).toLocaleString("es-CO")}
                        </td>
                        <td>{r.reason}</td>
                        <td>
                          {r.liveness_passed ? "Validada" : "Sin reto activo"}
                        </td>
                        <td>{r.score?.toFixed(3) ?? "—"}</td>
                        <td>{r.second_score?.toFixed(3) ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {logs?.identifications.length === 0 && (
                  <p className="muted">Todavía no hay identificaciones.</p>
                )}
                <h2>Administración</h2>
                <table>
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs?.actions.map((r: any) => (
                      <tr key={r.id}>
                        <td>
                          {new Date(r.created_at).toLocaleString("es-CO")}
                        </td>
                        <td>{r.action}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="empty panel">
              <h1>Cámara cerrada</h1>
              <button onClick={() => go("identify")}>
                Abrir identificación
              </button>
            </div>
          )}
        </div>
      </main>
      {edit && (
        <div className="modal-backdrop">
          <section
            className="modal panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-title"
          >
            <h2 id="edit-title">
              {edit === "new" ? "Crear perfil" : "Editar perfil"}
            </h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void action(async () => {
                  await api(
                    edit === "new" ? "/profiles" : "/profiles/" + edit.id,
                    edit === "new" ? "POST" : "PATCH",
                    {
                      display_name: name,
                      external_reference: reference || null,
                    },
                  );
                  setEdit(null);
                  await refreshProfiles();
                  refreshStatus();
                });
              }}
            >
              <label>
                Nombre
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                  required
                />
              </label>
              <label>
                Referencia externa <span className="muted">(opcional)</span>
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  maxLength={100}
                />
              </label>
              <div className="form-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setEdit(null)}
                >
                  Cancelar
                </button>
                <button disabled={busy}>
                  {busy ? "Guardando…" : "Guardar perfil"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
