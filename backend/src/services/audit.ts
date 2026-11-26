import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma } from '@prisma/client';
import { db } from '../config/database.js';
import { AppError } from '../utils/errors.js';

const actors = new AsyncLocalStorage<{ id: string; role?: string }>();
export function withAuditActor<T>(actor: { id: string; role?: string }, action: () => T) {
  return actors.run(actor, action);
}

export function audit(tx: Prisma.TransactionClient, actorId: string | null, action: string, entityType: string, entityId: string, changes?: Prisma.InputJsonValue, societyId?: string) {
  const actor = actors.getStore();
  const actorRole = actor && actor.id === actorId ? actor.role : undefined;
  return tx.auditLog.create({ data: { actorId, actorRole, societyId, action, entityType, entityId, ...(changes ? { changes } : {}) } });
}

export async function auditPageFilter(where: Prisma.AuditLogWhereInput, after?: string): Promise<Prisma.AuditLogWhereInput> {
  if (!after) return where;
  const cursor = await db.auditLog.findFirst({ where: { AND: [where, { id: after }] }, select: { id: true, createdAt: true } });
  if (!cursor) throw new AppError(422, 'Invalid activity log cursor');
  return { AND: [where, { OR: [
    { createdAt: { lt: cursor.createdAt } },
    { createdAt: cursor.createdAt, id: { lt: cursor.id } },
  ] }] };
}
