<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ExternalLink, PiggyBank, Printer, ShieldCheck, UserRound, Wallet } from 'lucide-vue-next';
import AppTable from '../../components/tables/AppTable.vue';
import AppButton from '../../components/ui/AppButton.vue';
import AppInput from '../../components/ui/AppInput.vue';
import LoadingState from '../../components/ui/LoadingState.vue';
import MemberAvatar from '../../components/ui/MemberAvatar.vue';
import StatusBadge from '../../components/ui/StatusBadge.vue';
import SummaryCard from '../../components/ui/SummaryCard.vue';
import { useLocale } from '../../composables/useLocale';
import { api, errorMessage } from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import { date, dateTime } from '../../utils/format';
import ProductReports from '../finance/ProductReports.vue';
import { bdt, type MemberStatement } from '../finance/types';
import ReportPrint from '../reports/ReportPrint.vue';
import { reportCell, reportColumns, type ReportData, type ReportDates, type ReportDocument } from '../reports/report-data';
import type { Member } from './types';

type OwnReportKind = 'member-statement' | 'savings' | 'loans' | 'loan-disbursements' | 'loan-repayments';

interface MemberLoanSummary {
  disbursed: string;
  repaid: string;
  outstanding: string;
  pending: number;
  totalLoans: number;
  activeLoans: number;
  settledLoans: number;
  nextDueDate: string | null;
}

const reportTabs: { key: OwnReportKind; label: string; title: string; description: string }[] = [
  { key: 'member-statement', label: 'All transactions', title: 'Member transaction report', description: 'Combined approved savings and loan transactions.' },
  { key: 'savings', label: 'Savings', title: 'Member savings report', description: 'Approved savings deposits, withdrawals and reversals.' },
  { key: 'loans', label: 'Combined loans', title: 'Member loan report', description: 'All approved loan disbursements and repayments.' },
  { key: 'loan-disbursements', label: 'Loan disbursement', title: 'Loan disbursement report', description: 'Approved loan principal disbursed to you.' },
  { key: 'loan-repayments', label: 'Loan repayment', title: 'Loan repayment report', description: 'Approved loan principal repayments.' },
];

const auth = useAuthStore();
const router = useRouter();
const { t } = useLocale();

const member = ref<Member>();
const loanSummary = ref<MemberLoanSummary>();
const savingsSummary = ref<MemberStatement>();
const loadingOverview = ref(false);
const overviewError = ref('');

const kind = ref<OwnReportKind>('member-statement');
const activeTab = computed(() => reportTabs.find(tab => tab.key === kind.value) ?? reportTabs[0]!);
const columns = computed(() => reportColumns(kind.value));
const from = ref('');
const to = ref('');
const applied = ref<ReportDates>({});
const filterError = ref('');
const reportResult = ref<ReportData>();
const loadingReport = ref(false);
const reportError = ref('');
const exportingPdf = ref(false);
const printed = ref<ReportDocument>();

const myInfoUrl = computed(() => router.resolve('/my-info').href);
const period = computed(() => {
  const { from: start, to: end } = applied.value;
  if (start && end) return `${date(start)} – ${date(end)}`;
  if (start) return `From ${date(start)}`;
  if (end) return `Through ${date(end)}`;
  return 'All dates';
});

const loanOutstandingDetail = computed(() => {
  if (!loanSummary.value) return '';
  const parts = [`${loanSummary.value.activeLoans} active`];
  if (loanSummary.value.nextDueDate) parts.push(`Next due ${date(loanSummary.value.nextDueDate)}`);
  return parts.join(' · ');
});

let reportRequest: AbortController | undefined;
let exportRequest: AbortController | undefined;
let originalTitle: string | undefined;

async function loadOverview() {
  loadingOverview.value = true;
  overviewError.value = '';
  try {
    const [memberRes, loanRes, savingsRes] = await Promise.all([
      api.get<Member>('/members/me'),
      api.get<MemberLoanSummary>('/finance/loan-summary/me'),
      api.get<MemberStatement>('/finance/statements/me', { params: { page: 1, pageSize: 1 } }),
    ]);
    member.value = memberRes.data;
    loanSummary.value = loanRes.data;
    savingsSummary.value = savingsRes.data;
  } catch (e) {
    overviewError.value = errorMessage(e);
  } finally {
    loadingOverview.value = false;
  }
}

async function loadReport(page = 1) {
  reportRequest?.abort();
  reportError.value = '';
  const request = new AbortController();
  reportRequest = request;
  loadingReport.value = true;
  try {
    const { data } = await api.get<ReportData>(`/finance/reports/me/${kind.value}`, {
      params: { ...applied.value, page },
      signal: request.signal,
    });
    if (!request.signal.aborted) reportResult.value = data;
  } catch (e) {
    if (!request.signal.aborted) reportError.value = errorMessage(e);
  } finally {
    if (!request.signal.aborted) loadingReport.value = false;
  }
}

