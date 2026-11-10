import { app } from './app.js';
import { env } from './config/env.js';
import { db } from './config/database.js';
import { tryCleanupFiles } from './services/file-cleanup.js';
await db.$connect();
await tryCleanupFiles();
const cleanupTimer = setInterval(() => { void tryCleanupFiles(); }, 60000);
cleanupTimer.unref();
const server = app.listen(env.PORT, '127.0.0.1', () => console.log(`Somity API: http://127.0.0.1:${env.PORT}`));
server.on('error', error => {
  console.error(`Cannot start Somity API on port ${env.PORT}: ${error.message}`);
  clearInterval(cleanupTimer);
  void db.$disconnect().finally(() => process.exit(1));
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  clearInterval(cleanupTimer);
  server.close(() => { void db.$disconnect().then(() => process.exit(0)); });
  setTimeout(() => process.exit(1), 10000).unref();
});
