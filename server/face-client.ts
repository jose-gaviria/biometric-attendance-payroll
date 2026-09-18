import { z } from "zod";
import { config } from "./config.js";
const vector = z.array(z.number().finite()).length(128);
export const analysisSchema = z.object({
  face_count: z.number().int().min(0),
  accepted: z.boolean(),
  reason: z.string(),
  digest: z.string().length(64),
  model_name: z.literal("SFace"),
  model_version: z.string(),
  embedding: vector.optional(),
  quality_score: z.number().min(0).max(1).optional(),
  ear: z.number().finite().optional(),
  yaw: z.number().finite().optional(),
  box: z.array(z.number()).optional(),
  landmarks: z.array(z.array(z.number())).optional(),
  timings: z.record(z.string(), z.number().finite()),
});
export type Analysis = z.infer<typeof analysisSchema>;
export class ServiceUnavailable extends Error {}
export async function faceHealth(url = config.FACE_SERVICE_URL) {
  try {
    const response = await fetch(url + "/health", {
      signal: AbortSignal.timeout(config.FACE_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new ServiceUnavailable();
    return z
      .object({
        status: z.literal("healthy"),
        models: z.object({
          detector: z.literal(true),
          recognizer: z.literal(true),
          landmarks: z.literal(true),
        }),
        model_name: z.literal("SFace"),
        model_version: z.string(),
        dimension: z.literal(128),
      })
      .parse(await response.json());
  } catch {
    throw new ServiceUnavailable("face_service_unavailable");
  }
}
export async function analyze(
  image: string,
  url = config.FACE_SERVICE_URL,
): Promise<Analysis> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url + "/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image }),
        signal: AbortSignal.timeout(config.FACE_REQUEST_TIMEOUT_MS),
      });
      if (response.status === 422) throw new Error("invalid_image");
      if (!response.ok) throw new ServiceUnavailable();
      return analysisSchema.parse(await response.json());
    } catch (error) {
      if (error instanceof Error && error.message === "invalid_image")
        throw error;
      if (attempt === 1)
        throw new ServiceUnavailable("face_service_unavailable");
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new ServiceUnavailable();
}
