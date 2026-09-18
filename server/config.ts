import { z } from "zod";
const boolean = z.enum(["true", "false"]).transform((v) => v === "true");
const env = z.object({
  PORT: z.coerce.number().int().min(1024).max(65535).default(8080),
  APP_ORIGIN: z.string().url().default("http://localhost:8091"),
  DATA_DIR: z.string().default("runtime/data"),
  BACKUP_DIR: z.string().default("runtime/backups"),
  FACE_SERVICE_URL: z.string().url().default("http://127.0.0.1:5001"),
  FACE_MATCH_THRESHOLD: z.coerce.number().min(0.45).max(0.95).default(0.5),
  FACE_AMBIGUITY_MARGIN: z.coerce.number().min(0.05).max(0.5).default(0.08),
  FACE_DUPLICATE_THRESHOLD: z.coerce
    .number()
    .min(0.45)
    .max(0.85)
    .default(0.55),
  FACE_MIN_QUALITY: z.coerce.number().min(0.5).max(1).default(0.55),
  FACE_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(500)
    .max(15000)
    .default(5000),
  FACE_LIVENESS_CHALLENGE_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(30)
    .max(60)
    .default(45),
  FACE_LIVENESS_ENABLED: boolean
    .default(true)
    .refine((v) => v, "Este laboratorio requiere liveness activo"),
  FACE_DEBUG: boolean.default(false),
});
export const config = env.parse(process.env);
// localhost y 127.0.0.1 son el mismo equipo: aceptar ambos evita rechazar la
// misma instalacion segun como se escriba la direccion en el navegador.
export const appOrigins = (() => {
  const configured = new URL(config.APP_ORIGIN);
  const origins = new Set([configured.origin]);
  if (["localhost", "127.0.0.1"].includes(configured.hostname)) {
    configured.hostname =
      configured.hostname === "localhost" ? "127.0.0.1" : "localhost";
    origins.add(configured.origin);
  }
  return origins;
})();
export const settingsSchema = z
  .object({
    threshold: z.number().min(0.45).max(0.95),
    margin: z.number().min(0.05).max(0.5),
    minQuality: z.number().min(0.5).max(1),
    duplicateThreshold: z.number().min(0.45).max(0.85),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.duplicateThreshold > value.threshold + 0.15)
      context.addIssue({
        code: "custom",
        path: ["duplicateThreshold"],
        message: "El umbral de duplicado no puede desactivar la protección",
      });
  });
export type Settings = z.infer<typeof settingsSchema>;
