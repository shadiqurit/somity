import { unlink } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { db } from '../config/database.js';
import { env } from '../config/env.js';

export const storageRoot = resolve(env.STORAGE_DIR);
export function storedFilePath(storageKey: string) {
  const path = resolve(storageRoot, storageKey);
  const within = relative(storageRoot, path);
  if (!within || within.startsWith('..') || isAbsolute(within) || /[\\/]/.test(storageKey)) throw new Error('Invalid storage key');
  return path;
}
export async function cleanupFiles(storageKeys?: string[]) {
  // A failed unlink stays queued; a failed queue deletion is also safe to retry.
  const jobs = await db.fileDeletion.findMany({ where: storageKeys ? { storageKey: { in: storageKeys } } : {}, orderBy: [{ createdAt: 'asc' }, { storageKey: 'asc' }], take: storageKeys ? undefined : 100 });
  for (const job of jobs) {
    try {
      try { await unlink(storedFilePath(job.storageKey)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      await db.fileDeletion.deleteMany({ where: { storageKey: job.storageKey } });
    } catch {
      await db.fileDeletion.updateMany({ where: { storageKey: job.storageKey }, data: { attempts: { increment: 1 } } });
      console.error('Private photo file cleanup failed; queued for retry');
    }
  }
}
export async function tryCleanupFiles(storageKeys?: string[]) {
  try { await cleanupFiles(storageKeys); }
  catch { console.error('Private file cleanup deferred; queued jobs will retry'); }
}
