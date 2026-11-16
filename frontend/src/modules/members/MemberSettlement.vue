<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import AppForm from '../../components/forms/AppForm.vue';
import AppModal from '../../components/modals/AppModal.vue';
import ConfirmDialog from '../../components/modals/ConfirmDialog.vue';
import AppButton from '../../components/ui/AppButton.vue';
import AppInput from '../../components/ui/AppInput.vue';
import AppSelect from '../../components/ui/AppSelect.vue';
import StatusBadge from '../../components/ui/StatusBadge.vue';
import { useLocale } from '../../composables/useLocale';
import { api, errorMessage, newIdempotencyKey } from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import { date } from '../../utils/format';
import { bdt, todayDhaka, type Account, type FinancialTransaction } from '../finance/types';
import MemberDuesStatement from './MemberDuesStatement.vue';

interface Due {
  loanId: string | null;
  loanNumber: string | null;
  due: string;
  paid: string;
  pending: string;
  remaining: string;
  available: string;
}

interface Payment {
  id: string;
  transactionNo: string;
  type: 'LOAN_REPAYMENT' | 'WITHDRAWAL' | 'REVERSAL';
  status: FinancialTransaction['status'];
  amount: string;
  loanId: string | null;
  effectiveDate: string;
  reference: string;
  note: string;
  cashAccount: { name: string };
  reversalOf: { transactionNo: string } | null;
}

interface Settlement {
  id: string | null;
  status: 'NOT_STARTED' | 'OPEN' | 'CLOSED';
  openedAt: string | null;
  closedAt: string | null;
  pendingTransactions: number;
  lines: Due[];
  payments: Payment[];
}

const props = defineProps<{ memberId: string }>();
const emit = defineEmits<{ closed: [] }>();
const auth = useAuthStore();
const { t } = useLocale();
const settlement = ref<Settlement>();
const loading = ref(false);
const busy = ref(false);
const error = ref('');
const formError = ref('');
const notice = ref('');
const statementOpen = ref(false);
const selected = ref<Due & { settlementId: string }>();
const accounts = ref<Account[]>([]);
const form = ref({ cashAccountId: '', amount: '', effectiveDate: '', reference: '', note: '' });
let requestKey = '';
let requestPayload = '';

const actions = {
  start: {
    title: 'Start final settlement?',
    label: 'Confirm start',
    message: 'Starting records the current balances. Further payments for this member go through final settlement.',
    variant: 'primary',
  },
  cancel: {
    title: 'Cancel this settlement?',
    label: 'Confirm cancellation',
    message: 'Regular member transactions can resume. Pending settlement requests will be cancelled and posted payments will stay in the ledger.',
    variant: 'danger',
  },
  close: {
    title: 'Close this membership?',
    label: 'Close membership',
    message: 'All balances are cleared. Closing ends the member’s portal access and retains the final settlement and payment history.',
    variant: 'danger',
  },
} as const;
type Action = keyof typeof actions;
const confirmation = ref<{ action: Action; settlementId?: string }>();
const dialog = computed(() => actions[confirmation.value?.action ?? 'start']);
const endpoint = computed(() => `/members/${props.memberId}/settlement`);
const mayClose = computed(() => settlement.value?.status === 'OPEN' && !settlement.value.pendingTransactions &&
  settlement.value.lines.every(line => line.remaining === '0.00'));
const accountOptions = computed(() => [
  { label: 'Choose a cash or bank account', value: '' },
  ...accounts.value.filter(account => account.isActive && ['CASH', 'BANK'].includes(account.kind))
    .map(account => ({ label: `${account.name} · ${bdt(account.balance)}`, value: account.id })),
]);
async function load() {
  loading.value = true;
  error.value = '';
  const path = endpoint.value;
  try {
    const { data } = await api.get<Settlement>(path);
    if (path === endpoint.value) settlement.value = data;
  } catch (e) {
    if (path === endpoint.value) error.value = errorMessage(e);
  } finally {
    if (path === endpoint.value) loading.value = false;
  }
}

function confirmAction(action: Action) {
  const settlementId = settlement.value?.id ?? undefined;
  if (action !== 'start' && !settlementId) return;
  formError.value = '';
  confirmation.value = { action, settlementId };
}

async function openPayment(line: Due) {
  const settlementId = settlement.value?.id;
  if (!settlementId) return;
  busy.value = true;
  error.value = '';
  try {
    accounts.value = (await api.get<Account[]>('/finance/accounts')).data;
    form.value = { cashAccountId: '', amount: line.available, effectiveDate: todayDhaka(), reference: '', note: '' };
    requestKey = '';
    requestPayload = '';
    formError.value = '';
    selected.value = { ...line, settlementId };
  } catch (e) { error.value = errorMessage(e); }
  finally { busy.value = false; }
}

