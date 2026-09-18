import { resolve } from "node:path";
import { openDatabase, decode } from "../server/db.js";
import { cosine, rank, type Candidate } from "../server/matching.js";
import { config } from "../server/config.js";
export function calibration(profiles: Candidate[]) {
  const genuine: number[] = [],
    impostor: number[] = [],
    trials: any[] = [];
  for (const p of profiles)
    for (let i = 0; i < p.vectors.length; i++) {
      for (let j = i + 1; j < p.vectors.length; j++)
        genuine.push(cosine(p.vectors[i], p.vectors[j]));
      for (const other of profiles)
        if (p.id < other.id)
          for (const v of other.vectors) impostor.push(cosine(p.vectors[i], v));
      const leaveOneOut = profiles.map((o) => ({
        ...o,
        vectors:
          o.id === p.id ? o.vectors.filter((_, j) => j !== i) : o.vectors,
      }));
      const results = rank([p.vectors[i]], leaveOneOut);
      trials.push({
        expected: p.id,
        top1: results[0]?.id,
        score: results[0]?.score,
        top2: results[1]?.id,
        second_score: results[1]?.score,
        margin: results.length > 1 ? results[0].score - results[1].score : null,
      });
    }
  const stats = (a: number[]) =>
    a.length
      ? {
          count: a.length,
          min: Math.min(...a),
          mean: a.reduce((x, y) => x + y, 0) / a.length,
          max: Math.max(...a),
        }
      : null;
  const g = stats(genuine),
    im = stats(impostor),
    separable = !!g && !!im && g.min > im.max + 0.05;
  const threshold = separable ? Math.max(0.5, im!.max + 0.05) : null;
  const margins = trials
    .filter((t) => t.top1 === t.expected && t.margin !== null)
    .map((t) => t.margin);
  return {
    profiles: profiles.length,
    genuine: g,
    impostor: im,
    trials,
    suggested_threshold: threshold,
    suggested_ambiguity_margin:
      separable && margins.length
        ? Math.max(0.08, Math.min(...margins) * 0.5)
        : null,
    warning: separable
      ? "Estimación interna optimista: validar con nuevas sesiones y desconocidos."
      : "Datos insuficientes o distribuciones solapadas. No se recomienda un umbral automático.",
  };
}
if (process.argv[1]?.includes("calibrate-face-threshold")) {
  const db = openDatabase(resolve(config.DATA_DIR, "face-lab.sqlite"));
  const rows = db
    .prepare(
      `SELECT p.id,p.display_name,t.embedding,t.model_version FROM face_profiles p JOIN face_templates t ON p.id=t.profile_id WHERE p.active=1 AND t.active=1 AND t.model_name='SFace'`,
    )
    .all() as {
    id: string;
    display_name: string;
    embedding: Buffer;
    model_version: string;
  }[];
  const versions = [...new Set(rows.map((r) => r.model_version))];
  const reports = versions.map((version) => {
    const map = new Map<string, Candidate>();
    for (const r of rows.filter((r) => r.model_version === version)) {
      const p = map.get(r.id) ?? {
        id: r.id,
        name: r.display_name,
        vectors: [],
      };
      p.vectors.push(decode(r.embedding));
      map.set(r.id, p);
    }
    return { model_version: version, ...calibration([...map.values()]) };
  });
  console.log(
    JSON.stringify(
      {
        reports,
        notes:
          "Sin fotos ni vectores en este informe. No incluye personas desconocidas no capturadas.",
      },
      null,
      2,
    ),
  );
  db.close();
}
