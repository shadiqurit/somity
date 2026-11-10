import type { Prisma } from '@prisma/client';
import { AppError } from '../utils/errors.js';

// Check active tenant inside every mutation transaction, not just at the HTTP edge.
export async function assertActiveSociety(tx: Prisma.TransactionClient, societyId: string) {
  // A locking read avoids opening a stale MySQL repeatable-read snapshot before
  // the member lock, and keeps a society from being disabled mid-mutation.
  const societies = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM societies WHERE id = ${societyId} AND isActive = true FOR SHARE`;
  if (!societies.length) throw new AppError(403, 'This society is not available');
}