async function recordPayment() {
  if (!selected.value) return;
  const payload = { ...form.value, loanId: selected.value.loanId, settlementId: selected.value.settlementId };
  const fingerprint = JSON.stringify(payload);
  if (requestPayload !== fingerprint) {
    requestKey = newIdempotencyKey();
    requestPayload = fingerprint;
  }
  busy.value = true;
  formError.value = '';
  try {
    await api.post(`${endpoint.value}/payments`, payload, { headers: { 'Idempotency-Key': requestKey } });
    selected.value = undefined;
    notice.value = 'Payment submitted for approval.';
    await load();
  } catch (e) { formError.value = errorMessage(e); }
  finally { busy.value = false; }
}

async function submitAction() {
  const current = confirmation.value;
  if (!current) return;
  const { action, settlementId } = current;
  busy.value = true;
  formError.value = '';
  try {
    const path = action === 'start' ? endpoint.value : `${endpoint.value}/${action}`;
    settlement.value = (await api.post<Settlement>(path, { settlementId })).data;
    confirmation.value = undefined;
    notice.value = action === 'cancel' ? 'Settlement cancelled. Regular member transactions can resume.' : '';
    if (action === 'close') emit('closed');
  } catch (e) { formError.value = errorMessage(e); }
  finally { busy.value = false; }
}

watch(endpoint, () => {
  settlement.value = undefined;
  confirmation.value = undefined;
  selected.value = undefined;
  notice.value = '';
  void load();
}, { immediate: true });
</script>

