<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { ArrowDownLeft, ArrowUpRight, ChartNoAxesCombined, FileSpreadsheet, Landmark, ListOrdered, PiggyBank, Printer, UserRound, Wallet } from 'lucide-vue-next';
import AppTable from '../../components/tables/AppTable.vue';
import AppButton from '../../components/ui/AppButton.vue';
import AppInput from '../../components/ui/AppInput.vue';
import SummaryCard from '../../components/ui/SummaryCard.vue';
import { useLocale } from '../../composables/useLocale';
import { api, errorMessage } from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import { date } from '../../utils/format';
import { bdt } from '../finance/types';
import ReportAccountPicker from './ReportAccountPicker.vue';
import ReportMemberPicker from './ReportMemberPicker.vue';
import ReportPrint from './ReportPrint.vue';
import { isLoanReport, reportAccountLabel, reportCell, reportColumns, reportMemberLabel, type LoanReportKind, type ReportData, type ReportDates, type ReportDocument, type ReportKind, type ReportMember } from './report-data';

const reportOptions = {
  loans: { title: 'Loans', icon: Wallet },
  investments: { title: 'Investments', icon: ChartNoAxesCombined, description: 'Principal movements and realized investment profit.' },
  income: { title: 'Income', icon: ArrowDownLeft, description: 'Other income and investment profit, including reversals.' },
  expenses: { title: 'Expenses', icon: ArrowUpRight, description: 'Posted expenses, reversals and net spending.' },
  bank: { title: 'Cash & bank', icon: Landmark, description: 'Opening balances, account movements and closing balances.' },
  'bank-statement': { title: 'Bank statement', icon: ListOrdered, description: 'Posted transactions and running balances for one account.' },
  savings: { title: 'Member savings', icon: PiggyBank, description: 'Member deposits, withdrawals and savings balances.' },
  'member-statement': { title: 'Member statement', icon: UserRound, description: 'Combined savings and loan activity for one member.' },
} satisfies Record<Exclude<ReportKind, 'loan-disbursements' | 'loan-repayments'>, { title: string; icon: typeof Wallet; description?: string }>;

const loanReports = {
  loans: { label: 'Combined', title: 'Combined loans', description: 'Disbursements, repayments and opening and closing receivables.' },
  'loan-disbursements': { label: 'Loan disbursement', title: 'Loan disbursement', description: 'Principal paid out to members and posted disbursement reversals.' },
  'loan-repayments': { label: 'Loan repayment', title: 'Loan repayment', description: 'Principal received from members and posted repayment reversals.' },
} satisfies Record<LoanReportKind, { label: string; title: string; description: string }>;

const auth = useAuthStore();
const { t } = useLocale();
const kind = ref<ReportKind>('loans');
const category = computed(() => isLoanReport(kind.value) ? 'loans' : kind.value);
const active = computed(() => isLoanReport(kind.value) ? loanReports[kind.value] : reportOptions[kind.value]);
const columns = computed(() => reportColumns(kind.value));
const from = ref('');
const to = ref('');
const applied = ref<ReportDates>({});
const selectedMember = ref<ReportMember>();
const selectedAccount = ref('');
const requiresMember = computed(() => kind.value === 'member-statement');
const supportsMember = computed(() => requiresMember.value || isLoanReport(kind.value) || kind.value === 'savings');
const requiresAccount = computed(() => kind.value === 'bank-statement');
const supportsAccount = computed(() => requiresAccount.value || kind.value === 'bank');
const reportParams = computed(() => ({
  ...applied.value,
  memberId: supportsMember.value ? selectedMember.value?.id : undefined,
  accountId: supportsAccount.value ? selectedAccount.value || undefined : undefined,
}));
const result = ref<ReportData>();
const loading = ref(false);
const exporting = ref<'excel' | 'pdf'>();
const printed = ref<ReportDocument>();
const error = ref('');
const filterError = ref('');
const period = computed(() => {
  const { from, to } = applied.value;
  if (from && to) return `${date(from)} – ${date(to)}`;
  if (from) return `From ${date(from)}`;
  if (to) return `Through ${date(to)}`;
  return 'All dates';
});

let previewRequest: AbortController | undefined;
let exportRequest: AbortController | undefined;
let originalTitle: string | undefined;

async function load(page = 1) {
  previewRequest?.abort();
  error.value = '';
  if ((requiresMember.value && !selectedMember.value) || (requiresAccount.value && !selectedAccount.value)) {
    loading.value = false;
    return;
  }
  const request = new AbortController();
  previewRequest = request;
  loading.value = true;
  try {
    const { data } = await api.get<ReportData>(`/finance/reports/${kind.value}`, {
      params: { ...reportParams.value, page }, signal: request.signal,
    });
    if (!request.signal.aborted) result.value = data;
  } catch (cause) {
    if (!request.signal.aborted) error.value = errorMessage(cause);
  } finally {
    if (!request.signal.aborted) loading.value = false;
  }
}

