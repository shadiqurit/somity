export interface Account { id: string; code: string; name: string; kind: string; bankName: string | null; accountNumberLast4: string | null; isActive: boolean; balance: string; }
export interface Policy { version: number; requiredApprovals: number; allowSelfApproval: boolean; }
export interface FinancialTransaction {
  id: string; transactionNo: string; type: string; status: 'PENDING' | 'POSTED' | 'REJECTED' | 'CANCELLED'; amount: string; effectiveDate: string; note: string; reference: string; requiredApprovals: number; allowSelfApproval: boolean; policyVersion: number; createdById: string; createdAt: string; postedAt: string | null;
  member: { id: string; memberNo: string; fullName: string } | null; details: Record<string, string | number> | null; cashAccount: { id: string; name: string; kind: string }; createdBy: { id: string; name: string };
  investment: { title: string } | null;
  decisions: { id: string; step: number; approverId: string; decision: string; comment: string; createdAt: string; approver: { name: string } }[];
  reversalOf: { id: string; transactionNo: string; type: string } | null; reversals: { id: string; status: string }[];
  entries?: { id: string; debit: string; credit: string; account: { code: string; name: string } }[];
}
export interface FinanceSummary { deposits: string; withdrawals: string; memberSavings: string; pending: number; }
export interface IncomeSummary { otherIncome: string; investmentProfit: string; total: string; }
export interface LoanSummary { disbursed: string; repaid: string; outstanding: string; pending: number; }
export interface InvestmentSummary { invested: string; principalReturned: string; outstanding: string; profit: string; }
export interface ExpenseSummary { gross: string; reversals: string; net: string; pending: number; }
export interface BankSummary { opening: string; incoming: string; outgoing: string; closing: string; }
export interface LedgerLine { id: string; debit: string; credit: string; account: { code: string; name: string }; member: { fullName: string; memberNo: string } | null; transaction: { transactionNo: string; effectiveDate: string; type: string }; }
export interface StatementLine { id: string; transactionId: string; transactionNo: string; type: string; effectiveDate: string; reference: string; note: string; deposit: string; withdrawal: string; balance: string; }
export interface MemberStatement { member: { fullName: string; memberNo: string }; openingBalance: string; closingBalance: string; deposits: string; withdrawals: string; items: StatementLine[]; page: number; pages: number; total: number; }
export function bdt(value: string) {
  const negative = value.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? value.slice(1) : value).split('.');
  return `৳ ${negative ? '-' : ''}${new Intl.NumberFormat('en-BD').format(BigInt(whole))}.${fraction.padEnd(2, '0')}`;
}
export function todayDhaka() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
