import { useEffect, useRef, useState } from 'react';
import { api, ApiError, messages } from './api';
type Metrics = {
  box?: [number, number, number, number];
  landmarks?: [number, number][];
  [key: string]: unknown;
};
type FrameResult = {
  status: string;
  samples?: number;
  debug?: Metrics;
  reason: string;
  stage?: string;
  accepted: boolean;
  name?: string;
  attendance?: { employee: string; action: string; timestamp: string };
  attendance_error?: string;
};
type Props = {
  profile?: { id: string; display_name: string };
  debug: boolean;
  action?: 'in' | 'out';
  onClose: () => void;
  onEnrolled: () => void;
  onSuccess?: (attendance: Attendance) => void;
  onFallback?: (state: Fallback) => void;
};
export type Attendance = {
  employee: string;
  action: 'in' | 'out';
  timestamp: string;
};
export type Fallback = {
  action: 'in' | 'out';
  failures: number;
  allowed: boolean;
  expires_at: number | null;
};
type Challenge = {
  id: string;
  nonce: string;
  type: 'blink' | 'left' | 'right';
  expires_at: number;
  required: number;
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const cameraError = (error: unknown) => {
  const name = (error as DOMException).name;
  return name === 'NotAllowedError'
    ? 'Permiso de cámara rechazado. Habilítalo en la barra de direcciones y vuelve a intentar.'
    : name === 'NotFoundError'
      ? 'No se encontró una cámara conectada.'
      : name === 'NotReadableError'
        ? 'La cámara está ocupada o no se puede abrir. Cierra otras aplicaciones que la utilicen.'
        : name === 'OverconstrainedError'
          ? 'La cámara seleccionada no está disponible. Selecciona otra.'
          : 'No pudimos abrir la cámara. Comprueba la conexión y los permisos.';
};
export function Camera({
  profile,
  debug,
  action,
  onClose,
  onEnrolled,
  onSuccess,
  onFallback,
}: Props) {
  const video = useRef<HTMLVideoElement>(null),
    overlay = useRef<HTMLCanvasElement>(null),
    streamRef = useRef<MediaStream | null>(null),
    challengeRef = useRef<Challenge | null>(null);
  const guidanceRef = useRef({ key: '', shownAt: 0 });
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]),
    [device, setDevice] = useState(''),
    [retry, setRetry] = useState(0),
    [enabled, setEnabled] = useState(!profile),
    [consent, setConsent] = useState(false);
  const [state, setState] = useState('BUSCANDO ROSTRO'),
    [instruction, setInstruction] = useState('Colócate frente a la cámara'),
    [samples, setSamples] = useState(0),
    [error, setError] = useState(''),
    [result, setResult] = useState<{
      accepted: boolean;
      name?: string;
      reason: string;
    } | null>(null),
    [metrics, setMetrics] = useState<Metrics | null>(null),
    [remaining, setRemaining] = useState<number | null>(null);
  const enrolled = useRef(onEnrolled);
  const callbacks = useRef({ onSuccess, onFallback });
  const [failures, setFailures] = useState(0);
  useEffect(() => {
    callbacks.current = { onSuccess, onFallback };
  }, [onSuccess, onFallback]);
  useEffect(() => {
    enrolled.current = onEnrolled;
  }, [onEnrolled]);
  useEffect(() => {
    if (!enabled) return;
    let stopped = false,
      active: MediaStream | null = null;
    let attemptId: string | null = null;
    const alive = () => !stopped;
    const guide = (key: string, text: string, immediate = false) => {
      const now = Date.now(),
        shown = guidanceRef.current;
      if (!immediate && shown.key && shown.key !== key && now - shown.shownAt < 1200)
        return;
      if (immediate || shown.key !== key) {
        guidanceRef.current = { key, shownAt: now };
        setInstruction(text);
      }
    };
    async function checkFallback() {
      if (profile || !alive()) return;
      const state = await api<Fallback>('/fallback?action=' + action);
      if (!alive()) return;
      setFailures(state.failures);
      if (state.allowed) {
        stopped = true;
        active?.getTracks().forEach((t) => t.stop());
        callbacks.current.onFallback?.(state);
      }
    }
    async function reportCameraFailure(reason: string) {
      if (profile || !attemptId || !alive()) return;
      await api('/attempts/' + attemptId + '/camera-error', 'POST', { reason });
      await checkFallback();
    }
    const tick = setInterval(
      () =>
        setRemaining(
          challengeRef.current
            ? Math.max(
                0,
                Math.ceil(
                  (challengeRef.current.expires_at - Date.now()) / 1000,
                ),
              )
            : null,
        ),
      250,
    );
    async function start() {
      try {
        setError('');
        setResult(null);
        setSamples(0);
        if (!profile) {
          await checkFallback();
          if (!alive()) return;
          attemptId = (
            await api<{ id: string }>('/attempts', 'POST', { action })
          ).id;
          if (!alive()) return;
        }
        if (!navigator.mediaDevices?.getUserMedia)
          throw new Error('unsupported');
        active = await navigator.mediaDevices.getUserMedia({
          video: {
            ...(device
              ? { deviceId: { exact: device } }
              : { facingMode: 'user' }),
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
          audio: false,
        });
        if (!alive()) {
          active.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = active;
        active.getVideoTracks()[0].onended = () => {
          setError('La cámara se desconectó. Conéctala y pulsa Reintentar.');
          void reportCameraFailure('disconnected')
            .catch(() => {})
            .finally(() => {
              stopped = true;
              active?.getTracks().forEach((t) => t.stop());
            });
        };
        setDevices(
          (await navigator.mediaDevices.enumerateDevices()).filter(
            (d) => d.kind === 'videoinput',
          ),
        );
        if (!video.current) return;
        video.current.srcObject = active;
        await video.current.play();
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 480;
        const ctx = canvas.getContext('2d', { alpha: false })!;
        while (alive()) {
          try {
            setSamples(0);
            setResult(null);
            setState('BUSCANDO ROSTRO');
            guide(
              profile ? 'enroll:start' : 'identify:start',
              profile
                ? 'Paso 1 de 3: mira al frente, abre los ojos y mantén la cabeza quieta.'
                : 'Mira al frente. La marcación es automática.',
              true,
            );
            if (!profile && !attemptId)
              attemptId = (
                await api<{ id: string }>('/attempts', 'POST', { action })
              ).id;
            if (!alive()) break;
            const challenge = await api<Challenge>('/challenges', 'POST', {
              purpose: profile ? 'enroll' : 'identify',
              ...(!profile ? { action, attempt_id: attemptId } : {}),
              ...(profile ? { profile_id: profile.id, consent: true } : {}),
            });
            if (!alive()) {
              await api('/challenges/' + challenge.id, 'DELETE').catch(
                () => {},
              );
              break;
            }
            challengeRef.current = challenge;
            let complete = false;
            while (alive() && !complete) {
              const v = video.current;
              if (!v || v.readyState < 2) {
                if (!profile && Date.now() > challenge.expires_at) {
                  setError(
                    'La cámara no está enviando imágenes. Pulsa Reintentar.',
                  );
                  await reportCameraFailure('NotReadableError');
                  stopped = true;
                  active?.getTracks().forEach((t) => t.stop());
                  break;
                }
                await sleep(120);
                continue;
              }
              // Letterbox instead of stretching cameras with different aspect ratios.
              const ratio = Math.min(640 / v.videoWidth, 480 / v.videoHeight),
                w = v.videoWidth * ratio,
                h = v.videoHeight * ratio;
              ctx.fillStyle = '#000';
              ctx.fillRect(0, 0, 640, 480);
              ctx.drawImage(v, (640 - w) / 2, (480 - h) / 2, w, h);
              const image = canvas.toDataURL('image/jpeg', 0.78).split(',')[1];
              const data = await api<FrameResult>(
                '/challenges/' + challenge.id + '/frame',
                'POST',
                { nonce: challenge.nonce, image },
              );
              if (!alive()) break;
              setError('');
              setSamples(data.samples ?? 0);
              setMetrics(data.debug ?? null);
              if (overlay.current) {
                const draw = overlay.current.getContext('2d')!;
                draw.clearRect(0, 0, 640, 480);
                if (debug && data.debug?.box) {
                  draw.strokeStyle = '#34d399';
                  draw.lineWidth = 2;
                  draw.strokeRect(
                    ...(data.debug.box as [number, number, number, number]),
                  );
                  for (const point of data.debug.landmarks ?? []) {
                    draw.beginPath();
                    draw.arc(point[0], point[1], 3, 0, Math.PI * 2);
                    draw.fillStyle = '#fbbf24';
                    draw.fill();
                  }
                }
              }
              if (data.status === 'quality') {
                setState(
                  data.stage === 'baseline'
                    ? 'BUSCANDO ROSTRO'
                    : 'VALIDANDO PRESENCIA',
                );
                guide(
                  `quality:${data.reason}`,
                  messages[data.reason] ??
                    'Ajusta tu posición y mantente quieto.',
                );
              } else if (data.status === 'liveness') {
                setState('VALIDANDO PRESENCIA');
                guide(
                  `liveness:${data.stage}:${challenge.type}`,
                  data.stage === 'baseline'
                    ? 'Paso 1 de 3: mira al frente, abre los ojos y mantén la cabeza quieta.'
                    : data.stage === 'action'
                      ? challenge.type === 'blink'
                        ? 'Paso 2 de 3: parpadea una vez y vuelve a abrir los ojos.'
                        : challenge.type === 'left'
                          ? 'Paso 2 de 3: gira lentamente a tu izquierda y mantén esa posición.'
                          : 'Paso 2 de 3: gira lentamente a tu derecha y mantén esa posición.'
                      : data.stage === 'return'
                        ? 'Paso 3 de 3: vuelve al frente, abre los ojos y mantente quieto.'
                        : 'Presencia confirmada. Ahora tomaremos seis muestras; sigue cada indicación.',
                  true,
                );
              } else if (data.status === 'sampling') {
                setState(
                  profile
                    ? `MUESTRA ${Math.min((data.samples ?? 0) + 1, 6)} DE 6`
                    : 'IDENTIFICANDO',
                );
                const next = data.samples ?? 0;
                guide(
                  `sampling:${next}:${data.reason}`,
                  messages[data.reason] ??
                    (profile && next === 1
                      ? 'Gira lentamente a tu izquierda y mantén esa posición.'
                      : profile && next === 3
                        ? 'Gira lentamente a tu derecha y mantén esa posición.'
                        : 'Mira al frente y mantén el rostro quieto hasta capturar la muestra.'),
                );
              } else if (data.status === 'enrolled') {
                setState('ROSTRO REGISTRADO');
                guide(
                  'enrolled',
                  'Las seis muestras quedaron guardadas en este computador.',
                  true,
                );
                complete = true;
                stopped = true;
                enrolled.current();
                active?.getTracks().forEach((t) => t.stop());
              } else if (data.status === 'rejected') {
                setState('REGISTRO NO COMPLETADO');
                setError(
                  messages[data.reason] ?? 'No pudimos completar el registro.',
                );
                complete = true;
                stopped = true;
                active?.getTracks().forEach((t) => t.stop());
              } else if (data.status === 'result') {
                setState(
                  data.accepted
                    ? 'PERSONA IDENTIFICADA'
                    : data.reason === 'unknown'
                      ? 'PERSONA NO RECONOCIDA'
                      : 'IDENTIDAD NO CONFIRMADA',
                );
                setResult({
                  ...data,
                  name: data.attendance?.employee ?? data.name,
                  accepted: !!data.attendance,
                });
                if (data.attendance || data.accepted) {
                  stopped = true;
                  active?.getTracks().forEach((t) => t.stop());
                  if (data.attendance)
                    callbacks.current.onSuccess?.(
                      data.attendance as Attendance,
                    );
                  setState(
                    data.attendance
                      ? data.attendance.action === 'in'
                        ? 'ENTRADA REGISTRADA'
                        : 'SALIDA REGISTRADA'
                      : 'MARCACIÓN NO REGISTRADA',
                  );
                }
                guide(
                  'result',
                  data.accepted
                    ? data.attendance
                      ? `Registrada a las ${new Date(data.attendance.timestamp).toLocaleTimeString('es-CO')}`
                      : (data.attendance_error ??
                        'No se registró la marcación. Consulta al administrador.')
                    : data.reason === 'unknown'
                      ? 'No encontramos una coincidencia suficientemente confiable.'
                      : 'No fue posible confirmar la identidad. Intenta nuevamente.',
                  true,
                );
                complete = true;
                if (!data.accepted) await checkFallback();
              }
              if (!complete)
                await sleep(
                  challenge.type === 'blink' && data.stage === 'action'
                    ? 85
                    : 130,
                );
            }
            challengeRef.current = null;
            attemptId = null;
            if (!profile && alive()) await sleep(3000);
          } catch (err) {
            if (!alive()) break;
            const failure = err as ApiError;
            setError(failure.message);
            setState('INTENTO INTERRUMPIDO');
            await checkFallback().catch(() => {});
            if (challengeRef.current)
              await api(
                '/challenges/' + challengeRef.current.id,
                'DELETE',
              ).catch(() => {});
            challengeRef.current = null;
            attemptId = null;
            if (!alive()) break;
            if (failure.status === 401 || failure.status === 403) {
              stopped = true;
              active?.getTracks().forEach((t) => t.stop());
              break;
            }
            await sleep(
              failure.code === 'face_service_unavailable' ? 4000 : 2000,
            );
          }
        }
      } catch (err) {
        if (alive()) {
          setError(
            err instanceof ApiError
              ? err.message
              : (err as Error).message === 'unsupported'
                ? 'Este navegador no permite usar la cámara. Abre la aplicación en Chrome o Edge desde localhost.'
                : cameraError(err),
          );
          active?.getTracks().forEach((t) => t.stop());
          if (!(err instanceof ApiError))
            await reportCameraFailure(
              (err as Error).message === 'unsupported'
                ? 'unsupported'
                : (err as DOMException).name,
            ).catch(() => {});
        }
      }
    }
    void start();
    const devicesChanged = () => {
      void navigator.mediaDevices?.enumerateDevices().then((all) => {
        if (alive()) setDevices(all.filter((d) => d.kind === 'videoinput'));
      });
    };
    navigator.mediaDevices?.addEventListener('devicechange', devicesChanged);
    return () => {
      stopped = true;
      clearInterval(tick);
      active?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      navigator.mediaDevices?.removeEventListener(
        'devicechange',
        devicesChanged,
      );
      const c = challengeRef.current;
      challengeRef.current = null;
      if (c) void api('/challenges/' + c.id, 'DELETE').catch(() => {});
    };
  }, [enabled, device, retry, profile, debug, action]);
  return (
    <section className="camera-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            {profile ? 'ENROLAMIENTO VOLUNTARIO' : 'KIOSCO LOCAL'}
          </p>
          <h1>
            {profile
              ? 'Registrar rostro'
              : action === 'in'
                ? 'Registrar entrada con rostro'
                : 'Registrar salida con rostro'}
          </h1>
          {profile && <p>{profile.display_name}</p>}
        </div>
        <button className="secondary" onClick={onClose}>
          Cerrar cámara
        </button>
      </div>
      {profile && !enabled ? (
        <div className="consent panel">
          <h2>Tu rostro permanece en este equipo</h2>
          <p>
            Capturaremos seis muestras para identificarte y registrar tus
            entradas y salidas. Se guardan representaciones numéricas del
            rostro; las fotos y el video no se conservan.
          </p>
          <p>
            El administrador puede eliminar tus datos faciales desde Rostros. El
            registro es voluntario.
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            Acepto registrar mis datos faciales para identificarme y registrar
            mis entradas y salidas.
          </label>
          <button disabled={!consent} onClick={() => setEnabled(true)}>
            Aceptar y abrir cámara
          </button>
        </div>
      ) : (
        <>
          <div className="camera-layout">
            <div
              className={'viewfinder ' + (result?.accepted ? 'success' : '')}
            >
              <video ref={video} muted playsInline className="mirrored" />
              <canvas
                ref={overlay}
                width="640"
                height="480"
                className="overlay mirrored"
              />
              {!result && (
                <div className="face-guide" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
              )}
              <div className="camera-label">
                <span className="dot" /> Cámara local
              </div>
              {result && (
                <div
                  className={
                    'result-overlay ' + (result.accepted ? 'recognized' : '')
                  }
                >
                  <div className="result-symbol">
                    {result.accepted ? '✓' : '—'}
                  </div>
                  <strong>
                    {result.accepted ? result.name : 'Marcación no registrada'}
                  </strong>
                  <span>
                    {result.accepted
                      ? 'Marcación registrada'
                      : 'Intenta nuevamente'}
                  </span>
                </div>
              )}
            </div>
            <div className="capture-panel panel" aria-live="polite">
              <span className="eyebrow">
                {remaining !== null ? `INTENTO · ${remaining} S` : 'CÁMARA'}
              </span>
              <h2>{state}</h2>
              <p className="instruction">{instruction}</p>
              {!profile && (
                <p className="muted">
                  Intentos fallidos: {failures} de 3. El PIN se habilita solo si
                  los tres fallan.
                </p>
              )}
              <div className="steps">
                <div className={'step ' + (samples > 0 ? 'done' : '')}>
                  01 <span>Detectar rostro</span>
                </div>
                <div className={'step ' + (samples > 0 ? 'done' : '')}>
                  02{' '}
                  <span>
                    {profile ? 'Validar presencia' : 'Comprobar imagen'}
                  </span>
                </div>
                <div className="step">
                  03{' '}
                  <span>
                    {profile ? 'Registrar muestras' : 'Comparar perfiles'}
                  </span>
                </div>
              </div>
              <div className="sample-dots">
                {Array.from({ length: profile ? 6 : 4 }, (_, i) => (
                  <span key={i} className={i < samples ? 'filled' : ''} />
                ))}
              </div>
              <span className="muted">
                {samples} / {profile ? 6 : 4} muestras válidas
              </span>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <button
                className="secondary"
                onClick={() => {
                  setError('');
                  setRetry((n) => n + 1);
                }}
              >
                Reintentar
              </button>
            </div>
          </div>
          <div className="camera-toolbar">
            <label>
              Cámara
              <select
                aria-label="Seleccionar cámara"
                value={device}
                onChange={(e) => setDevice(e.target.value)}
              >
                <option value="">Predeterminada</option>
                {devices.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Cámara ${i + 1}`}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted">
              Una persona a la vez. Buena luz y rostro descubierto.
            </p>
          </div>
          {debug && metrics && (
            <details className="panel">
              <summary>Diagnóstico del administrador</summary>
              <pre>{JSON.stringify(metrics, null, 2)}</pre>
            </details>
          )}
        </>
      )}
    </section>
  );
}