function selectReport(next: OwnReportKind) {
  if (kind.value === next) return;
  kind.value = next;
  reportResult.value = undefined;
  void loadReport();
}

function applyDates() {
  filterError.value = '';
  if (from.value && to.value && from.value > to.value) {
    filterError.value = 'End date must be on or after start date.';
    return;
  }
  applied.value = { from: from.value || undefined, to: to.value || undefined };
  reportResult.value = undefined;
  void loadReport();
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

async function downloadPdf() {
  const society = auth.user?.society;
  const currentUser = auth.user;
  if (!society || !currentUser || exportingPdf.value || loadingReport.value || !reportResult.value) return;
  const request = new AbortController();
  exportRequest = request;
  exportingPdf.value = true;
  reportError.value = '';
  const memberNo = (reportResult.value.member?.memberNo ?? member.value?.memberNo ?? 'member').replace(/[^\p{L}\p{N}._-]+/gu, '-');
  const filename = [society.code, kind.value, memberNo, applied.value.from ?? 'start', applied.value.to ?? 'end'].filter(Boolean).join('-');
  try {
    const { data } = await api.get<ReportData>(`/finance/reports/me/${kind.value}`, {
      params: { ...applied.value, scope: 'full' },
      signal: request.signal,
      timeout: 60000,
    });
    if (request.signal.aborted || auth.user?.societyId !== society.id) return;
    printed.value = {
      kind: kind.value,
      title: activeTab.value.title,
      society: society.name,
      period: period.value,
      filename,
      data,
      generatedBy: {
        name: currentUser.name,
        email: currentUser.email,
        role: currentUser.roles[0]?.replaceAll('_', ' '),
      },
      generatedAt: `${dateTime(new Date())} (Asia/Dhaka)`,
    };
    originalTitle = document.title;
    document.title = filename;
    await nextTick();
    if (!request.signal.aborted && auth.user?.societyId === society.id) window.print();
  } catch (e) {
    finishPrint();
    if (!request.signal.aborted) reportError.value = errorMessage(e);
  } finally {
    if (!request.signal.aborted) exportingPdf.value = false;
  }
}

onMounted(() => {
  window.addEventListener('afterprint', finishPrint);
  void loadOverview();
  void loadReport();
});

onUnmounted(() => {
  reportRequest?.abort();
  exportRequest?.abort();
  window.removeEventListener('afterprint', finishPrint);
  finishPrint();
});
</script>

<template>
  <div class="page-heading">
    <div>
      <span class="eyebrow">YOUR PERSONAL SPACE</span>
      <h1>{{ t('My dashboard') }}<span class="heading-dot">.</span></h1>
      <p>Your savings, loan summary and transaction reports at a glance.</p>
    </div>
    <a :href="myInfoUrl" target="_blank" rel="noopener" class="btn btn-secondary">
      <UserRound :size="17" aria-hidden="true" />
      {{ t('My information') }}
      <ExternalLink :size="15" aria-hidden="true" />
    </a>
  </div>

  <div v-if="overviewError" class="alert error" role="alert">
    {{ overviewError }} <AppButton variant="ghost" @click="loadOverview">Reload</AppButton>
  </div>

  <LoadingState v-if="loadingOverview && !member" />

  <template v-else-if="member">
    <section class="panel profile-hero">
      <MemberAvatar :name="member.fullName" :document-id="member.documents[0]?.id" large />
      <div>
        <span class="member-number">{{ member.memberNo }}</span>
        <h2>{{ member.fullName }}</h2>
        <p>Member since {{ date(member.joinedAt) }}</p>
      </div>
      <StatusBadge :status="member.status" />
    </section>

    <section class="summary-grid member-overview-grid" aria-label="Savings and loan summary">
      <SummaryCard
        v-if="savingsSummary"
        :label="t('Savings balance')"
        :value="bdt(savingsSummary.closingBalance)"
        :detail="`In ${bdt(savingsSummary.deposits)} · Out ${bdt(savingsSummary.withdrawals)}`"
      >
        <PiggyBank :size="20" />
      </SummaryCard>
      <template v-if="loanSummary">
        <SummaryCard
          :label="t('Loan disbursed')"
          :value="bdt(loanSummary.disbursed)"
          :detail="`${loanSummary.totalLoans} total loan${loanSummary.totalLoans === 1 ? '' : 's'}`"
        >
          <Wallet :size="20" />
        </SummaryCard>
        <SummaryCard
          :label="t('Loan repaid')"
          :value="bdt(loanSummary.repaid)"
          :detail="`${loanSummary.settledLoans} settled`"
        >
          <ShieldCheck :size="20" />
        </SummaryCard>
        <SummaryCard
          :label="t('Loan outstanding')"
          :value="bdt(loanSummary.outstanding)"
          :detail="loanOutstandingDetail"
        >
          <Wallet :size="20" />
        </SummaryCard>
      </template>
    </section>

    <section class="panel finance-statement member-reports-panel" aria-labelledby="member-report-title">
      <div class="panel-heading member-report-heading">
        <div>
          <h2 id="member-report-title">{{ t('My transaction reports') }}</h2>
          <p>{{ activeTab.description }}</p>
        </div>
        <AppButton
          variant="secondary"
          :loading="exportingPdf"
          :disabled="loadingReport || !reportResult || exportingPdf"
          title="Download your report as PDF with your login user info and report timestamp"
          @click="downloadPdf"
        >
          <Printer :size="16" aria-hidden="true" /> {{ t('Download PDF') }}
        </AppButton>
      </div>

      <nav class="member-report-tabs" aria-label="Member report types">
        <AppButton
          v-for="tab in reportTabs"
          :key="tab.key"
          :variant="kind === tab.key ? 'primary' : 'secondary'"
          :aria-pressed="kind === tab.key"
          :disabled="exportingPdf"
          @click="selectReport(tab.key)"
        >
          {{ t(tab.label) }}
        </AppButton>
      </nav>

      <form class="member-report-filters" @submit.prevent="applyDates">
        <AppInput v-model="from" :label="t('From date')" type="date" :disabled="exportingPdf" />
        <AppInput v-model="to" :label="t('To date')" type="date" :disabled="exportingPdf" :error="filterError" />
        <AppButton type="submit" variant="secondary" :disabled="exportingPdf">{{ t('Apply dates') }}</AppButton>
        <AppButton v-if="from || to || applied.from || applied.to" variant="ghost" :disabled="exportingPdf" @click="clearDates">Clear</AppButton>
      </form>

      <div v-if="reportError" class="alert error member-report-error" role="alert">
        {{ reportError }} <AppButton variant="ghost" @click="loadReport(reportResult?.page)">Reload report</AppButton>
      </div>

      <section v-if="reportResult" class="member-report-totals" aria-label="Report totals">
        <p class="muted member-report-period">
          <strong>{{ member.fullName }} · {{ member.memberNo }} · </strong>{{ period }}
        </p>
        <div class="member-report-summary">
          <SummaryCard v-for="item in reportResult.summary" :key="item.label" :label="t(item.label)" :value="bdt(item.amount)" detail="" />
        </div>
      </section>

      <AppTable
        v-if="loadingReport || reportResult"
        :rows="reportResult?.items ?? []"
        :columns="columns"
        :loading="loadingReport"
        :page="reportResult?.page"
        :pages="reportResult?.pages"
        :total="reportResult?.total"
        @page="loadReport"
      >
        <template v-for="column in columns" :key="column.key" #[`cell-${column.key}`]="{ row }">
          <span :class="{ 'report-money': column.money, 'report-details': column.key === 'details' }">{{ reportCell(row, column) }}</span>
        </template>
        <template #empty>No approved transactions in this period.</template>
      </AppTable>
    </section>

    <ProductReports kind="loans" :own="true" />
  </template>

  <ReportPrint v-if="printed" :report="printed" />
</template>

<style scoped>
.member-overview-grid { margin-top: 20px; }
.member-report-heading { flex-wrap: wrap; gap: 12px; }
.member-report-tabs { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 23px 16px; border-bottom: 1px solid var(--border); }
.member-report-filters { display: flex; flex-wrap: wrap; align-items: start; gap: 12px; padding: 16px 23px 20px; }
.member-report-filters :deep(.field) { flex: 0 1 190px; min-width: 130px; }
.member-report-filters .btn { margin-top: 27px; }
.member-report-error { margin: 0 23px 16px; }
.member-report-totals { padding: 0 23px 20px; }
.member-report-period { margin: 0 0 8px; font-size: 13px; overflow-wrap: anywhere; }
.member-report-summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(180px, 100%), 1fr)); gap: 10px; }
.member-report-summary :deep(.summary-card) { min-width: 0; background: var(--surface-subtle); padding: 14px; }
.member-report-summary :deep(.summary-card strong) { font-size: clamp(18px, 2vw, 25px); line-height: 1.2; overflow-wrap: anywhere; }
.report-money { display: block; text-align: right; font-variant-numeric: tabular-nums; }
.report-details { display: block; min-width: 145px; max-width: 430px; overflow-wrap: anywhere; white-space: normal; }
@media (max-width: 640px) {
  .member-report-tabs, .member-report-filters, .member-report-totals { padding-inline: 16px; }
  .member-report-filters :deep(.field) { flex: 1 1 125px; min-width: 0; }
  .member-report-filters .btn { margin-top: 0; align-self: end; }
  .member-report-summary { grid-template-columns: repeat(auto-fit, minmax(min(145px, 100%), 1fr)); }
}
</style>