function select(report: ReportKind) {
  if (kind.value === report) return;
  kind.value = report;
  result.value = undefined;
  void load();
}

function selectMember(member: ReportMember | undefined) {
  if (member?.id === selectedMember.value?.id) return;
  selectedMember.value = member;
  result.value = undefined;
  void load();
}

function selectAccount(accountId: string) {
  if (accountId === selectedAccount.value) return;
  selectedAccount.value = accountId;
  result.value = undefined;
  void load();
}

function applyDates() {
  filterError.value = '';
  if (from.value && to.value && from.value > to.value) {
    filterError.value = 'End date must be on or after start date.';
    return;
  }
  applied.value = { from: from.value || undefined, to: to.value || undefined };
  result.value = undefined;
  void load();
}

function clearDates() {
  from.value = '';
  to.value = '';
  applyDates();
}

function finishPrint() {
  printed.value = undefined;
  if (originalTitle !== undefined) {
    document.title = originalTitle;
    originalTitle = undefined;
  }
}

async function exportReport(format: 'excel' | 'pdf') {
  const society = auth.user?.society;
  if (!society || exporting.value || loading.value || !result.value) return;
  const request = new AbortController();
  exportRequest = request;
  exporting.value = format;
  error.value = '';
  const memberNo = result.value.member?.memberNo.replace(/[^\p{L}\p{N}._-]+/gu, '-');
  const filenameParts = [society.code, kind.value, result.value.account?.code ?? memberNo, applied.value.from ?? 'start', applied.value.to ?? 'end'];
  const report = {
    kind: kind.value, title: requiresMember.value || requiresAccount.value ? active.value.title : `${active.value.title} report`, society: society.name, period: period.value,
    filename: filenameParts.filter(Boolean).join('-'),
  };
  try {
    const { data } = await api.get<ReportData>(`/finance/reports/${report.kind}`, {
      params: { ...reportParams.value, scope: 'full' }, signal: request.signal, timeout: 60000,
    });
    if (request.signal.aborted || auth.user?.societyId !== society.id) return;
    if (format === 'excel') {
      const { downloadWorkbook } = await import('./report-workbook');
      if (!request.signal.aborted && auth.user?.societyId === society.id) await downloadWorkbook({ ...report, data });
    } else {
      printed.value = { ...report, data };
      originalTitle = document.title;
      document.title = report.filename;
      await nextTick();
      if (!request.signal.aborted && auth.user?.societyId === society.id) window.print();
    }
  } catch (cause) {
    if (format === 'pdf') finishPrint();
    if (!request.signal.aborted) error.value = errorMessage(cause);
  } finally {
    if (!request.signal.aborted) exporting.value = undefined;
  }
}

onMounted(() => {
  window.addEventListener('afterprint', finishPrint);
  void load();
});
onUnmounted(() => {
  previewRequest?.abort();
  exportRequest?.abort();
  window.removeEventListener('afterprint', finishPrint);
  finishPrint();
});
</script>

