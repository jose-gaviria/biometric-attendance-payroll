import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import express from 'express';
import cookieParser from 'cookie-parser';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { faceRouter, recordFaceClock, setupFaceTables } from './face.js';
import { fallbackState, kioskSession, resetFallback } from './fallback.js';

const db = new Database(':memory:');
const folder = mkdtempSync(join(tmpdir(), 'turnos-face-test-'));
const key = 'a'.repeat(64),
  profile = randomUUID();
let server: Server,
  engine: Server,
  base: string,
  cookie = '',
  accepted = true;
let failureMode = '';
const upstreamCalls: { role: string; body: Record<string, unknown> }[] = [];
beforeAll(async () => {
  db.exec(`CREATE TABLE employees(id INTEGER PRIMARY KEY,name TEXT,active INTEGER);
    CREATE TABLE shifts(id INTEGER PRIMARY KEY,employee_id INTEGER,clock_in TEXT,clock_out TEXT,source TEXT,created_at TEXT,updated_at TEXT);
    CREATE UNIQUE INDEX one_open ON shifts(employee_id) WHERE clock_out IS NULL;
    CREATE TABLE audit_log(action TEXT,entity_type TEXT,entity_id INTEGER,detail TEXT,created_at TEXT);
    INSERT INTO employees VALUES(1,'Prueba',1),(2,'Segundo',1);`);
  setupFaceTables(db);
  const mock = express();
  mock.use(express.json());
  mock.use((req, res) => {
    expect(req.get('x-turnos-key')).toBe(key);
    upstreamCalls.push({
      role: req.get('x-turnos-role')!,
      body: req.body ?? {},
    });
    if (failureMode === 'unavailable')
      return res.status(503).json({ error: 'face_service_unavailable' });
    if (req.path.endsWith('/frame') && failureMode === 'expired')
      return res.status(410).json({ error: 'challenge_expired' });
    if (req.path.endsWith('/frame') && failureMode === 'quality')
      return res.json({
        status: 'quality',
        accepted: false,
        reason: 'no_face',
      });
    if (req.path === '/api/challenges')
      res.json({
        id: randomUUID(),
        nonce: 'b'.repeat(64),
        expires_at: Date.now() + 20000,
        required: 4,
      });
    else if (req.path.endsWith('/frame'))
      res.json({
        status: 'result',
        accepted,
        profile_id: profile,
        name: 'Prueba',
        reason: accepted ? 'ok' : 'unknown',
      });
    else res.json([]);
  });
  engine = await new Promise<Server>((resolve) => {
    const s = mock.listen(0, '127.0.0.1', () => resolve(s));
  });
  writeFileSync(join(folder, 'key'), key);
  process.env.FACE_BRIDGE_KEY_FILE = join(folder, 'key');
  process.env.FACE_LAB_URL =
    'http://127.0.0.1:' + (engine.address() as { port: number }).port;
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(
    '/api/face',
    faceRouter(db, (req) => req.get('authorization') === 'test-admin'),
  );
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
});
beforeEach(() => {
  db.exec(
    'DELETE FROM kiosk_attempts; DELETE FROM face_attempts; DELETE FROM face_links; DELETE FROM shifts; UPDATE employees SET active=1;',
  );
  db.prepare('INSERT INTO face_links VALUES(1,?,?)').run(
    profile,
    new Date().toISOString(),
  );
  cookie = '';
  accepted = true;
  failureMode = '';
  upstreamCalls.length = 0;
});
afterAll(async () => {
  await Promise.all([
    new Promise<void>((r) => server.close(() => r())),
    new Promise<void>((r) => engine.close(() => r())),
  ]);
  db.close();
  rmSync(folder, { recursive: true });
  delete process.env.FACE_BRIDGE_KEY_FILE;
  delete process.env.FACE_LAB_URL;
});
async function request(
  path: string,
  body?: unknown,
  admin = false,
  origin = 'http://localhost:8080',
  method = body ? 'POST' : 'GET',
) {
  const response = await fetch(base + '/api/face' + path, {
    method,
    headers: {
      origin,
      'Content-Type': 'application/json',
      cookie,
      ...(admin ? { authorization: 'test-admin' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (response.headers.get('set-cookie'))
    cookie = response.headers.get('set-cookie')!.split(';')[0];
  return { status: response.status, data: await response.json() };
}
async function identify(action = 'in') {
  const c = await request('/challenges', { purpose: 'identify', action });
  expect(c.status).toBe(200);
  return {
    id: c.data.id,
    result: await request('/challenges/' + c.data.id + '/frame', {
      nonce: c.data.nonce,
      image: 'synthetic',
    }),
  };
}

test('PIN unlocks after three complete recognition failures, scoped to session and action', async () => {
  accepted = false;
  for (let n = 1; n <= 3; n++) {
    const { id } = await identify();
    const state = (await request('/fallback?action=in')).data;
    expect(state.failures).toBe(n);
    expect(state.allowed).toBe(n === 3);
    await request('/challenges/' + id + '/frame', { image: 'synthetic' });
    expect((await request('/fallback?action=in')).data).toEqual(state);
  }
  expect((await request('/fallback?action=out')).data.allowed).toBe(false);
  const originalCookie = cookie;
  cookie = '';
  expect((await request('/fallback?action=in')).data.allowed).toBe(false);
  cookie = originalCookie;
  accepted = true;
  await identify();
  expect((await request('/fallback?action=in')).data.failures).toBe(0);
});

test('camera failures require distinct owned tickets; expiry and reset relock PIN', async () => {
  for (let n = 1; n <= 3; n++) {
    const { data: attempt } = await request('/attempts', { action: 'out' });
    const path = '/attempts/' + attempt.id + '/camera-error';
    expect((await request(path, { reason: 'invented' })).status).toBe(400);
    expect(
      (await request(path, { reason: 'NotFoundError' })).data.failures,
    ).toBe(n);
    expect(
      (await request(path, { reason: 'NotFoundError' })).data.failures,
    ).toBe(n);
  }
  const token = cookie.split('=')[1];
  const session = kioskSession({
    cookies: { turnos_kiosk: token },
  } as unknown as express.Request);
  expect(fallbackState(db, session, 'out').allowed).toBe(true);
  db.prepare(
    'UPDATE kiosk_attempts SET expires_at=? WHERE id=(SELECT id FROM kiosk_attempts LIMIT 1)',
  ).run(Date.now() - 1);
  expect(fallbackState(db, session, 'out').allowed).toBe(false);
  const { data: pending } = await request('/attempts', { action: 'out' });
  resetFallback(db, session);
  await request('/attempts/' + pending.id + '/camera-error', {
    reason: 'disconnected',
  });
  expect(fallbackState(db, session, 'out').failures).toBe(0);
  cookie = '';
  expect(
    (
      await request('/attempts/' + pending.id + '/camera-error', {
        reason: 'NotFoundError',
      })
    ).status,
  ).toBe(404);
});

test('cancelled challenges do not count and both configured loopback aliases work', async () => {
  const created = await request(
    '/challenges',
    { purpose: 'identify', action: 'in' },
    false,
    'http://127.0.0.1:8080',
  );
  expect(created.status).toBe(200);
  await request(
    '/challenges/' + created.data.id,
    undefined,
    false,
    'http://localhost:8080',
    'DELETE',
  );
  expect((await request('/fallback?action=in')).data.failures).toBe(0);
  expect(
    (
      await request(
        '/attempts',
        { action: 'in' },
        false,
        'http://127.0.0.1:9999',
      )
    ).status,
  ).toBe(403);
});

test('quality frames do not count; expiry and unavailable service count once; cancellation never counts', async () => {
  failureMode = 'quality';
  const c = (
    await request('/challenges', { purpose: 'identify', action: 'in' })
  ).data;
  for (let n = 0; n < 5; n++)
    await request('/challenges/' + c.id + '/frame', { image: 'synthetic' });
  expect((await request('/fallback?action=in')).data.failures).toBe(0);
  failureMode = 'expired';
  for (let n = 0; n < 2; n++)
    await request('/challenges/' + c.id + '/frame', { image: 'synthetic' });
  expect((await request('/fallback?action=in')).data.failures).toBe(1);
  failureMode = '';
  const cancelled = (
    await request('/challenges', { purpose: 'identify', action: 'in' })
  ).data;
  failureMode = 'unavailable';
  await request(
    '/challenges/' + cancelled.id,
    undefined,
    false,
    'http://localhost:8080',
    'DELETE',
  );
  expect((await request('/fallback?action=in')).data.failures).toBe(1);
  await request('/challenges', { purpose: 'identify', action: 'in' });
  expect((await request('/fallback?action=in')).data.failures).toBe(2);
  await request('/challenges', { purpose: 'identify', action: 'in' });
  expect((await request('/fallback?action=in')).data.allowed).toBe(true);
});

test('recognized identity with a business error cannot be reported as failed recognition', async () => {
  const ticket = (await request('/attempts', { action: 'out' })).data;
  const c = (
    await request('/challenges', {
      purpose: 'identify',
      action: 'out',
      attempt_id: ticket.id,
    })
  ).data;
  const result = await request('/challenges/' + c.id + '/frame', {
    image: 'synthetic',
  });
  expect(result.data.accepted).toBe(true);
  expect(result.data.attendance_error).toContain('pendiente');
  await request('/attempts/' + ticket.id + '/camera-error', {
    reason: 'NotReadableError',
  });
  expect((await request('/fallback?action=out')).data.failures).toBe(0);
});
test('frontal match writes server-timed entrance and one audit', async () => {
  const { result } = await identify();
  expect(result.data.attendance.action).toBe('in');
  expect(result.data.profile_id).toBeUndefined();
  expect(db.prepare('SELECT source FROM shifts').get()).toEqual({
    source: 'face',
  });
  expect(upstreamCalls[0].body.action).toBeUndefined();
  expect(upstreamCalls[0].role).toBe('kiosk');
});
test('retry returns same attendance without a second upstream match or shift', async () => {
  const { id, result } = await identify();
  const count = upstreamCalls.length;
  const retry = await request('/challenges/' + id + '/frame', {
    nonce: 'ignored',
    image: 'synthetic',
  });
  expect(retry.data.attendance).toEqual(result.data.attendance);
  expect(upstreamCalls.length).toBe(count);
  expect(db.prepare('SELECT count(*) n FROM shifts').get()).toEqual({ n: 1 });
});
test('chosen exit closes existing shift and duplicate entrance is rejected', async () => {
  await identify();
  expect((await identify()).result.data.attendance_error).toContain(
    'Ya tienes',
  );
  db.prepare('UPDATE shifts SET clock_in=?').run(
    new Date(Date.now() - 60000).toISOString(),
  );
  expect((await identify('out')).result.data.attendance.action).toBe('out');
  expect(
    (db.prepare('SELECT clock_out FROM shifts').get() as { clock_out: string })
      .clock_out,
  ).toBeTruthy();
});
test('unknown cannot mark attendance', async () => {
  accepted = false;
  expect((await identify()).result.data.accepted).toBe(false);
  expect(db.prepare('SELECT count(*) n FROM shifts').get()).toEqual({ n: 0 });
});
test('unlinked and inactive employees cannot mark attendance', async () => {
  db.exec('DELETE FROM face_links');
  expect((await identify()).result.data.attendance_error).toContain(
    'vinculado',
  );
  db.prepare('INSERT INTO face_links VALUES(1,?,?)').run(profile, 'now');
  db.exec('UPDATE employees SET active=0 WHERE id=1');
  expect((await identify()).result.data.attendance_error).toContain('activo');
  expect(db.prepare('SELECT count(*) n FROM shifts').get()).toEqual({ n: 0 });
});
test('exit without an open shift is rejected', async () => {
  expect((await identify('out')).result.data.attendance_error).toContain(
    'pendiente',
  );
});
test('admin-only enrollment, profile list and linkage; one-to-one mapping', async () => {
  expect((await request('/profiles')).status).toBe(403);
  expect(
    (
      await request('/challenges', {
        purpose: 'enroll',
        profile_id: profile,
        consent: true,
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await request(
        '/links/2',
        { profile_id: profile },
        false,
        undefined,
        'PUT',
      )
    ).status,
  ).toBe(403);
  expect(
    (await request('/links/2', { profile_id: profile }, true, undefined, 'PUT'))
      .status,
  ).toBe(409);
  expect((await request('/profiles', undefined, true)).status).toBe(200);
  expect(upstreamCalls.at(-1)?.role).toBe('admin');
});
test('cross-origin requests and unsupported proxy paths are blocked', async () => {
  expect(
    (
      await request(
        '/challenges',
        { purpose: 'identify', action: 'in' },
        false,
        'http://attacker.test',
      )
    ).status,
  ).toBe(403);
  expect((await request('/settings', {}, true)).status).toBe(403);
  expect((await request('/login', { password: 'x' }, true)).status).toBe(403);
  expect(upstreamCalls.length).toBe(0);
});
test('session ownership, expiration and invalid action protect attendance', async () => {
  expect(
    (await request('/challenges', { purpose: 'identify', action: 'toggle' }))
      .status,
  ).toBe(400);
  db.prepare('INSERT INTO face_attempts VALUES(?,?,?,?,NULL)').run(
    'a',
    'owner',
    'in',
    Date.now() + 10000,
  );
  expect(() => recordFaceClock(db, 'a', 'other', profile)).toThrow('caducado');
  db.prepare('UPDATE face_attempts SET expires_at=0').run();
  expect(() => recordFaceClock(db, 'a', 'owner', profile)).toThrow('caducado');
});
