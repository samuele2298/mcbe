function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variabile d'ambiente mancante: ${name}`);
  return value;
}

function list(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface Config {
  databaseUrl: string;
  port: number;
  jwtSecret: string;
  accessTokenTtl: string;
  refreshTokenTtlDays: number;
  adminEmails: string[];
  corsOrigins: string[];
}

export function loadConfig(): Config {
  const jwtSecret = required('JWT_SECRET');
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET deve avere almeno 32 caratteri');
  return {
    databaseUrl: required('DATABASE_URL'),
    port: Number(process.env.API_PORT ?? 3000),
    jwtSecret,
    accessTokenTtl: process.env.ACCESS_TOKEN_TTL ?? '15m',
    refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30),
    adminEmails: list('ADMIN_EMAILS').map((e) => e.toLowerCase()),
    corsOrigins: list('CORS_ORIGINS'),
  };
}
