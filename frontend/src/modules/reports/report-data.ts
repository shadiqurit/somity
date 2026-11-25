import { bdt } from '../finance/types';

export type LoanReportKind = 'loans' | 'loan-disbursements' | 'loan-repayments';
export type SummarySectionKey = 'bank' | 'savings' | 'loans' | 'investments' | 'income' | 'expenses';
export type ReportKind = 'summary' | LoanReportKind | 'investments' | 'income' | 'expenses' | 'bank' | 'bank-statement' | 'savings' | 'member-statement';
export type ReportDates = { from?: string; to?: string };
export type ReportMember = { id: string; fullName: string; memberNo: string };
export type ReportAccount = { id: string; name: string; code: string; kind: 'BANK' | 'CASH'; bankName: string | null; accountNumberLast4: string | null };
export type ReportRow = { id: string } & Record<string, string>;
export type ReportSummarySection = {
  key: SummarySectionKey;
  title: string;
  records: number;
  metrics: { label: string; amount: string }[];
};
export type ReportSummaryAccount = {
  id: string;
  name: string;
  code: string;
  kind: string;
  opening: string;
  deposits: string;
  withdrawals: string;
  closing: string;
};
export type ReportData = {
  member?: ReportMember | null;
  account?: ReportAccount | null;
  items: ReportRow[];
  summary: { label: string; amount: string }[];
  sections?: ReportSummarySection[];
  accounts?: ReportSummaryAccount[];
  total: number;
  page: number;
  pages: number;
};

export function reportMemberLabel(member: ReportMember) {
  return `${member.fullName} · ${member.memberNo}`;
}

export function reportAccountLabel(account: ReportAccount) {
  return [account.name, account.code, account.bankName, account.accountNumberLast4 && `••••${account.accountNumberLast4}`].filter(Boolean).join(' · ');
}

type Column = { key: string; label: string; width: number; money?: boolean };
const transactionColumns: Column[] = [
  { key: 'date', label: 'Date', width: 14 },
  { key: 'transactionNo', label: 'Transaction', width: 22 },
  { key: 'movement', label: 'Movement', width: 30 },
  { key: 'details', label: 'Details', width: 48 },
];
const movementColumns: Column[] = [
  ...transactionColumns,
  { key: 'amount', label: 'Net amount (BDT)', width: 22, money: true },
];
const bankColumns: Column[] = [
  { key: 'name', label: 'Account', width: 28 },
  { key: 'code', label: 'Code', width: 18 },
  { key: 'kind', label: 'Type', width: 12 },
  { key: 'opening', label: 'Opening (BDT)', width: 22, money: true },
  { key: 'deposits', label: 'Money in (BDT)', width: 22, money: true },
  { key: 'withdrawals', label: 'Money out (BDT)', width: 22, money: true },
  { key: 'closing', label: 'Closing (BDT)', width: 22, money: true },
];
const bankStatementColumns: Column[] = [
  ...transactionColumns,
  { key: 'incoming', label: 'Money in (BDT)', width: 20, money: true },
  { key: 'outgoing', label: 'Money out (BDT)', width: 20, money: true },
  { key: 'balance', label: 'Balance (BDT)', width: 20, money: true },
];
const summaryColumns: Column[] = [
  { key: 'category', label: 'Report', width: 24 },
  { key: 'metric', label: 'Metric', width: 32 },
  { key: 'amount', label: 'Amount (BDT)', width: 22, money: true },
];
const loanReportColumns: Record<LoanReportKind, Column[]> = {
  loans: [
    ...transactionColumns,
    { key: 'disbursed', label: 'Disbursed (BDT)', width: 22, money: true },
    { key: 'repaid', label: 'Repaid (BDT)', width: 22, money: true },
  ],
  'loan-disbursements': [...transactionColumns, { key: 'amount', label: 'Disbursed (BDT)', width: 22, money: true }],
  'loan-repayments': [...transactionColumns, { key: 'amount', label: 'Repaid (BDT)', width: 22, money: true }],
};

export function isLoanReport(kind: ReportKind): kind is LoanReportKind {
  return kind === 'loans' || kind === 'loan-disbursements' || kind === 'loan-repayments';
}

export function reportColumns(kind: ReportKind) {
  if (kind === 'summary') return summaryColumns;
  if (isLoanReport(kind)) return loanReportColumns[kind];
  if (kind === 'bank') return bankColumns;
  return kind === 'bank-statement' ? bankStatementColumns : movementColumns;
}

export function reportCell(row: ReportRow, column: Column) {
  const value = row[column.key] ?? '';
  return column.money ? bdt(value).slice(2) : value || '—';
}

export interface ReportGeneratedBy {
  name: string;
  email: string;
  role?: string;
}

export interface ReportDocument {
  data: ReportData;
  kind: ReportKind;
  title: string;
  society: string;
  period: string;
  filename: string;
  generatedBy?: ReportGeneratedBy;
  generatedAt?: string;
}
