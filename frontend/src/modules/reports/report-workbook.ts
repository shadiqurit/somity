import writeXlsxFile, { type CellObject } from 'write-excel-file/browser';
import { reportColumns, type ReportDocument } from './report-data';

function heading(value: string): CellObject {
  return { value, fontWeight: 'bold', backgroundColor: '#1F4D3C', textColor: '#FFFFFF', wrap: true };
}

function moneyCell(amount: string): CellObject {
  // Preserve amounts beyond Excel's 15 significant digits as text.
  const digits = amount.replace(/[-.]/g, '').replace(/^0+/, '');
  return digits.length > 15 ? { value: amount, type: String } : { value: Number(amount), format: '#,##0.00' };
}

export async function downloadWorkbook({ kind, data, title, society, period, filename }: ReportDocument) {
  const columns = reportColumns(kind);
  await writeXlsxFile([
    {
      sheet: 'Summary',
      columns: [{ width: 36 }, { width: 48 }],
      data: [
        [heading(title)], ['Society', society],
        ...(data.member ? [['Member', data.member.fullName], ['Member number', data.member.memberNo]] : []),
        ['Period', period], ['Records', data.total], [],
        [heading('Metric'), heading('Amount (BDT)')],
        ...data.summary.map(item => [item.label, moneyCell(item.amount)]),
      ],
    },
    {
      sheet: kind === 'bank' ? 'Accounts' : 'Transactions',
      orientation: 'landscape',
      stickyRowsCount: 1,
      columns: columns.map(({ width }) => ({ width })),
      data: [
        columns.map(({ label }) => heading(label)),
        ...data.items.map(row => columns.map(({ key, money }) => money ? moneyCell(row[key]!) : { value: row[key] ?? '', type: String, wrap: true })),
      ],
    },
  ]).toFile(`${filename}.xlsx`);
}
