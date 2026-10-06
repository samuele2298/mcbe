import { Type } from 'typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { AuthError, type AuthService, type PublicUser } from './service.js';

const UserSchema = Type.Object({
  id: Type.String(),
  email: Type.String(),
  role: Type.Union([Type.Literal('user'), Type.Literal('admin')]),
  displayName: Type.Union([Type.String(), Type.Null()]),
  ratingPuzzle: Type.Integer(),
  lichessUsername: Type.Union([Type.String(), Type.Null()]),
  chesscomUsername: Type.Union([Type.String(), Type.Null()]),
});

const SessionSchema = Type.Object({
  user: UserSchema,
  accessToken: Type.String(),
  refreshToken: Type.String(),
});

const ErrorSchema = Type.Object({ error: Type.String() });

const Credentials = Type.Object({
  email: Type.String({ format: 'email', maxLength: 254 }),
  password: Type.String({ minLength: 8, maxLength: 200 }),
});

const RefreshBody = Type.Object({ refreshToken: Type.String({ minLength: 1 }) });

const authRateLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

export const authRoutes: FastifyPluginAsyncTypebox<{ auth: AuthService }> = async (
  app,
  { auth },
) => {
  async function session(user: PublicUser) {
    const accessToken = await app.jwt.sign({ sub: user.id, role: user.role });
    return { user, accessToken, refreshToken: await auth.issueRefreshToken(user.id) };
  }

  app.post(
    '/auth/register',
    {
      config: authRateLimit,
      schema: {
        tags: ['auth'],
        body: Type.Intersect([
          Credentials,
          Type.Object({ displayName: Type.Optional(Type.String({ maxLength: 60 })) }),
        ]),
        response: { 201: SessionSchema, 409: ErrorSchema },
      },
    },
    async (req, reply) => {
      try {
        const user = await auth.register(req.body.email, req.body.password, req.body.displayName);
        return reply.code(201).send(await session(user));
      } catch (err) {
        if (err instanceof AuthError) return reply.code(409).send({ error: err.code });
        throw err;
      }
    },
  );

  app.post(
    '/auth/login',
    {
      config: authRateLimit,
      schema: { tags: ['auth'], body: Credentials, response: { 200: SessionSchema, 401: ErrorSchema } },
    },
    async (req, reply) => {
      try {
        return await session(await auth.login(req.body.email, req.body.password));
      } catch (err) {
        if (err instanceof AuthError) return reply.code(401).send({ error: err.code });
        throw err;
      }
    },
  );

  app.post(
    '/auth/refresh',
    {
      config: authRateLimit,
      schema: { tags: ['auth'], body: RefreshBody, response: { 200: SessionSchema, 401: ErrorSchema } },
    },
    async (req, reply) => {
      try {
        const { user, refreshToken } = await auth.rotateRefreshToken(req.body.refreshToken);
        const accessToken = await app.jwt.sign({ sub: user.id, role: user.role });
        return { user, accessToken, refreshToken };
      } catch (err) {
        if (err instanceof AuthError) return reply.code(401).send({ error: err.code });
        throw err;
      }
    },
  );

  app.post(
    '/auth/logout',
    { schema: { tags: ['auth'], body: RefreshBody, response: { 204: Type.Null() } } },
    async (req, reply) => {
      await auth.revokeRefreshToken(req.body.refreshToken);
      return reply.code(204).send(null);
    },
  );

  app.get(
    '/me',
    {
      onRequest: [app.authenticate],
      schema: { tags: ['auth'], security: [{ bearerAuth: [] }], response: { 200: UserSchema, 404: ErrorSchema } },
    },
    async (req, reply) => {
      const user = await auth.getUser(req.user.sub);
      if (!user) return reply.code(404).send({ error: 'not_found' });
      return user;
    },
  );
};
