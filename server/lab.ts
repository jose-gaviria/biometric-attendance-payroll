import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { type DB, audit, encode, gallery, settings } from "./db.js";
import { config } from "./config.js";
import { analyze, faceHealth, type Analysis } from "./face-client.js";
import {
  identify,
  possibleDuplicate,
  vectorValid,
  type Candidate,
} from "./matching.js";
import {
  initialLive,
  observe,
  checkContinuity,
  continuityThreshold,
  PASSED_INSTRUCTION_MS,
  pauseForInvalidFrame,
  type ChallengeType,
  type LiveState,
} from "./liveness.js";

export class LabError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}
type Challenge = {
  id: string;
  nonce: string;
  type: ChallengeType;
  expires_at: number;
  used: number;
  session_id: string;
  purpose: "enroll" | "identify";
  profile_id: string | null;
};
type Run = {
  live: LiveState;
  samples: Analysis[];
  busy: boolean;
  lastFrame: number;
  lastSample: number;
  frames: number;
  profileUpdated?: number;
  version: string;
  sampleTarget: number;
  samplePromptedAt: number;
};
const ENROLL_SAMPLE_INSTRUCTION_MS = 1200;
const samplePose = (index: number) => [0, 0.075, 0, -0.075, 0, 0][index] ?? 0;
const sampleReason = (index: number) => {
  const pose = samplePose(index);
  return pose > 0 ? "sample_left" : pose < 0 ? "sample_right" : "frontal";
};
export class Lab {
  runs = new Map<string, Run>();
  cache: Candidate[] | null = null;
  version = "";
  constructor(public db: DB) {}
  invalidate() {
    this.cache = null;
  }
  getGallery() {
    return (this.cache ??= gallery(this.db, this.version));
  }
  async health() {
    const result = await faceHealth();
    if (result.model_version !== this.version) {
      this.version = result.model_version;
      this.invalidate();
    }
    return result;
  }
  reap() {
    for (const [id, run] of this.runs)
      if (
        Date.now() - run.live.started >
        config.FACE_LIVENESS_CHALLENGE_TTL_SECONDS * 1000
      )
        this.runs.delete(id);
  }
  cancel(id: string, session: string) {
    this.db
      .prepare("UPDATE face_challenges SET used=1 WHERE id=? AND session_id=?")
      .run(id, session);
    this.runs.delete(id);
  }
  cancelSession(session: string) {
    const ids = this.db
      .prepare("SELECT id FROM face_challenges WHERE session_id=? AND used=0")
      .all(session) as { id: string }[];
    for (const c of ids) this.cancel(c.id, session);
  }
  async create(
    session: string,
    purpose: "enroll" | "identify",
    profileId?: string,
  ) {
    this.reap();
    await this.health();
    let updated: number | undefined;
    if (purpose === "enroll") {
      const profile = this.db
        .prepare("SELECT active,updated_at FROM face_profiles WHERE id=?")
        .get(profileId) as { active: number; updated_at: number } | undefined;
      if (!profile || !profile.active)
        throw new LabError("profile_unavailable", 404);
      updated = profile.updated_at;
    }
    this.cancelSession(session);
    if (this.runs.size >= 8) throw new LabError("busy", 429);
    const id = randomUUID(),
      nonce = randomBytes(32).toString("hex"),
      type = (["blink", "left", "right"] as const)[randomInt(3)],
      now = Date.now(),
      expires = now + config.FACE_LIVENESS_CHALLENGE_TTL_SECONDS * 1000;
    this.db
      .prepare(
        "INSERT INTO face_challenges(id,nonce,type,created_at,expires_at,session_id,purpose,profile_id,capture_mode) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        nonce,
        type,
        now,
        expires,
        session,
        purpose,
        profileId ?? null,
        purpose === "enroll" ? "active" : "frontal",
      );
    this.runs.set(id, {
      live: initialLive(now),
      samples: [],
      busy: false,
      lastFrame: 0,
      lastSample: 0,
      frames: 0,
      profileUpdated: updated,
      version: this.version,
      sampleTarget: 0,
      samplePromptedAt: 0,
    });
    return {
      id,
      nonce,
      type,
      mode: purpose === "enroll" ? "active" : "frontal",
      expires_at: expires,
      required: purpose === "enroll" ? 6 : 4,
    };
  }
  challenge(id: string, nonce: string, session: string): Challenge {
    const c = this.db
      .prepare(
        "SELECT * FROM face_challenges WHERE id=? AND nonce=? AND session_id=?",
      )
      .get(id, nonce, session) as Challenge | undefined;
    if (!c) throw new LabError("challenge_invalid", 404);
    if (c.used) throw new LabError("challenge_used", 409);
    if (c.expires_at <= Date.now()) {
      this.cancel(id, session);
      throw new LabError("challenge_expired", 410);
    }
    return c;
  }
  async frame(
    id: string,
    nonce: string,
    session: string,
    image: string,
    admin: boolean,
  ) {
    const c = this.challenge(id, nonce, session),
      run = this.runs.get(id);
    if (!run) throw new LabError("challenge_invalid", 410);
    if (run.busy) throw new LabError("frame_in_progress", 409);
    if (Date.now() - run.lastFrame < 90) throw new LabError("too_fast", 429);
    if (++run.frames > 150) {
      this.cancel(id, session);
      throw new LabError("too_many_frames", 429);
    }
    run.busy = true;
    run.lastFrame = Date.now();
    const started = performance.now();
    try {
      const result = await analyze(image);
      this.challenge(id, nonce, session); // Also expires or cancels while inference is running.
      if (result.model_version !== run.version)
        throw new LabError("model_changed", 409);
      const cfg = settings(this.db),
        quality = cfg.minQuality,
        continuity = continuityThreshold(cfg.threshold);
      const debug =
        admin && config.FACE_DEBUG
          ? {
              box: result.box,
              landmarks: result.landmarks,
              quality: result.quality_score,
              ear: result.ear,
              yaw: result.yaw,
              ...result.timings,
            }
          : undefined;
      if (
        !result.accepted ||
        !result.embedding ||
        !vectorValid(result.embedding) ||
        result.ear === undefined ||
        result.yaw === undefined ||
        (result.quality_score ?? 0) < quality
      ) {
        // Loss of a valid face after beginning a challenge invalidates the sequence.
        if (
          (run.live.stage !== "baseline" || run.samples.length > 0) &&
          result.face_count !== 1
        ) {
          this.cancel(id, session);
          this.log(null, null, null, false, false, result.reason);
          throw new LabError(result.reason, 409);
        }
        if (c.purpose === "enroll")
          pauseForInvalidFrame(run.live, Date.now());
        return {
          status: "quality",
          reason: result.accepted ? "quality" : result.reason,
          stage: run.live.stage,
          samples: run.samples.length,
          debug,
        };
      }
      const before = run.live.stage;
      try {
        const observation = {
          ear: result.ear,
          yaw: result.yaw,
          embedding: result.embedding,
          digest: result.digest,
        };
        if (c.purpose === "enroll")
          observe(run.live, c.type, observation, Date.now(), continuity);
        else checkContinuity(run.live, observation, continuity);
      } catch (error) {
        this.cancel(id, session);
        this.log(null, null, null, false, false, (error as Error).message);
        throw new LabError((error as Error).message, 409);
      }
      if (
        c.purpose === "enroll" &&
        (run.live.stage !== "passed" ||
          before !== "passed" ||
          Date.now() - (run.live.passedAt ?? Date.now()) < PASSED_INSTRUCTION_MS)
      )
        return {
          status: "liveness",
          stage: run.live.stage,
          samples: run.samples.length,
          debug,
        };
      const index = run.samples.length;
      const pose = c.purpose === "enroll" ? samplePose(index) : 0;
      if (c.purpose === "enroll" && run.sampleTarget !== index) {
        run.sampleTarget = index;
        run.samplePromptedAt = Date.now();
      }
      if (c.purpose === "enroll" && run.samplePromptedAt === 0)
        run.samplePromptedAt = Date.now();
      if (
        c.purpose === "enroll" &&
        Date.now() - run.samplePromptedAt < ENROLL_SAMPLE_INSTRUCTION_MS
      )
        return {
          status: "sampling",
          reason: sampleReason(index),
          stage: "passed",
          samples: index,
          debug,
        };
      if (Math.abs(result.yaw - pose) > (pose === 0 ? 0.12 : 0.055))
        return {
          status: "sampling",
          reason: sampleReason(index),
          stage: "passed",
          samples: index,
          debug,
        };
      if (Date.now() - run.lastSample >= 350) {
        run.samples.push(result);
        run.lastSample = Date.now();
        run.sampleTarget = run.samples.length;
        run.samplePromptedAt = Date.now();
      }
      if (run.samples.length < (c.purpose === "enroll" ? 6 : 4))
        return {
          status: "sampling",
          reason:
            c.purpose === "enroll"
              ? sampleReason(run.samples.length)
              : "frontal",
          stage: "passed",
          samples: run.samples.length,
          debug,
        };
      const outcome = this.finish(c, run);
      const total = performance.now() - started;
      return {
        ...outcome,
        samples: run.samples.length,
        debug:
          admin && config.FACE_DEBUG
            ? {
                ...debug,
                ...outcome.debug,
                liveness_ms: run.live.passedAt
                  ? run.live.passedAt - run.live.started
                  : 0,
                liveness_mode:
                  c.purpose === "enroll" ? "active" : "not_performed",
                total_ms: total,
                sequence_ms: Date.now() - run.live.started,
              }
            : undefined,
      };
    } finally {
      run.busy = false;
    }
  }
  finish(c: Challenge, run: Run) {
    const vectors = run.samples.map((s) => s.embedding!);
    const started = performance.now();
    try {
      return this.db.transaction(() => {
        if (
          !this.db
            .prepare(
              "UPDATE face_challenges SET used=1 WHERE id=? AND used=0 AND expires_at>?",
            )
            .run(c.id, Date.now()).changes
        )
          throw new LabError("challenge_used", 409);
        const cfg = settings(this.db);
        // Read within this transaction to avoid stale gallery during concurrent enrollments.
        const candidates =
          c.purpose === "enroll"
            ? gallery(this.db, run.version, true)
            : this.getGallery();
        if (c.purpose === "enroll") {
          const profile = this.db
            .prepare("SELECT active,updated_at FROM face_profiles WHERE id=?")
            .get(c.profile_id) as
            { active: number; updated_at: number } | undefined;
          if (!profile?.active || profile.updated_at !== run.profileUpdated)
            throw new LabError("profile_changed", 409);
          if (
            possibleDuplicate(
              vectors,
              candidates.filter((p) => p.id !== c.profile_id),
              cfg.duplicateThreshold,
            )
          ) {
            audit(this.db, "duplicate_blocked", c.profile_id);
            return {
              status: "rejected",
              reason: "duplicate",
              debug: { matching_ms: performance.now() - started },
            };
          }
          if (
            Math.max(...run.samples.map((s) => s.yaw!)) -
              Math.min(...run.samples.map((s) => s.yaw!)) <
            0.09
          )
            throw new LabError("insufficient_variation", 422);
          const now = Date.now();
          this.db
            .prepare("DELETE FROM face_templates WHERE profile_id=?")
            .run(c.profile_id);
          const insert = this.db.prepare(
            "INSERT INTO face_templates(id,profile_id,embedding,sample_number,quality_score,model_name,model_version,created_at) VALUES(?,?,?,?,?,?,?,?)",
          );
          run.samples.forEach((s, i) =>
            insert.run(
              randomUUID(),
              c.profile_id,
              encode(s.embedding!),
              i + 1,
              s.quality_score,
              "SFace",
              run.version,
              now,
            ),
          );
          this.db
            .prepare(
              "UPDATE face_profiles SET updated_at=?,consent_at=? WHERE id=?",
            )
            .run(now, now, c.profile_id);
          audit(this.db, "face_enrolled", c.profile_id);
          this.invalidate();
          return {
            status: "enrolled",
            reason: "ok",
            debug: { matching_ms: performance.now() - started },
          };
        }
        const result = identify(vectors, candidates, cfg.threshold, cfg.margin);
        this.log(
          result.profile_id,
          result.score,
          result.second_score,
          result.accepted,
          false,
          result.reason,
        );
        return {
          status: "result",
          profile_id: result.profile_id,
          reason: result.reason,
          name: result.name,
          accepted: result.accepted,
          debug: {
            score: result.score,
            second_score: result.second_score,
            margin: result.margin,
            matching_ms: performance.now() - started,
          },
        };
      })();
    } finally {
      this.runs.delete(c.id);
      this.db.prepare("UPDATE face_challenges SET used=1 WHERE id=?").run(c.id);
    }
  }
  log(
    profile: string | null,
    score: number | null,
    second: number | null,
    accepted: boolean,
    live: boolean,
    reason: string,
  ) {
    this.db
      .prepare("INSERT INTO face_identification_log VALUES(?,?,?,?,?,?,?,?)")
      .run(
        randomUUID(),
        profile,
        score,
        second,
        Number(accepted),
        Number(live),
        reason,
        Date.now(),
      );
  }
}
