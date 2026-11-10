export interface Account { id: string; code: string; name: string; kind: 'CASH' | 'BANK' | 'MEMBER_SAVINGS'; bankName: string | null; accountNumberLast4: string | null; isActive: boolean; balance: string; }
export interface Policy { version: number; requiredApprovals: number; allowSelfApproval: boolean; }
export interface FinancialTransaction {
  id: string; transactionNo: string; type: 'DEPOSIT' | 'WITHDRAWAL' | 'REVERSAL'; status: 'PENDING' | 'POSTED' | 'REJECTED' | 'CANCELLED'; amount: string; effectiveDate: string; note: string; reference: string; requiredApprovals: number; allowSelfApproval: boolean; policyVersion: number; createdById: string; createdAt: string; postedAt: string | null;
  member: { id: string; memberNo: string; fullName: string }; cashAccount: { id: string; name: string; kind: string }; createdBy: { id: string; name: string };
  decisions: { id: string; step: number; approverId: string; decision: string; comment: string; createdAt: string; approver: { name: string } }[];
  reversalOf: { id: string; transactionNo: string; type: string } | null; reversals: { id: string; status: string }[];
  entries?: { id: string; debit: string; credit: string; account: { code: string; name: string } }[];
}
export interface FinanceSummary { deposits: string; withdrawals: string; memberSavings: string; pending: number; }
export interface LedgerLine { id: string; debit: string; credit: string; account: { code: string; name: string }; member: { fullName: string; memberNo: string }; transaction: { transactionNo: string; effectiveDate: string; type: string }; }
export interface StatementLine { id: string; transactionId: string; transactionNo: string; type: string; effectiveDate: string; reference: string; note: string; deposit: string; withdrawal: string; balance: string; }
export interface MemberStatement { member: { fullName: string; memberNo: string }; openingBalance: string; closingBalance: string; deposits: string; withdrawals: string; items: StatementLine[]; page: number; pages: number; total: number; }
export function bdt(value: string) {
  const [whole = '0', fraction = ''] = value.split('.');
  return `৳ ${new Intl.NumberFormat('en-BD').format(BigInt(whole))}.${fraction.padEnd(2, '0')}`;
}
export function todayDhaka() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
