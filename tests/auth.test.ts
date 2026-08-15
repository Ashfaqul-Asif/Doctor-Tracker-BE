import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { User } from '../src/modules/auth/user.model.js';
import { RefreshToken } from '../src/modules/auth/refreshToken.model.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { signAccessToken } from '../src/modules/auth/auth.service.js';
import { ADMIN, API, getApp, loginAgent } from './helpers/app.js';

async function createAdmin() {
  return User.create({
    email: ADMIN.email,
    name: ADMIN.name,
    role: 'admin',
    passwordHash: await hashPassword(ADMIN.password),
  });
}

/** Pull a cookie value out of a Set-Cookie header array. */
function cookieValue(res: request.Response, name: string): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  return raw?.find((c) => c.startsWith(`${name}=`))?.split(';')[0]?.split('=')[1];
}

describe('POST /auth/login', () => {
  it('sets httpOnly cookies and returns the user', async () => {
    const app = await getApp();
    await createAdmin();

    const res = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: ADMIN.email, password: ADMIN.password });

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(ADMIN.email);
    // The hash must never cross the wire.
    expect(res.body.data.user).not.toHaveProperty('passwordHash');

    const cookies = res.headers['set-cookie'] as unknown as string[];
    const access = cookies.find((c) => c.startsWith('access_token='))!;
    const refresh = cookies.find((c) => c.startsWith('refresh_token='))!;

    expect(access).toContain('HttpOnly');
    expect(refresh).toContain('HttpOnly');
    // Path-scoped so it is never sent on data requests.
    expect(refresh).toContain('Path=/api/v1/auth');
  });

  it('returns the SAME error for a wrong password and an unknown account', async () => {
    const app = await getApp();
    await createAdmin();

    const wrongPassword = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: ADMIN.email, password: 'WrongPassword123!' });

    const unknownEmail = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: 'nobody@test.dev', password: ADMIN.password });

    // Differing responses would turn the login form into an account-enumeration
    // oracle — "this email exists, keep guessing".
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.error.code).toBe(unknownEmail.body.error.code);
    expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
  });

  it('rejects a malformed email with 422 and a field path', async () => {
    const app = await getApp();
    const res = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: 'not-an-email', password: 'x' });

    expect(res.status).toBe(422);
    expect(res.body.error.details[0].path).toBe('email');
  });
});

describe('refresh token rotation', () => {
  it('rotates on use and revokes the presented token', async () => {
    const app = await getApp();
    await createAdmin();

    const first = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: ADMIN.email, password: ADMIN.password });
    const firstToken = cookieValue(first, 'refresh_token')!;

    const second = await request(app)
      .post(`${API}/auth/refresh`)
      .set('Cookie', `refresh_token=${firstToken}`);

    expect(second.status).toBe(200);
    const secondToken = cookieValue(second, 'refresh_token')!;
    expect(secondToken).not.toBe(firstToken);

    const stored = await RefreshToken.find({});
    expect(stored).toHaveLength(2);
    expect(stored.filter((t) => t.revokedAt !== null)).toHaveLength(1);
  });

  it('detects reuse and revokes the whole family', async () => {
    const app = await getApp();
    await createAdmin();

    const login = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: ADMIN.email, password: ADMIN.password });
    const original = cookieValue(login, 'refresh_token')!;

    // Legitimate rotation.
    await request(app).post(`${API}/auth/refresh`).set('Cookie', `refresh_token=${original}`);

    // Replay of the now-revoked token: either a stolen copy or a replay attack.
    const replay = await request(app)
      .post(`${API}/auth/refresh`)
      .set('Cookie', `refresh_token=${original}`);

    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('TOKEN_REUSE_DETECTED');

    // Every token in the lineage is now dead, so the thief's copy is useless too.
    const live = await RefreshToken.find({ revokedAt: null });
    expect(live).toHaveLength(0);
  });

  it('stores only a hash, never the raw token', async () => {
    const app = await getApp();
    await createAdmin();

    const login = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: ADMIN.email, password: ADMIN.password });
    const raw = cookieValue(login, 'refresh_token')!;

    const stored = await RefreshToken.findOne({});
    expect(stored!.tokenHash).not.toBe(raw);
    expect(stored!.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects a refresh with no token', async () => {
    const app = await getApp();
    const res = await request(app).post(`${API}/auth/refresh`);
    expect(res.status).toBe(401);
  });
});

