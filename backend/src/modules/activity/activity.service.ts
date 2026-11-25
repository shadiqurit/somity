import type { Prisma } from '@prisma/client';
import { db } from '../../config/database.js';
import { auditPageFilter } from '../../services/audit.js';

type Filters = { after?: string; limit: number; action?: string; actorRole?: string };

export async function list(scope: Prisma.AuditLogWhereInput, { after, limit, action, actorRole }: Filters) {
  const events = await db.auditLog.findMany({
    where: await auditPageFilter({ ...scope, action, actorRole }, after),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    select: {
      id: true, entityType: true, entityId: true, action: true, createdAt: true, actorRole: true,
      actor: { select: { id: true, name: true } },
      society: { select: { id: true, name: true } },
    },
  });
  const page = events.slice(0, limit);
  const ids = (type: string) => [...new Set(page.filter(event => event.entityType === type).map(event => event.entityId))];
  const memberIds = ids('member');
  const transactionIds = ids('transaction');
  const userIds = ids('user');
  const accountIds = ids('account');
  const investmentIds = ids('investment');
  const noteIds = ids('note');
  const [members, transactions, users, accounts, investments, notes] = await Promise.all([
    memberIds.length ? db.member.findMany({ where: { id: { in: memberIds } }, select: { id: true, societyId: true, fullName: true, memberNo: true } }) : [],
    transactionIds.length ? db.financialTransaction.findMany({ where: { id: { in: transactionIds } }, select: { id: true, societyId: true, transactionNo: true } }) : [],
    userIds.length ? db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [],
    accountIds.length ? db.ledgerAccount.findMany({ where: { id: { in: accountIds } }, select: { id: true, societyId: true, name: true } }) : [],
    investmentIds.length ? db.investment.findMany({ where: { id: { in: investmentIds } }, select: { id: true, societyId: true, title: true } }) : [],
    noteIds.length ? db.note.findMany({ where: { id: { in: noteIds } }, select: { id: true, societyId: true, title: true } }) : [],
  ]);
  const labels = new Map<string, string>([
    ...members.map(row => [`member/${row.societyId}/${row.id}`, `${row.fullName} · ${row.memberNo}`] as const),
    ...transactions.map(row => [`transaction/${row.societyId}/${row.id}`, row.transactionNo] as const),
    ...users.map(row => [`user//${row.id}`, row.name] as const),
    ...accounts.map(row => [`account/${row.societyId}/${row.id}`, row.name] as const),
    ...investments.map(row => [`investment/${row.societyId}/${row.id}`, row.title] as const),
    ...notes.map(row => [`note/${row.societyId}/${row.id}`, row.title] as const),
  ]);
  return {
    items: page.map(event => {
      const scopeId = event.entityType === 'user' ? '' : event.society?.id ?? '';
      const targetLabel = event.entityType === 'society' ? event.society?.name : labels.get(`${event.entityType}/${scopeId}/${event.entityId}`);
      return { ...event, targetLabel: targetLabel ?? null };
    }),
    nextCursor: events.length > limit ? page.at(-1)!.id : null,
  };
}
