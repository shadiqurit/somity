import type { Prisma } from '@prisma/client';
export function audit(tx: Prisma.TransactionClient, actorId: string | null, action: string, entityType: string, entityId: string, changes?: Prisma.InputJsonValue, societyId?: string) {
  return tx.auditLog.create({ data: { actorId, societyId, action, entityType, entityId, ...(changes ? { changes } : {}) } });
}
