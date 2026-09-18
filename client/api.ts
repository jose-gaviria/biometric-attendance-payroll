export const messages: Record<string, string> = {
  no_face: "Colócate frente a la cámara.",
  multiple_faces: "Debe haber una sola persona frente a la cámara.",
  too_small: "Acércate un poco más.",
  position: "Mantén tu rostro dentro del marco.",
  dark: "Necesitamos un poco más de iluminación.",
  overexposed: "Evita una luz intensa directamente detrás de ti.",
  blur: "Mantén el rostro quieto.",
  pose: "Mira al frente, sin inclinar demasiado la cabeza.",
  landmarks: "No vemos bien tus ojos. Mira al frente.",
  quality: "Necesitamos una imagen más clara.",
  frontal: "Mira al frente y mantén el rostro quieto hasta capturar la muestra.",
  sample_left: "Gira lentamente a tu izquierda y mantén esa posición.",
  sample_right: "Gira lentamente a tu derecha y mantén esa posición.",
  challenge_expired: "Se agotó el tiempo. Volvamos a intentarlo.",
  challenge_used: "Este intento ya terminó. Inicia uno nuevo.",
  challenge_invalid: "El intento ya no está disponible.",
  person_changed: "La persona cambió durante el intento. Intenta nuevamente.",
  repeated_frame: "No se detectan imágenes nuevas de la cámara.",
  duplicate:
    "Este rostro parece estar asociado a otro perfil existente. Revise los perfiles antes de continuar.",
  profile_changed: "El perfil cambió. Vuelve a iniciar el registro.",
  insufficient_variation:
    "Necesitamos más variación de pose. Vuelve a registrar el rostro.",
  face_service_unavailable:
    "Servicio de reconocimiento facial temporalmente no disponible.",
  internal_error: "No pudimos completar la operación. Intenta nuevamente.",
  invalid_credentials: "La contraseña no es correcta.",
  login_required: "Inicia sesión para continuar.",
  admin_required: "Esta acción requiere una sesión administrativa.",
  invalid_input: "Revisa los datos introducidos.",
  invalid_image: "No pudimos procesar la imagen.",
  image_too_large: "La imagen supera el tamaño permitido.",
  login_rate_limit:
    "Demasiados intentos. Espera 15 minutos antes de volver a iniciar sesión.",
  rate_limit: "Demasiadas solicitudes. Espera un momento.",
  busy: "El servicio está ocupado. Intenta nuevamente.",
  network: "No hay conexión con la aplicación local.",
  setup_required: "Crea el administrador con configurar-admin.bat.",
  consent_and_admin_required:
    "El registro requiere consentimiento y sesión administrativa.",
};
export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(
      messages[code] ??
        "No pudimos completar la operación. Intenta nuevamente.",
    );
  }
}
export async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/api" + path, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(14000),
    });
  } catch {
    throw new ApiError("network", 0);
  }
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(data.error ?? "internal_error", response.status);
  return data as T;
}
