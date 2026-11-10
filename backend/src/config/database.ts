import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { env } from './env.js';
export function databaseConnectionOptions(url: string) {
  const connection = new URL(url);
  return {
    host: connection.hostname,
    port: Number(connection.port || 3306),
    user: decodeURIComponent(connection.username),
    password: decodeURIComponent(connection.password),
    database: connection.pathname.slice(1),
    connectionLimit: 5,
    // MySQL 8 needs this for uncached password authentication without TLS.
    // Restrict server-supplied RSA keys to connections on this machine.
    allowPublicKeyRetrieval: ['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname),
    ...(connection.searchParams.get('ssl') === 'true' ? { ssl: true } : {}),
  };
}
export function createDatabase(url: string) {
  const adapter = new PrismaMariaDb(databaseConnectionOptions(url));
  return new PrismaClient({ adapter });
}
export const db = createDatabase(env.DATABASE_URL);
