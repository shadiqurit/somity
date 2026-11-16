<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import AppButton from '../../components/ui/AppButton.vue';
import AppInput from '../../components/ui/AppInput.vue';
import { useLocale } from '../../composables/useLocale';
import { api, errorMessage } from '../../services/api';
import { bdt } from '../finance/types';

type MovementType = 'DEPOSIT' | 'WITHDRAWAL' | 'LOAN_DISBURSEMENT' | 'LOAN_REPAYMENT';
interface Entry {
  id: string;
  transactionNo: string;
  effectiveDate: string;
  type: MovementType | 'REVERSAL';
  reference: string;
  note: string;
  accountName: string;
  loanNumber: string | null;
  settlement: boolean;
  reversalOf: { transactionNo: string; type: MovementType } | null;
  paidByMember: string;
  paidBySociety: string;
  savingsAfter: string;
  loanAfter: string;
}

interface Statement {
  savings: { opening: string; deposits: string; withdrawals: string; closing: string };
  loans: { opening: string; disbursed: string; repaid: string; closing: string };
  items: Entry[];
  page: number;
  pages: number;
}

const props = defineProps<{ memberId: string }>();
const { locale, t } = useLocale();
const result = ref<Statement>();
const loading = ref(false);
const error = ref('');
const dates = ref({ from: '', to: '' });
let appliedDates = { from: '', to: '' };
let sequence = 0;

const labels: Record<Entry['type'], string> = {
  DEPOSIT: 'Savings deposit', WITHDRAWAL: 'Savings withdrawal',
  LOAN_DISBURSEMENT: 'Loan disbursement', LOAN_REPAYMENT: 'Loan repayment', REVERSAL: 'Reversal',
};
const dateFormat = computed(() => new Intl.DateTimeFormat(locale.value === 'bn' ? 'bn-BD' : 'en-BD', {
  dateStyle: 'medium', timeZone: 'Asia/Dhaka',
}));
const groups = computed(() => {
  if (!result.value) return [];
  const { savings, loans } = result.value;
  return [
    { title: 'Somity owes the member', fields: [
      { label: 'Opening balance', amount: savings.opening }, { label: 'Savings received', amount: savings.deposits },
      { label: 'Savings paid out', amount: savings.withdrawals }, { label: 'Closing balance', amount: savings.closing },
    ] },
    { title: 'Member owes Somity', fields: [
      { label: 'Opening balance', amount: loans.opening }, { label: 'Loan disbursed', amount: loans.disbursed },
      { label: 'Loan repaid', amount: loans.repaid }, { label: 'Closing balance', amount: loans.closing },
    ] },
  ];
});

async function load(page = 1, period = appliedDates) {
  const request = ++sequence;
  loading.value = true;
  error.value = '';
  try {
    const { data } = await api.get<Statement>(`/members/${props.memberId}/settlement/statement`, {
      params: { from: period.from || undefined, to: period.to || undefined, page },
    });
    if (request === sequence) {
      result.value = data;
      appliedDates = period;
    }
  } catch (e) {
    if (request === sequence) error.value = errorMessage(e);
  } finally {
    if (request === sequence) loading.value = false;
  }
}

onMounted(() => load());
</script>

<template>
  <div class="member-dues" :aria-busy="loading">
    <form class="dues-filters" @submit.prevent="load(1, { ...dates })">
      <AppInput v-model="dates.from" :label="t('From date')" type="date" :max="dates.to || undefined" />
      <AppInput v-model="dates.to" :label="t('To date')" type="date" :min="dates.from || undefined" />
      <AppButton type="submit" variant="secondary" :loading="loading">{{ t('Apply dates') }}</AppButton>
    </form>
    <p v-if="error" role="alert" class="alert error">{{ error }}</p>
    <p v-if="loading && !result" role="status" class="muted">{{ t('Loading statement…') }}</p>
    <template v-if="result">
      <div class="dues-summary">
        <article v-for="group in groups" :key="group.title" class="dues-balance">
          <h3>{{ t(group.title) }}</h3>
          <dl class="dues-amounts">
            <div v-for="field in group.fields" :key="field.label">
              <dt>{{ t(field.label) }}</dt><dd>{{ bdt(field.amount) }}</dd>
            </div>
          </dl>
        </article>
      </div>
      <h3 id="dues-transactions">{{ t('Posted member transactions') }}</h3>
      <ol v-if="result.items.length" class="dues-entries" aria-labelledby="dues-transactions">
        <li v-for="entry in result.items" :key="entry.id">
          <div>
            <strong>{{ t(labels[entry.type]) }}</strong>
            <small class="finance-cell-note">{{ dateFormat.format(new Date(entry.effectiveDate)) }} · {{ entry.transactionNo }}</small>
            <small class="finance-cell-note">{{ entry.accountName }}<template v-if="entry.settlement"> · {{ t('Final settlement') }}</template></small>
            <small v-if="entry.loanNumber && entry.loanNumber !== entry.transactionNo" class="finance-cell-note">{{ t('Loan') }} · {{ entry.loanNumber }}</small>
            <small v-if="entry.reversalOf" class="finance-cell-note">{{ t('Reverses') }} {{ t(labels[entry.reversalOf.type]) }} · {{ entry.reversalOf.transactionNo }}</small>
            <small v-if="entry.reference" class="finance-cell-note">{{ entry.reference }}</small>
            <small v-if="entry.note" class="finance-cell-note">{{ entry.note }}</small>
          </div>
          <dl class="dues-amounts">
            <div><dt>{{ t('Member paid') }}</dt><dd>{{ bdt(entry.paidByMember) }}</dd></div>
            <div><dt>{{ t('Somity paid') }}</dt><dd>{{ bdt(entry.paidBySociety) }}</dd></div>
            <div><dt>{{ t('Savings balance after entry') }}</dt><dd>{{ bdt(entry.savingsAfter) }}</dd></div>
            <div><dt>{{ t('Loan balance after entry') }}</dt><dd>{{ bdt(entry.loanAfter) }}</dd></div>
          </dl>
        </li>
      </ol>
      <p v-else class="muted">{{ t('No posted member transactions in this period.') }}</p>
      <div v-if="result.pages > 1 || result.page > 1" class="dues-pagination">
        <span class="muted">{{ t('Page') }} {{ result.page }} / {{ Math.max(result.pages, 1) }}</span>
        <div class="button-row">
          <AppButton variant="secondary" :disabled="loading || result.page <= 1" @click="load(result.page - 1)">{{ t('Previous') }}</AppButton>
          <AppButton variant="secondary" :disabled="loading || result.page >= result.pages" @click="load(result.page + 1)">{{ t('Next') }}</AppButton>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.member-dues { display: grid; gap: 16px; }
.dues-filters { display: flex; align-items: end; gap: 12px; flex-wrap: wrap; }
.dues-filters > .field { flex: 1; min-width: 124px; }
.dues-summary { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.dues-balance { padding: 14px; border: 1px solid var(--border); border-radius: 8px; }
.dues-balance h3 { margin-bottom: 10px; font-size: 15px; }
.dues-amounts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 14px; margin: 0; }
.dues-amounts dt { font-size: 12px; color: var(--text-muted); }
.dues-amounts dd { margin: 4px 0 0; font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.dues-entries { list-style: none; padding: 0; margin: 0; }
.dues-entries > li { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px 20px; padding: 14px 0; border-top: 1px solid var(--border); }
.dues-pagination { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
@media (max-width: 640px) {
  .dues-summary, .dues-entries > li { grid-template-columns: minmax(0, 1fr); }
}
</style>
