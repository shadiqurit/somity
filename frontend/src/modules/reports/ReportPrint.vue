<script setup lang="ts">
import { computed } from 'vue';
import { bdt } from '../finance/types';
import { reportCell, reportColumns, reportMemberLabel, type ReportDocument } from './report-data';

const props = defineProps<{ report: ReportDocument }>();
const columns = computed(() => reportColumns(props.report.kind));
</script>

<template>
  <Teleport to="body">
    <article class="report-print">
      <header>
        <p>{{ report.society }}</p>
        <h1>{{ report.title }}</h1>
        <p v-if="report.data.member">{{ reportMemberLabel(report.data.member) }}</p>
        <p>{{ report.period }} · {{ report.data.total }} records · BDT</p>
      </header>
      <dl class="report-print-summary">
        <div v-for="item in report.data.summary" :key="item.label">
          <dt>{{ item.label }}</dt><dd>{{ bdt(item.amount).slice(2) }}</dd>
        </div>
      </dl>
      <table>
        <thead><tr><th v-for="column in columns" :key="column.key" scope="col" :class="{ amount: column.money }">{{ column.label }}</th></tr></thead>
        <tbody>
          <tr v-for="row in report.data.items" :key="row.id">
            <td v-for="column in columns" :key="column.key" :class="{ amount: column.money }">{{ reportCell(row, column) }}</td>
          </tr>
          <tr v-if="!report.data.items.length"><td :colspan="columns.length">No records for this period.</td></tr>
        </tbody>
      </table>
    </article>
  </Teleport>
</template>

<style>
.report-print { display: none; }
@media print {
  @page somity-report { size: A4 landscape; margin: 14mm; }
  body:has(.report-print) { margin: 0; background: white; }
  body:has(.report-print) #app { display: none !important; }
  .report-print { display: block; page: somity-report; color: #172721; background: white; font: 10pt/1.45 system-ui, sans-serif; }
  .report-print header { border-bottom: 2px solid #1f4d3c; padding-bottom: 10pt; }
  .report-print header h1 { font-size: 23pt; margin: 2pt 0; }
  .report-print header p { margin: 0; }
  .report-print-summary { display: flex; flex-wrap: wrap; gap: 10pt 22pt; margin: 12pt 0; break-inside: avoid; }
  .report-print-summary div { min-width: 105pt; }
  .report-print-summary dt { font-size: 9pt; }
  .report-print-summary dd { font-weight: bold; margin: 2pt 0 0; }
  .report-print table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  .report-print thead { display: table-header-group; }
  .report-print tr { break-inside: avoid; }
  .report-print th, .report-print td { padding: 5pt 6pt; color: #172721; border-bottom: 1px solid #bac8c0; vertical-align: top; text-align: left; white-space: normal; overflow-wrap: anywhere; }
  .report-print th { border-bottom: 2px solid #1f4d3c; }
  .report-print .amount { text-align: right; white-space: nowrap; }
}
</style>
