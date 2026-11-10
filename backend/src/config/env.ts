import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().startsWith('mysql://'),
  JWT_ACCESS_SECRET: z.string().min(32),
  FRONTEND_ORIGIN: z.url().default('http://localhost:5173'),
  STORAGE_DIR: z.string().default('./storage'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
});
export const env = schema.parse(process.env);
