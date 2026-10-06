import type { Db } from '../../db/index.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { newOpaqueToken, sha256 } from '../../lib/tokens.js';
import type { Role } from './plugin.js';

export interface PublicUser {
  id: string;
  email: string;
  role: Role;
  displayName: string | null;
  ratingPuzzle: number;
}

export class AuthError extends Error {
  constructor(
    public readonly code: 'email_taken' | 'invalid_credentials' | 'invalid_refresh_token',
  ) {
    super(code);
  }
}

interface UserRow {
  id: string;
  email: string;
  role: Role;
  display_name: string | null;
  rating_puzzle: number;
}

function toPublic(u: UserRow): PublicUser {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    displayName: u.display_name,
    ratingPuzzle: u.rating_puzzle,
  };
}

const userColumns = ['id', 'email', 'role', 'display_name', 'rating_puzzle'] as const;

export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly opts: { adminEmails: string[]; refreshTokenTtlDays: number },
  ) {}

  async register(email: string, password: string, displayName?: string): Promise<PublicUser> {
    const normalized = email.trim().toLowerCase();
    const role: Role = this.opts.adminEmails.includes(normalized) ? 'admin' : 'user';
    const row = await this.db
      .insertInto('users')
      .values({
        email: normalized,
        password_hash: await hashPassword(password),
        role,
        display_name: displayName ?? null,
      })
      .onConflict((oc) => oc.column('email').doNothing())
      .returning(userColumns)
      .executeTakeFirst();
    if (!row) throw new AuthError('email_taken');
    return toPublic(row);
  }

  async login(email: string, password: string): Promise<PublicUser> {
    const row = await this.db
      .selectFrom('users')
      .select([...userColumns, 'password_hash'])
      .where('email', '=', email.trim().toLowerCase())
      .executeTakeFirst();
    if (!row || !(await verifyPassword(row.password_hash, password))) {
      throw new AuthError('invalid_credentials');
    }
    return toPublic(row);
  }

  async getUser(id: string): Promise<PublicUser | undefined> {
    const row = await this.db
      .selectFrom('users')
      .select(userColumns)
      .where('id', '=', id)
      .executeTakeFirst();
    return row && toPublic(row);
  }

  async issueRefreshToken(userId: string): Promise<string> {
    const token = newOpaqueToken();
    const expires = new Date(Date.now() + this.opts.refreshTokenTtlDays * 86_400_000);
    await this.db
      .insertInto('refresh_tokens')
      .values({ user_id: userId, token_hash: sha256(token), expires_at: expires })
      .execute();
    return token;
  }

  /** Ruota il refresh token: il vecchio viene revocato e ne viene emesso uno nuovo. */
  async rotateRefreshToken(token: string): Promise<{ user: PublicUser; refreshToken: string }> {
    const row = await this.db
      .selectFrom('refresh_tokens')
      .select(['id', 'user_id', 'expires_at', 'revoked_at'])
      .where('token_hash', '=', sha256(token))
      .executeTakeFirst();
    if (!row) throw new AuthError('invalid_refresh_token');

    if (row.revoked_at) {
      // riuso di un token già ruotato: possibile furto, si revocano tutte le sessioni
      await this.revokeAll(row.user_id);
      throw new AuthError('invalid_refresh_token');
    }
    if (new Date(row.expires_at) <= new Date()) throw new AuthError('invalid_refresh_token');

    const revoked = await this.db
      .updateTable('refresh_tokens')
      .set({ revoked_at: new Date() })
      .where('id', '=', row.id)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
    if (revoked.numUpdatedRows === 0n) throw new AuthError('invalid_refresh_token');

    const user = await this.getUser(row.user_id);
    if (!user) throw new AuthError('invalid_refresh_token');
    return { user, refreshToken: await this.issueRefreshToken(user.id) };
  }

  async revokeRefreshToken(token: string): Promise<void> {
    await this.db
      .updateTable('refresh_tokens')
      .set({ revoked_at: new Date() })
      .where('token_hash', '=', sha256(token))
      .where('revoked_at', 'is', null)
      .execute();
  }

  private async revokeAll(userId: string): Promise<void> {
    await this.db
      .updateTable('refresh_tokens')
      .set({ revoked_at: new Date() })
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .execute();
  }
}
