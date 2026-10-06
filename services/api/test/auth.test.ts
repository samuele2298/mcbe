import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { buildApp } from '../src/app.js';
import { createDb, createPool } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';

// Test di integrazione: richiede TEST_DATABASE_URL (un DB dedicato, viene svuotato).
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('auth', () => {
  const pool = createPool(url ?? '', 2);
  const db = createDb(pool);
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    await migrate(pool, undefined, () => {});
    app = await buildApp(
      {
        databaseUrl: url!,
        port: 0,
        jwtSecret: 'x'.repeat(32),
        accessTokenTtl: '15m',
        refreshTokenTtlDays: 30,
        adminEmails: ['admin@example.com'],
        corsOrigins: [],
      },
      db,
    );
  });

  beforeEach(async () => {
    await sql`TRUNCATE users CASCADE`.execute(db);
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  const register = (email: string, password = 'password123') =>
    app.inject({ method: 'POST', url: '/auth/register', payload: { email, password } });

  it('registra, fa login e legge /me', async () => {
    const reg = await register('Sam@Example.com');
    expect(reg.statusCode).toBe(201);
    expect(reg.json().user.email).toBe('sam@example.com');
    expect(reg.json().user.role).toBe('user');

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'sam@example.com', password: 'password123' },
    });
    expect(login.statusCode).toBe(200);

    const me = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: `Bearer ${login.json().accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().email).toBe('sam@example.com');
  });

  it('assegna admin alle email configurate', async () => {
    expect((await register('admin@example.com')).json().user.role).toBe('admin');
  });

  it('rifiuta email duplicata e password errata', async () => {
    await register('a@example.com');
    expect((await register('a@example.com')).statusCode).toBe(409);
    const bad = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'a@example.com', password: 'wrongpass1' },
    });
    expect(bad.statusCode).toBe(401);
  });

  it('/me senza token è 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/me' })).statusCode).toBe(401);
  });

  it('ruota il refresh token e blocca il riuso', async () => {
    const { refreshToken } = (await register('r@example.com')).json();
    const first = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken } });
    expect(first.statusCode).toBe(200);
    const rotated = first.json().refreshToken;
    expect(rotated).not.toBe(refreshToken);

    // riuso del token vecchio: rifiutato e tutte le sessioni revocate
    const reuse = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken } });
    expect(reuse.statusCode).toBe(401);
    const afterReuse = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: rotated },
    });
    expect(afterReuse.statusCode).toBe(401);
  });

  it('logout revoca il refresh token', async () => {
    const { refreshToken } = (await register('l@example.com')).json();
    const out = await app.inject({ method: 'POST', url: '/auth/logout', payload: { refreshToken } });
    expect(out.statusCode).toBe(204);
    const again = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken } });
    expect(again.statusCode).toBe(401);
  });
});