describe('Bearer mode (for clients that cannot receive cookies)', () => {
  it('withholds the refresh token unless Bearer mode is requested', async () => {
    const app = await getApp();
    await createAdmin();

    const cookieMode = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: ADMIN.email, password: ADMIN.password });

    // Default path keeps the token out of JS reach entirely.
    expect(cookieMode.body.data.accessToken).toBeTruthy();
    expect(cookieMode.body.data.refreshToken).toBeUndefined();
  });

  it('returns the refresh token in Bearer mode', async () => {
    const app = await getApp();
    await createAdmin();

    const res = await request(app)
      .post(`${API}/auth/login`)
      .set('X-Auth-Mode', 'bearer')
      .send({ email: ADMIN.email, password: ADMIN.password });

    expect(res.body.data.refreshToken).toBeTruthy();
  });

  it('supports a full cookie-less session: login, refresh, rotate again', async () => {
    const app = await getApp();
    await createAdmin();

    const login = await request(app)
      .post(`${API}/auth/login`)
      .set('X-Auth-Mode', 'bearer')
      .send({ email: ADMIN.email, password: ADMIN.password });

    // No cookie jar anywhere in this test — everything travels in headers/body.
    const first = await request(app)
      .post(`${API}/auth/refresh`)
      .set('X-Auth-Mode', 'bearer')
      .send({ refreshToken: login.body.data.refreshToken });

    expect(first.status).toBe(200);
    expect(first.body.data.refreshToken).toBeTruthy();
    expect(first.body.data.refreshToken).not.toBe(login.body.data.refreshToken);

    // Rotation must keep working past the first hop, which is what fails if the
    // rotated token is not handed back.
    const second = await request(app)
      .post(`${API}/auth/refresh`)
      .set('X-Auth-Mode', 'bearer')
      .send({ refreshToken: first.body.data.refreshToken });

    expect(second.status).toBe(200);

    const access = second.body.data.accessToken;
    await request(app).get(`${API}/doctors`).set('Authorization', `Bearer ${access}`).expect(200);
  });

  it('revokes on logout when the token is sent in the body', async () => {
    const app = await getApp();
    await createAdmin();

    const login = await request(app)
      .post(`${API}/auth/login`)
      .set('X-Auth-Mode', 'bearer')
      .send({ email: ADMIN.email, password: ADMIN.password });

    const refreshToken = login.body.data.refreshToken;
    const access = login.body.data.accessToken;

    await request(app)
      .post(`${API}/auth/logout`)
      .set('Authorization', `Bearer ${access}`)
      .send({ refreshToken })
      .expect(200);

    // The regression this guards: logout used to read only the cookie, so it
    // reported success while leaving the refresh token usable for 7 more days.
    const afterLogout = await request(app)
      .post(`${API}/auth/refresh`)
      .set('X-Auth-Mode', 'bearer')
      .send({ refreshToken });

    expect(afterLogout.status).toBe(401);
    expect(await RefreshToken.countDocuments({ revokedAt: null })).toBe(0);
  });

  it('still detects reuse in Bearer mode', async () => {
    const app = await getApp();
    await createAdmin();

    const login = await request(app)
      .post(`${API}/auth/login`)
      .set('X-Auth-Mode', 'bearer')
      .send({ email: ADMIN.email, password: ADMIN.password });
    const original = login.body.data.refreshToken;

    await request(app)
      .post(`${API}/auth/refresh`)
      .set('X-Auth-Mode', 'bearer')
      .send({ refreshToken: original });

    const replay = await request(app)
      .post(`${API}/auth/refresh`)
      .set('X-Auth-Mode', 'bearer')
      .send({ refreshToken: original });

    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('TOKEN_REUSE_DETECTED');
  });
});

describe('route protection', () => {
  it.each([
    ['get', '/doctors'],
    ['post', '/doctors'],
    ['get', '/patients'],
    ['get', '/analytics/dashboard'],
    ['get', '/doctors/options'],
  ])('%s %s returns 401 without a session', async (method, path) => {
    const app = await getApp();
    const res = await (request(app) as unknown as Record<string, (p: string) => request.Test>)[
      method
    ]!(`${API}${path}`);
    expect(res.status).toBe(401);
  });

  it('accepts an Authorization: Bearer token as a fallback to the cookie', async () => {
    const app = await getApp();
    const admin = await createAdmin();

    // This fallback is what keeps auth working when the client and API are on
    // unrelated domains and the browser refuses the third-party cookie.
    const token = signAccessToken({ id: admin.id, email: admin.email, role: 'admin' });

    const res = await request(app).get(`${API}/doctors`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('rejects a tampered token', async () => {
    const app = await getApp();
    const res = await request(app)
      .get(`${API}/doctors`)
      .set('Authorization', 'Bearer not.a.real.token');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('logout revokes the refresh token and clears cookies', async () => {
    const agent = await loginAgent();

    const res = await agent.post(`${API}/auth/logout`);
    expect(res.status).toBe(200);

    expect(await RefreshToken.countDocuments({ revokedAt: null })).toBe(0);
  });

  it('GET /auth/me returns the current user', async () => {
    const agent = await loginAgent();
    const res = await agent.get(`${API}/auth/me`);

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe(ADMIN.email);
  });
});

describe('health', () => {
  it('liveness does not touch the database', async () => {
    const app = await getApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ok');
  });

  it('readiness reports the resolved database name', async () => {
    const app = await getApp();
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
    // A missing dbName silently writes to a database called `test` — this is the
    // cheapest way to catch that.
    expect(res.body.data.db).toBe('doctor_tracker_test');
  });
});
