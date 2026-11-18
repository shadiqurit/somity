import { bdt } from '../finance/types';

export type ReportKind = 'loans' | 'investments' | 'income' | 'expenses' | 'bank' | 'savings' | 'member-statement';
export type ReportDates = { from?: string; to?: string };
export type ReportMember = { id: string; fullName: string; memberNo: string };
export type ReportRow = { id: string } & Record<string, string>;
export type ReportData = {
  member?: ReportMember | null;
  items: ReportRow[];
  summary: { label: string; amount: string }[];
  total: number;
  page: number;
  pages: number;
};

export function reportMemberLabel(member: ReportMember) {
  return `${member.fullName} · ${member.memberNo}`;
}

type Column = { key: string; label: string; width: number; money?: boolean };
const movementColumns: Column[] = [
  { key: 'date', label: 'Date', width: 14 },
  { key: 'transactionNo', label: 'Transaction', width: 22 },
  { key: 'movement', label: 'Movement', width: 30 },
  { key: 'details', label: 'Details', width: 48 },
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

export function reportColumns(kind: ReportKind) {
  return kind === 'bank' ? bankColumns : movementColumns;
}

export function reportCell(row: ReportRow, column: Column) {
  const value = row[column.key] ?? '';
  return column.money ? bdt(value).slice(2) : value || '—';
}

export interface ReportDocument {
  data: ReportData;
  kind: ReportKind;
  title: string;
  society: string;
  period: string;
  filename: string;
}
