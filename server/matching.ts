export type Vector = number[];
export type Candidate = { id: string; name: string; vectors: Vector[] };
export const cosine = (a: Vector, b: Vector) =>
  a.reduce((s, x, i) => s + x * b[i], 0);
export function vectorValid(v: unknown): v is Vector {
  return (
    Array.isArray(v) &&
    v.length === 128 &&
    v.every((x) => typeof x === "number" && Number.isFinite(x)) &&
    Math.abs(Math.hypot(...v) - 1) < 0.01
  );
}
export const median = (values: number[]) => {
  const a = [...values].sort((x, y) => x - y);
  return a.length % 2
    ? a[Math.floor(a.length / 2)]
    : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
};
export function scoreProfile(query: Vector, profile: Candidate) {
  const best = profile.vectors
    .map((v) => cosine(query, v))
    .sort((a, b) => b - a)
    .slice(0, 2);
  return best.reduce((a, b) => a + b, 0) / best.length;
}
export function rank(queries: Vector[], profiles: Candidate[]) {
  return profiles
    .filter((p) => p.vectors.length)
    .map((p) => ({
      ...p,
      score: median(queries.map((q) => scoreProfile(q, p))),
    }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
export function identify(
  queries: Vector[],
  profiles: Candidate[],
  threshold: number,
  margin: number,
) {
  if (queries.length < 3 || queries.some((q) => !vectorValid(q)))
    throw new Error("Invalid query sequence");
  const sorted = rank(queries, profiles),
    first = sorted[0],
    second = sorted[1];
  let reason = "identified";
  if (!first || first.score < threshold) reason = "unknown";
  else if (second && first.score - second.score < margin) reason = "ambiguous";
  else if (
    queries.some((q) => {
      const r = rank([q], profiles);
      return (
        r[0].id !== first.id ||
        r[0].score < threshold ||
        (r[1] && r[0].score - r[1].score < margin)
      );
    })
  )
    reason = "inconsistent";
  return {
    accepted: reason === "identified",
    reason,
    profile_id: reason === "identified" ? first.id : null,
    name: reason === "identified" ? first.name : null,
    score: first?.score ?? null,
    second_score: second?.score ?? null,
    margin: first && second ? first.score - second.score : null,
  };
}
export function possibleDuplicate(
  queries: Vector[],
  profiles: Candidate[],
  threshold: number,
) {
  // Conservative: any new sample strongly matches any existing template.
  return profiles.some((p) =>
    queries.some((q) => p.vectors.some((v) => cosine(q, v) >= threshold)),
  );
}
