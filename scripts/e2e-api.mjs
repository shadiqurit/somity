import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { spawn } from 'node:child_process';
const local = existsSync('backend/.env') ? parse(readFileSync('backend/.env')) : {};
const testUrl = process.env.TEST_DATABASE_URL ?? local.TEST_DATABASE_URL;
if (!testUrl || !new URL(testUrl).pathname.endsWith('_test')) throw new Error('E2E requires TEST_DATABASE_URL ending in _test');
const child = spawn(process.execPath, ['../node_modules/tsx/dist/cli.mjs', 'src/server.ts'], { cwd: 'backend', stdio: 'inherit', env: { ...process.env, ...local, NODE_ENV: 'test', DATABASE_URL: testUrl, PORT: '4100', FRONTEND_ORIGIN: 'http://localhost:5174', STORAGE_DIR: '../.local/e2e-uploads' } });
child.on('exit', code => process.exit(code ?? 1));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