<template>
  <header class="page-heading">
    <div>
      <h1>{{ t('Reports dashboard') }}</h1>
      <p>Review and export posted financial activity for {{ auth.user?.society?.name }}.</p>
    </div>
  </header>

  <nav class="report-options" aria-label="Report types">
    <button v-for="(report, key) in reportOptions" :key="key" type="button" :aria-pressed="category === key" :disabled="!!exporting" @click="select(key)">
      <component :is="report.icon" :size="19" aria-hidden="true" />
      {{ t(report.title) }}
    </button>
  </nav>

  <section class="panel" aria-labelledby="report-title">
    <nav v-if="category === 'loans'" class="loan-report-options" aria-label="Loan report types">
      <AppButton v-for="(report, key) in loanReports" :key="key" :variant="kind === key ? 'primary' : 'secondary'"
        :aria-pressed="kind === key" :disabled="!!exporting" @click="select(key)">{{ t(report.label) }}</AppButton>
    </nav>
    <div class="panel-heading report-heading">
      <div><h2 id="report-title">{{ t(active.title) }}</h2><p>{{ active.description }}</p></div>
      <div class="button-row report-exports">
        <AppButton variant="secondary" :loading="exporting === 'pdf'" :disabled="loading || !result || !!exporting" title="Choose Save as PDF in the print dialog" @click="exportReport('pdf')">
          <Printer :size="16" aria-hidden="true" /> Save as PDF
        </AppButton>
        <AppButton :loading="exporting === 'excel'" :disabled="loading || !result || !!exporting" @click="exportReport('excel')">
          <FileSpreadsheet :size="16" aria-hidden="true" /> Download Excel
        </AppButton>
      </div>
    </div>

    <ReportMemberPicker v-if="supportsMember" :member="selectedMember" :required="requiresMember" :disabled="!!exporting" @change="selectMember" />
    <ReportAccountPicker v-if="supportsAccount" :model-value="selectedAccount" :required="requiresAccount" :disabled="!!exporting" @update:model-value="selectAccount" />

    <form class="report-filters" @submit.prevent="applyDates">
      <AppInput v-model="from" label="From date" type="date" :disabled="!!exporting" />
      <AppInput v-model="to" label="To date" type="date" :disabled="!!exporting" :error="filterError" />
      <AppButton type="submit" variant="secondary" :disabled="!!exporting">Apply dates</AppButton>
      <AppButton v-if="from || to || applied.from || applied.to" variant="ghost" :disabled="!!exporting" @click="clearDates">Clear</AppButton>
    </form>

    <div v-if="error" class="alert error report-error" role="alert">
      {{ error }} <AppButton variant="ghost" @click="load(result?.page)">Reload report</AppButton>
    </div>
    <p v-if="requiresMember && !selectedMember" class="muted report-error">Choose a member to view their statement.</p>
    <p v-if="requiresAccount && !selectedAccount" class="muted report-error">Choose an account to view its statement.</p>
    <section v-if="result" class="report-totals" aria-label="Report totals">
      <p class="muted report-period">
        <strong v-if="result.member">{{ reportMemberLabel(result.member) }} · </strong>
        <strong v-if="result.account">{{ reportAccountLabel(result.account) }} · </strong>{{ period }}
      </p>
      <div class="report-summary">
        <SummaryCard v-for="item in result.summary" :key="item.label" :label="t(item.label)" :value="bdt(item.amount)" detail="" />
      </div>
    </section>
    <AppTable v-if="loading || result" :rows="result?.items ?? []" :columns="columns" :loading="loading"
      :page="kind === 'bank' ? undefined : result?.page" :pages="result?.pages" :total="result?.total" @page="load">
      <template v-for="column in columns" :key="column.key" #[`cell-${column.key}`]="{ row }">
        <span :class="{ 'report-money': column.money, 'report-details': column.key === 'details' }">{{ reportCell(row, column) }}</span>
      </template>
      <template #empty>No records for this period.</template>
    </AppTable>
  </section>

  <ReportPrint v-if="printed" :report="printed" />
</template>

<style scoped>
.report-options { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; margin-bottom: 20px; }
.report-options button { display: flex; align-items: center; gap: 10px; padding: 13px; text-align: left; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text-secondary); font-size: 14px; font-weight: 600; }
.report-options svg { flex-shrink: 0; color: var(--accent); }
.report-options button:hover { background: var(--surface-hover); }
.report-options button[aria-pressed='true'] { background: var(--accent-subtle); border-color: var(--accent-border); color: var(--accent); box-shadow: inset 0 -2px var(--accent); }
.report-heading, .report-exports { flex-wrap: wrap; }
.loan-report-options { display: flex; flex-wrap: wrap; gap: 8px; padding: 16px 23px; border-bottom: 1px solid var(--border); }
.report-filters { display: flex; flex-wrap: wrap; align-items: start; gap: 12px; padding: 0 23px 20px; }
.report-filters :deep(.field) { flex: 0 1 190px; min-width: 130px; }
.report-filters .btn { margin-top: 27px; }
.report-error { margin: 0 23px 16px; }
.report-totals { padding: 0 23px 20px; }
.report-period { margin: 0 0 8px; font-size: 13px; overflow-wrap: anywhere; }
.report-summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(180px, 100%), 1fr)); gap: 10px; }
.report-summary :deep(.summary-card) { min-width: 0; background: var(--surface-subtle); padding: 14px; }
.report-summary :deep(.summary-card strong) { font-size: clamp(18px, 2vw, 25px); line-height: 1.2; overflow-wrap: anywhere; }
.report-money { display: block; text-align: right; font-variant-numeric: tabular-nums; }
.report-details { display: block; min-width: 145px; max-width: 430px; overflow-wrap: anywhere; white-space: normal; }
@media (max-width: 640px) {
  .report-filters, .report-totals, .loan-report-options { padding-inline: 16px; }
  .report-filters :deep(.field) { flex: 1 1 125px; min-width: 0; }
  .report-filters .btn { margin-top: 0; align-self: end; }
  .report-summary { grid-template-columns: repeat(auto-fit, minmax(min(145px, 100%), 1fr)); }
}
</style>
