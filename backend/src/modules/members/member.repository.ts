import type { Prisma } from '@prisma/client';
export const memberInclude = {
  nominees: { orderBy: { id: 'asc' } },
  documents: { where: { kind: 'PHOTO' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1, select: { id: true, kind: true, mimeType: true, sizeBytes: true } },
  membership: { select: { isActive: true, user: { select: { id: true, email: true, isActive: true } } } },
} satisfies Prisma.MemberInclude;

type MemberRow = Prisma.MemberGetPayload<{ include: typeof memberInclude }>;
export function presentMember(row: MemberRow) {
  const { membership, ...member } = row;
  return { ...member, user: membership ? { ...membership.user, isActive: membership.isActive && membership.user.isActive } : null };
}
