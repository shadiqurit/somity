// For the isolated MySQL instance documented in README.md. Never targets an existing service.
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
if (existsSync('backend/.env')) throw new Error('backend/.env already exists; refusing to overwrite credentials');
const secret = () => randomBytes(24).toString('hex');
const port = Number(process.env.LOCAL_MYSQL_PORT ?? 13316);
const rootPassword = secret(); const password = secret(); const adminPassword = `Somity-${secret()}-A1`;
const sql = `ALTER USER 'root'@'localhost' IDENTIFIED BY '${rootPassword}';
CREATE DATABASE somity CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE somity_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'somity'@'127.0.0.1' IDENTIFIED BY '${password}';
GRANT ALL PRIVILEGES ON somity.* TO 'somity'@'127.0.0.1';
GRANT ALL PRIVILEGES ON somity_test.* TO 'somity'@'127.0.0.1';`;
let result;
for (let attempt = 0; attempt < 3; attempt++) {
  result = spawnSync('C:/Program Files/MySQL/MySQL Server 8.0/bin/mysql.exe', ['--no-defaults', '--host=127.0.0.1', `--port=${port}`, '--user=root', '--connect-timeout=2'], { input: sql, encoding: 'utf8' });
  if (result.status === 0 || !result.stderr.includes('2003')) break;
  await new Promise(resolve => setTimeout(resolve, 1000));
}
if (!result) throw new Error('Local database did not start');
if (result.status !== 0) throw new Error(result.stderr);
mkdirSync('.local', { recursive: true });
writeFileSync('.local/mysql-admin.cnf', `[client]\nhost=127.0.0.1\nport=${port}\nuser=root\npassword=${rootPassword}\n`);
writeFileSync('backend/.env', `NODE_ENV=development\nPORT=4000\nDATABASE_URL="mysql://somity:${password}@127.0.0.1:${port}/somity"\nTEST_DATABASE_URL="mysql://somity:${password}@127.0.0.1:${port}/somity_test"\nJWT_ACCESS_SECRET=${secret()}\nFRONTEND_ORIGIN=http://localhost:5173\nSTORAGE_DIR=./storage\nSEED_ADMIN_EMAIL=superadmin@somity.local\nSEED_ADMIN_NAME=Super Administrator\nSEED_ADMIN_PASSWORD=${adminPassword}\n`);
writeFileSync('.local/development-credentials.md', `# Local development access\n\nURL: http://localhost:5173\n\nEmail: superadmin@somity.local\n\nInitial password: ${adminPassword}\n\nChange the password at first login. This file and backend/.env are excluded from git.\n`);
console.log('Isolated databases and generated local credentials created. See .local/development-credentials.md.');
