import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { type DB, audit, cleanup, gallery, settings } from "./db.js";
import { appOrigins, config, settingsSchema } from "./config.js";
import { Lab, LabError } from "./lab.js";
import { ServiceUnavailable } from "./face-client.js";
import { integrationSession } from "./integration.js";
import { possibleDuplicate } from "./matching.js";

const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const cookieOptions = {
  httpOnly: true,
  sameSite: "strict" as const,
  secure: config.APP_ORIGIN.startsWith("https:"),
  path: "/",
};
const profileSchema = z
  .object({
    display_name: z.string().trim().min(1).max(100),
    external_reference: z.string().trim().max(100).nullable().optional(),
  })
  .strict();
const idSchema = z.string().uuid();
export function createApp(db: DB) {
  const app = express(),
    lab = new Lab(db);
  app.disable("x-powered-by");
  app.set("trust proxy", false);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "blob:"],
          connectSrc: ["'self'"],
          mediaSrc: ["'self'", "blob:"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: null,
        },
      },
      strictTransportSecurity: false,
    }),
  );
  app.use((_req, res, next) => {
    res.setHeader(
      "Permissions-Policy",
      "camera=(self), microphone=(), geolocation=()",
    );
    next();
  });
  app.get("/health", async (_req, res) => {
    try {
      const face = await lab.health();
      db.prepare("SELECT 1").get();
      res.json({ status: "healthy", face });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.headers["sec-fetch-site"] === "cross-site")
      return res.status(403).json({ error: "origin_rejected" });
    if (
      !["GET", "HEAD"].includes(req.method) &&
      !appOrigins.has(req.headers.origin ?? "")
    )
      return res.status(403).json({ error: "origin_rejected" });
    next();
  });
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 400,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "rate_limit" },
    }),
  );
  app.use("/api", express.json({ limit: "500kb", strict: true }));
  app.post(
    "/api/login",
    rateLimit({
      windowMs: 15 * 60000,
      limit: 8,
      skipSuccessfulRequests: true,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "login_rate_limit" },
    }),
    async (req, res) => {
      const body = z
        .object({ password: z.string().min(1).max(128) })
        .strict()
        .parse(req.body);
      const admin = db
        .prepare("SELECT password_hash FROM admins WHERE id=?")
        .get("admin") as { password_hash: string } | undefined;
      if (!admin) return res.status(503).json({ error: "setup_required" });
      if (!(await bcrypt.compare(body.password, admin.password_hash)))
        return res.status(401).json({ error: "invalid_credentials" });
      const token = randomBytes(32).toString("hex");
      db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
        sha(token),
        "admin",
        Date.now() + 8 * 3600000,
      );
      res.cookie("face_session", token, {
        ...cookieOptions,
        maxAge: 8 * 3600000,
      });
      audit(db, "admin_login");
      res.json({ role: "admin" });
    },
  );
  app.get("/api/setup-status", (_req, res) =>
    res.json({
      configured: !!db.prepare("SELECT id FROM admins LIMIT 1").get(),
    }),
  );
  app.use("/api", (req, res, next) => {
    const bridge = integrationSession(req);
    if (bridge) {
      res.locals.session = bridge;
      res.locals.integration = true;
      return next();
    }
    const token = (req.headers.cookie ?? "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("face_session="))
      ?.slice(13);
    if (!token || !/^[a-f0-9]{64}$/.test(token))
      return res.status(401).json({ error: "login_required" });
    const session = db
      .prepare("SELECT id,role FROM sessions WHERE id=? AND expires_at>?")
      .get(sha(token), Date.now()) as { id: string; role: string } | undefined;
    if (!session) return res.status(401).json({ error: "login_required" });
    res.locals.session = session;
    next();
  });
  const admin = (_req: Request, res: Response, next: NextFunction) => {
    if (res.locals.session.role !== "admin")
      return res.status(403).json({ error: "admin_required" });
    next();
  };
  app.get("/api/session", (_req, res) =>
    res.json({ role: res.locals.session.role }),
  );
  app.post("/api/logout", (_req, res) => {
    const id = res.locals.session.id;
    lab.cancelSession(id);
    db.prepare("DELETE FROM sessions WHERE id=?").run(id);
    res.clearCookie("face_session", cookieOptions);
    res.json({ ok: true });
  });
  app.post("/api/kiosk", admin, (_req, res) => {
    db.prepare("UPDATE sessions SET role='kiosk' WHERE id=?").run(
      res.locals.session.id,
    );
    lab.cancelSession(res.locals.session.id);
    res.json({ role: "kiosk" });
  });
  app.get("/api/status", async (_req, res) => {
    let face = null;
    try {
      face = await lab.health();
    } catch {
      /* A failed health check must be visible, never healthy. */
    }
    const stats =
      res.locals.session.role === "admin"
        ? db
            .prepare(
              "SELECT count(*) AS profiles,coalesce(sum(active),0) AS active,(SELECT count(DISTINCT profile_id) FROM face_templates WHERE active=1) AS registered FROM face_profiles",
            )
            .get()
        : undefined;
    res.json({
      face,
      stats,
      offline: true,
      debug: config.FACE_DEBUG && res.locals.session.role === "admin",
    });
  });
  app.get("/api/profiles", admin, async (req, res) => {
    const query = z
      .object({
        q: z.string().max(100).optional(),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(req.query);
    if (!lab.version)
      try {
        await lab.health();
      } catch {
        /* Profiles remain manageable while inference is unavailable. */
      }
    const rows = db
      .prepare(
        `SELECT p.*,count(t.id) AS templates,sum(CASE WHEN t.model_name='SFace' AND t.model_version=? THEN 1 ELSE 0 END) AS compatible FROM face_profiles p LEFT JOIN face_templates t ON t.profile_id=p.id AND t.active=1 WHERE instr(lower(p.display_name),lower(?))>0 GROUP BY p.id ORDER BY p.display_name LIMIT 100 OFFSET ?`,
      )
      .all(lab.version, query.q ?? "", query.offset) as any[];
    res.json(
      rows.map((p) => ({
        ...p,
        biometric_status: !p.templates
          ? "none"
          : p.compatible === p.templates
            ? "registered"
            : "outdated",
      })),
    );
  });
  app.post("/api/profiles", admin, (req, res) => {
    const p = profileSchema.parse(req.body),
      id = randomUUID(),
      now = Date.now();
    db.prepare(
      "INSERT INTO face_profiles(id,display_name,external_reference,created_at,updated_at) VALUES(?,?,?,?,?)",
    ).run(id, p.display_name, p.external_reference ?? null, now, now);
    audit(db, "profile_created", id);
    lab.invalidate();
    res.status(201).json({ id });
  });
  const requireProfile = (id: unknown) => {
    const parsed = idSchema.parse(id);
    if (!db.prepare("SELECT id FROM face_profiles WHERE id=?").get(parsed))
      throw new LabError("profile_unavailable", 404);
    return parsed;
  };
  app.patch("/api/profiles/:id", admin, (req, res) => {
    const id = requireProfile(req.params.id),
      body = profileSchema
        .extend({ active: z.boolean() })
        .partial()
        .strict()
        .refine((b) => Object.keys(b).length > 0)
        .parse(req.body);
    const p = db
      .prepare("SELECT * FROM face_profiles WHERE id=?")
      .get(id) as any;
    if (body.active === true && !p.active) {
      const versions = db
        .prepare(
          "SELECT DISTINCT model_version FROM face_templates WHERE profile_id=? AND active=1 AND model_name='SFace'",
        )
        .all(id) as { model_version: string }[];
      for (const { model_version } of versions) {
        const target = gallery(db, model_version, true).find(
          (candidate) => candidate.id === id,
        );
        if (
          target &&
          possibleDuplicate(
            target.vectors,
            gallery(db, model_version),
            settings(db).duplicateThreshold,
          )
        )
          throw new LabError("duplicate", 409);
      }
    }
    db.prepare(
      "UPDATE face_profiles SET display_name=?,external_reference=?,active=?,updated_at=? WHERE id=?",
    ).run(
      body.display_name ?? p.display_name,
      body.external_reference === undefined
        ? p.external_reference
        : body.external_reference,
      body.active === undefined ? p.active : Number(body.active),
      Date.now(),
      id,
    );
    audit(db, "profile_updated", id);
    lab.invalidate();
    res.json({ ok: true });
  });
  app.delete("/api/profiles/:id/face", admin, (req, res) => {
    const id = requireProfile(req.params.id);
    db.transaction(() => {
      db.prepare("DELETE FROM face_templates WHERE profile_id=?").run(id);
      db.prepare(
        "UPDATE face_profiles SET consent_at=NULL,updated_at=? WHERE id=?",
      ).run(Date.now(), id);
      audit(db, "face_deleted", id);
    })();
    db.pragma("wal_checkpoint(TRUNCATE)");
    lab.invalidate();
    res.json({ ok: true });
  });
  app.delete("/api/profiles/:id", admin, (req, res) => {
    const id = requireProfile(req.params.id);
    db.prepare("DELETE FROM face_profiles WHERE id=?").run(id);
    audit(db, "profile_deleted");
    db.pragma("wal_checkpoint(TRUNCATE)");
    lab.invalidate();
    res.json({ ok: true });
  });
  app.get("/api/settings", admin, (_req, res) =>
    res.json({
      ...settings(db),
      model: "SFace",
      version: lab.version,
      detector: "YuNet",
      landmarks: "MediaPipe Face Landmarker",
      liveness: "enrollment_only",
      ttl: config.FACE_LIVENESS_CHALLENGE_TTL_SECONDS,
    }),
  );
  app.put("/api/settings", admin, (req, res) => {
    const value = settingsSchema.parse(req.body);
    db.prepare("UPDATE settings SET value=? WHERE id=1").run(
      JSON.stringify(value),
    );
    audit(db, "settings_updated");
    res.json(value);
  });
  app.get("/api/logs", admin, (_req, res) =>
    res.json({
      identifications: db
        .prepare(
          "SELECT * FROM face_identification_log ORDER BY created_at DESC LIMIT 100",
        )
        .all(),
      actions: db
        .prepare("SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 100")
        .all(),
    }),
  );
  app.post("/api/challenges", async (req, res) => {
    const body = z
      .object({
        purpose: z.enum(["enroll", "identify"]),
        profile_id: z.string().uuid().optional(),
        consent: z.literal(true).optional(),
      })
      .strict()
      .parse(req.body);
    if (
      body.purpose === "enroll" &&
      (res.locals.session.role !== "admin" || !body.profile_id || !body.consent)
    )
      throw new LabError("consent_and_admin_required", 403);
    res
      .status(201)
      .json(
        await lab.create(res.locals.session.id, body.purpose, body.profile_id),
      );
  });
  app.post("/api/challenges/:id/frame", async (req, res) => {
    const body = z
      .object({
        nonce: z.string().regex(/^[a-f0-9]{64}$/),
        image: z
          .string()
          .min(20)
          .max(470000)
          .regex(/^[A-Za-z0-9+/]+=*$/),
      })
      .strict()
      .parse(req.body);
    const result = await lab.frame(
        idSchema.parse(req.params.id),
        body.nonce,
        res.locals.session.id,
        body.image,
        res.locals.session.role === "admin",
      );
    if (!res.locals.integration) delete (result as { profile_id?: string | null }).profile_id;
    res.json(result);
  });
  app.delete("/api/challenges/:id", (req, res) => {
    const id = idSchema.parse(req.params.id);
    const c = db
      .prepare("SELECT session_id FROM face_challenges WHERE id=?")
      .get(id) as { session_id: string } | undefined;
    if (c && c.session_id !== res.locals.session.id)
      throw new LabError("challenge_invalid", 404);
    lab.cancel(id, res.locals.session.id);
    res.json({ ok: true });
  });
  app.use("/api", (_req, res) => res.status(404).json({ error: "not_found" }));
  app.use(
    express.static(resolve("dist/client"), { index: "index.html", maxAge: 0 }),
  );
  app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError)
      return res.status(400).json({ error: "invalid_input" });
    if (error instanceof LabError)
      return res.status(error.status).json({ error: error.code });
    if (error instanceof ServiceUnavailable)
      return res.status(503).json({ error: "face_service_unavailable" });
    if (error?.type === "entity.too.large")
      return res.status(413).json({ error: "image_too_large" });
    if (error instanceof SyntaxError || error?.message === "invalid_image")
      return res.status(400).json({ error: "invalid_image" });
    console.error("Request failed", { type: error?.constructor?.name });
    res.status(500).json({ error: "internal_error" });
  });
  cleanup(db);
  return { app, lab };
}
