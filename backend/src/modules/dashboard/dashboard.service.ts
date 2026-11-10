import { db } from '../../config/database.js';
export async function summary(societyId: string) {
  const [total, active, linked, recent] = await db.$transaction([
    db.member.count({ where: { societyId, archivedAt: null } }),
    db.member.count({ where: { societyId, archivedAt: null, status: 'ACTIVE' } }),
    db.member.count({ where: { societyId, archivedAt: null, userId: { not: null } } }),
    db.member.findMany({ where: { societyId, archivedAt: null }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 5, select: { id: true, memberNo: true, fullName: true, status: true, joinedAt: true } }),
  ]);
  return { total, active, linked, inactive: total - active, recent, currency: 'BDT', financialModulesAvailable: false };
}