<template>
  <section id="final-settlement" class="panel finance-statement" aria-labelledby="settlement-heading" :aria-busy="loading">
    <div class="panel-heading">
      <div>
        <h2 id="settlement-heading">{{ t('Final settlement') }}</h2>
        <p v-if="settlement?.closedAt">Membership closed on {{ date(settlement.closedAt) }}.</p>
        <p v-else-if="settlement?.status === 'CLOSED'">Membership closed.</p>
        <p v-else>Refund the member’s savings and collect any outstanding loan principal before closing the membership.</p>
        <AppButton class="settlement-record" variant="secondary" @click="statementOpen = true">{{ t('View dues statement') }}</AppButton>
      </div>
      <AppButton variant="secondary" :disabled="loading || busy" @click="load">{{ t('Refresh') }}</AppButton>
    </div>
    <p v-if="error" class="alert error" role="alert">{{ error }}</p>
    <p v-if="notice" class="alert success" role="status">{{ t(notice) }}</p>
    <template v-if="settlement">
      <ul v-if="settlement.lines.length" class="settlement-list" aria-label="Settlement dues">
        <li v-for="line in settlement.lines" :key="line.loanId ?? 'savings'" class="settlement-item">
          <div>
            <strong>{{ line.loanId ? 'Member pays Somity' : 'Somity pays member' }}</strong>
            <small class="finance-cell-note">{{ line.loanNumber ? `Loan ${line.loanNumber}` : 'Savings refund' }}</small>
            <AppButton v-if="settlement.status === 'OPEN' && auth.can('finance.write') && line.available !== '0.00'"
              variant="secondary" class="settlement-record" :disabled="busy || loading" @click="openPayment(line)">
              {{ line.loanId ? 'Record repayment' : 'Record refund' }}
            </AppButton>
          </div>
          <dl class="settlement-amounts">
            <div><dt>Due</dt><dd>{{ bdt(line.due) }}</dd></div>
            <div><dt>Paid</dt><dd>{{ bdt(line.paid) }}</dd></div>
            <div><dt>Awaiting approval</dt><dd>{{ bdt(line.pending) }}</dd></div>
            <div><dt>Remaining</dt><dd>{{ bdt(line.remaining) }}</dd></div>
          </dl>
        </li>
      </ul>
      <p v-else class="settlement-empty">No savings or loan balance is due.</p>
      <p v-if="settlement.pendingTransactions" class="under-table-note">
        {{ settlement.pendingTransactions }} pending member transaction{{ settlement.pendingTransactions === 1 ? '' : 's' }}.
        <RouterLink to="/approvals">Open approvals</RouterLink>
      </p>
      <template v-if="settlement.status === 'NOT_STARTED' && auth.can('members.archive')">
        <div class="form-actions settlement-actions">
          <AppButton :disabled="busy || loading || !!settlement.pendingTransactions" @click="confirmAction('start')">{{ t('Start final settlement') }}</AppButton>
        </div>
      </template>
      <template v-if="settlement.openedAt">
        <h3 id="settlement-history" class="settlement-history-heading">Settlement payment history</h3>
        <ul v-if="settlement.payments.length" class="settlement-list" aria-labelledby="settlement-history">
          <li v-for="payment in settlement.payments" :key="payment.id" class="settlement-item">
            <div>
              <strong>{{ payment.loanId ? 'Member repayment' : 'Somity refund' }}</strong>
              <small class="finance-cell-note">{{ payment.transactionNo }} · {{ date(payment.effectiveDate) }}</small>
              <small v-if="payment.reversalOf" class="finance-cell-note">Reversal of {{ payment.reversalOf.transactionNo }}</small>
              <small v-if="payment.reference" class="finance-cell-note">{{ payment.reference }}</small>
              <small v-if="payment.note" class="finance-cell-note">{{ payment.note }}</small>
            </div>
            <dl class="settlement-amounts payment-amounts">
              <div><dt>Account</dt><dd>{{ payment.cashAccount.name }}</dd></div>
              <div><dt>Amount</dt><dd>{{ bdt(payment.type === 'REVERSAL' ? `-${payment.amount}` : payment.amount) }}</dd></div>
              <div><dt>Status</dt><dd><StatusBadge :status="payment.status" /></dd></div>
            </dl>
          </li>
        </ul>
        <p v-else class="settlement-empty">No settlement payments recorded.</p>
        <div v-if="settlement.status === 'OPEN' && auth.can('members.archive')" class="form-actions settlement-actions">
          <AppButton variant="secondary" :disabled="loading || busy" @click="confirmAction('cancel')">{{ t('Cancel final settlement') }}</AppButton>
          <AppButton v-if="mayClose" variant="danger" :disabled="loading || busy" @click="confirmAction('close')">{{ t('Close membership') }}</AppButton>
        </div>
      </template>
    </template>
  </section>

  <AppModal :open="statementOpen" :title="t('Dues and receivables')" size="wide" @close="statementOpen = false">
    <MemberDuesStatement v-if="statementOpen" :member-id="memberId" />
  </AppModal>
  <AppModal :open="!!selected" :title="selected?.loanId ? 'Record loan repayment' : 'Record savings refund'" :busy="busy" @close="selected = undefined">
    <AppForm v-if="selected" :busy="busy" :error="formError" @submit="recordPayment">
      <p class="muted">{{ selected.loanId ? 'Member pays Somity' : 'Somity pays member' }} · Available to record {{ bdt(selected.available) }}</p>
      <AppSelect v-model="form.cashAccountId" label="Cash or bank account" :options="accountOptions" required />
      <AppInput v-model="form.amount" label="Payment amount (BDT)" inputmode="decimal"
        pattern="(0|[1-9][0-9]{0,17})(\.[0-9]{1,2})?" required maxlength="21" />
      <AppInput v-model="form.effectiveDate" label="Payment date" type="date" :max="todayDhaka()" required />
      <AppInput v-model="form.reference" label="Receipt or reference" maxlength="120" />
      <AppInput v-model="form.note" label="Payment note" maxlength="500" />
      <div class="form-actions">
        <AppButton variant="secondary" :disabled="busy" @click="selected = undefined">Cancel</AppButton>
        <AppButton type="submit" :loading="busy">Submit payment</AppButton>
      </div>
    </AppForm>
  </AppModal>
  <ConfirmDialog :open="!!confirmation" :title="t(dialog.title)" :confirm-label="t(dialog.label)"
    :confirm-variant="dialog.variant" :cancel-label="t('Go back')" :message="t(dialog.message)"
    :busy="busy" :error="formError" @close="confirmation = undefined" @confirm="submitAction" />
</template>

<style scoped>
#final-settlement { margin-bottom: 26px; }
#final-settlement .panel-heading { flex-wrap: wrap; }
.settlement-list { margin: 0; padding: 0; list-style: none; }
.settlement-item { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2.4fr); align-items: center; gap: 14px 24px; padding: 16px 24px; border-bottom: 1px solid var(--border); }
.settlement-list:last-child .settlement-item:last-child { border-bottom: 0; }
.settlement-amounts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px 16px; margin: 0; }
.payment-amounts { grid-template-columns: 1.3fr 1fr 1fr; }
.settlement-amounts dt { font-size: 12px; color: var(--text-muted); }
.settlement-amounts dd { margin: 4px 0 0; font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.settlement-record { margin-top: 8px; }
.settlement-empty, .settlement-history-heading, .settlement-actions { padding: 14px 24px; margin: 0; }
.settlement-actions { flex-wrap: wrap; }
.settlement-empty { color: var(--text-muted); }
.settlement-history-heading { border-bottom: 1px solid var(--border); }
@media (max-width: 780px) {
  .settlement-item { grid-template-columns: minmax(0, 1fr); padding-inline: 20px; }
  .settlement-amounts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .settlement-empty, .settlement-history-heading, .settlement-actions { padding-inline: 20px; }
}
</style>
