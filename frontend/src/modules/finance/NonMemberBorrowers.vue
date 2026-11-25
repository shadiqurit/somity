<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { Plus, UserPlus } from 'lucide-vue-next';
import { api, errorMessage } from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import { useLocale } from '../../composables/useLocale';
import { date } from '../../utils/format';
import { bdt, type NonMemberBorrower, type NonMemberBorrowerDetail } from './types';
import AppTable from '../../components/tables/AppTable.vue';
import AppButton from '../../components/ui/AppButton.vue';
import AppInput from '../../components/ui/AppInput.vue';
import AppModal from '../../components/modals/AppModal.vue';
import AppForm from '../../components/forms/AppForm.vue';
import StatusBadge from '../../components/ui/StatusBadge.vue';
import SummaryCard from '../../components/ui/SummaryCard.vue';

const props = defineProps<{ refresh?: number }>();
const emit = defineEmits<{ entry: [value: { type: string; borrowerId?: string; loanId?: string; label?: string }] }>();
const auth = useAuthStore();
const { t } = useLocale();

const items = ref<NonMemberBorrower[]>([]);
const total = ref(0);
const page = ref(1);
const pages = ref(1);
const loading = ref(false);
const error = ref('');
const notice = ref('');
const search = ref('');

const editorOpen = ref(false);
const editingId = ref<string | null>(null);
const busy = ref(false);
const formError = ref('');
const blankForm = () => ({
  borrowerNo: '',
  fullName: '',
  phone: '',
  identityNumber: '',
  address: '',
  guarantorName: '',
  guarantorPhone: '',
  note: '',
  isActive: true,
});
const form = reactive(blankForm());

const selected = ref<NonMemberBorrowerDetail>();
const detailLoading = ref(false);

const columns = [
  { key: 'fullName', label: 'Borrower' },
  { key: 'phone', label: 'Contact' },
  { key: 'loanCount', label: 'Loans' },
  { key: 'disbursed', label: 'Disbursed' },
  { key: 'repaid', label: 'Repaid' },
  { key: 'outstanding', label: 'Outstanding' },
  { key: 'actions', label: 'Actions' },
];

let sequence = 0;
async function load(value = 1) {
  const request = ++sequence;
  page.value = value;
  loading.value = true;
  error.value = '';
  try {
    const { data } = await api.get('/finance/borrowers', {
      params: { search: search.value || undefined, page: value, pageSize: 20 },
    });
    if (request !== sequence) return;
    items.value = data.items;
    total.value = data.total;
    pages.value = data.pages;
  } catch (e) {
    if (request === sequence) error.value = errorMessage(e);
  } finally {
    if (request === sequence) loading.value = false;
  }
}

function openCreate() {
  editingId.value = null;
  Object.assign(form, blankForm());
  formError.value = '';
  editorOpen.value = true;
}

function openEdit(row: NonMemberBorrower) {
  editingId.value = row.id;
  Object.assign(form, {
    borrowerNo: row.borrowerNo,
    fullName: row.fullName,
    phone: row.phone,
    identityNumber: row.identityNumber ?? '',
    address: row.address ?? '',
    guarantorName: row.guarantorName ?? '',
    guarantorPhone: row.guarantorPhone ?? '',
    note: row.note ?? '',
    isActive: row.isActive,
  });
  formError.value = '';
  editorOpen.value = true;
}

async function save() {
  busy.value = true;
  formError.value = '';
  try {
    const payload = {
      ...(form.borrowerNo.trim() ? { borrowerNo: form.borrowerNo.trim() } : {}),
      fullName: form.fullName.trim(),
      phone: form.phone.trim(),
      identityNumber: form.identityNumber.trim(),
      address: form.address.trim(),
      guarantorName: form.guarantorName.trim(),
      guarantorPhone: form.guarantorPhone.trim(),
      note: form.note.trim(),
      ...(editingId.value ? { isActive: form.isActive } : {}),
    };
    if (editingId.value) {
      await api.patch(`/finance/borrowers/${editingId.value}`, payload);
      notice.value = t('Non-member borrower updated.');
    } else {
      await api.post('/finance/borrowers', payload);
      notice.value = t('Non-member borrower added.');
    }
    editorOpen.value = false;
    await load(page.value);
    if (selected.value && selected.value.id === editingId.value) {
      await openDetail(selected.value.id);
    }
  } catch (e) {
    formError.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

async function openDetail(id: string) {
  detailLoading.value = true;
  error.value = '';
  try {
    selected.value = (await api.get(`/finance/borrowers/${id}`)).data;
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    detailLoading.value = false;
  }
}

function startLoan(borrower: { id: string; fullName: string; borrowerNo: string }) {
  selected.value = undefined;
  emit('entry', { type: 'LOAN_DISBURSEMENT', borrowerId: borrower.id, label: `${borrower.fullName} · ${borrower.borrowerNo}` });
}

function startRepayment(loanId: string, borrowerName: string) {
  selected.value = undefined;
  emit('entry', { type: 'LOAN_REPAYMENT', loanId, label: `${borrowerName} (${t('Non-member')})` });
}

watch(() => props.refresh, () => load(page.value));
onMounted(() => load());
</script>

<template>
  <section class="panel finance-statement product-report">
    <div class="panel-heading">
      <div>
        <h2>{{ t('Non-member borrowers') }}</h2>
        <p>{{ t('External borrowers who receive and repay loans without membership, deposits, or login access.') }}</p>
      </div>
      <AppButton v-if="auth.can('finance.write')" @click="openCreate">
        <UserPlus :size="17" /> {{ t('Add non-member') }}
      </AppButton>
    </div>

    <div v-if="notice" class="alert success" role="status">{{ notice }}</div>
    <div v-if="error" class="alert error" role="alert">{{ error }} <AppButton variant="ghost" @click="load()">Retry</AppButton></div>

    <form class="finance-filters" @submit.prevent="load(1)">
      <AppInput v-model="search" :label="t('Search non-member borrowers')" placeholder="Name, phone, ID, or borrower no." />
      <AppButton type="submit" variant="secondary" :loading="loading">Search</AppButton>
    </form>

    <AppTable :rows="items" :columns="columns" :page="page" :pages="pages" :total="total" :loading="loading" @page="load">
      <template #cell-fullName="{ row }">
        <strong>{{ row.fullName }}</strong>
        <span v-if="!row.isActive" class="borrower-tag inactive">Inactive</span>
        <small class="finance-cell-note">{{ row.borrowerNo }}<template v-if="row.address"> · {{ row.address }}</template></small>
      </template>
      <template #cell-phone="{ row }">
        {{ row.phone }}
        <small v-if="row.identityNumber" class="finance-cell-note">ID: {{ row.identityNumber }}</small>
      </template>
      <template #cell-loanCount="{ row }">
        {{ row.loanCount }}
        <small v-if="row.pendingCount" class="finance-cell-note">{{ row.pendingCount }} pending</small>
      </template>
      <template #cell-disbursed="{ row }">{{ bdt(row.disbursed) }}</template>
      <template #cell-repaid="{ row }">{{ bdt(row.repaid) }}</template>
      <template #cell-outstanding="{ row }"><strong>{{ bdt(row.outstanding) }}</strong></template>
      <template #cell-actions="{ row }">
        <div class="button-row">
          <AppButton variant="ghost" :loading="detailLoading" @click="openDetail(row.id)">Details</AppButton>
          <AppButton v-if="auth.can('finance.write')" variant="ghost" @click="openEdit(row)">Edit</AppButton>
          <AppButton v-if="auth.can('finance.write') && row.isActive" variant="secondary" @click="startLoan(row)">
            <Plus :size="15" /> {{ t('New loan') }}
          </AppButton>
        </div>
      </template>
      <template #empty>{{ t('No non-member borrowers yet. Add one to disburse a non-member loan.') }}</template>
    </AppTable>

    <AppModal
      :open="editorOpen"
      :title="editingId ? t('Edit non-member borrower') : t('Add non-member borrower')"
      :description="t('Non-member borrowers only have loan records — no membership, no deposits, and no login account.')"
      :busy="busy"
      @close="editorOpen = false"
    >
      <AppForm :busy="busy" :error="formError" @submit="save">
        <div class="form-grid">
          <AppInput v-model="form.fullName" label="Full name" maxlength="120" required />
          <AppInput v-model="form.phone" label="Phone number" maxlength="25" required />
        </div>
        <div class="form-grid">
          <AppInput v-model="form.identityNumber" label="NID / Identity number (optional)" maxlength="40" />
          <AppInput v-model="form.borrowerNo" label="Borrower number (optional, auto if blank)" placeholder="NML-0001" maxlength="32" />
        </div>
        <AppInput v-model="form.address" label="Address (optional)" maxlength="500" />
        <div class="form-grid">
          <AppInput v-model="form.guarantorName" label="Guarantor / reference name (optional)" maxlength="120" />
          <AppInput v-model="form.guarantorPhone" label="Guarantor phone (optional)" maxlength="25" />
        </div>
        <AppInput v-model="form.note" label="Note (optional)" maxlength="500" />
        <label v-if="editingId" class="finance-checkbox">
          <input v-model="form.isActive" type="checkbox" />
          Active (can receive new loans)
        </label>
        <div class="form-actions">
          <AppButton variant="secondary" @click="editorOpen = false">Cancel</AppButton>
          <AppButton type="submit" :loading="busy">{{ editingId ? 'Save changes' : t('Add non-member') }}</AppButton>
        </div>
      </AppForm>
    </AppModal>

    <AppModal
      :open="!!selected"
      :title="selected ? `${selected.fullName} · ${selected.borrowerNo}` : ''"
      description="Non-member borrower · Loan records only (no membership, no deposits, no account)"
      size="wide"
      @close="selected = undefined"
    >
      <template v-if="selected">
        <div class="finance-detail-heading">
          <div>
            <span class="borrower-tag">{{ t('Non-member') }}</span>
            <span v-if="!selected.isActive" class="borrower-tag inactive">Inactive</span>
          </div>
          <div class="button-row">
            <AppButton v-if="auth.can('finance.write') && selected.isActive" @click="startLoan(selected)">
              <Plus :size="16" /> {{ t('New loan') }}
            </AppButton>
          </div>
        </div>

        <dl class="finance-details">
          <div><dt>Phone</dt><dd>{{ selected.phone }}</dd></div>
          <div><dt>NID / Identity</dt><dd>{{ selected.identityNumber || '—' }}</dd></div>
          <div><dt>Address</dt><dd>{{ selected.address || '—' }}</dd></div>
          <div><dt>Guarantor / reference</dt><dd>{{ selected.guarantorName ? `${selected.guarantorName}${selected.guarantorPhone ? ` · ${selected.guarantorPhone}` : ''}` : '—' }}</dd></div>
          <div v-if="selected.note"><dt>Note</dt><dd class="preserve-lines">{{ selected.note }}</dd></div>
        </dl>

        <section class="summary-grid finance-summary income-summary" aria-label="Borrower loan summary">
          <SummaryCard label="Total disbursed" :value="bdt(selected.disbursed)" detail="Approved loan principal" />
          <SummaryCard label="Total repaid" :value="bdt(selected.repaid)" detail="Approved repayments" />
          <SummaryCard label="Outstanding" :value="bdt(selected.outstanding)" detail="Remaining loan balance" />
        </section>

        <h3 class="product-history-heading">Loans</h3>
        <AppTable
          :rows="selected.loans"
          :columns="[
            { key: 'transactionNo', label: 'Loan' },
            { key: 'principal', label: 'Principal' },
            { key: 'repaid', label: 'Repaid' },
            { key: 'outstanding', label: 'Outstanding' },
            { key: 'nextDueDate', label: 'Next due' },
            { key: 'status', label: 'Status' },
            { key: 'actions', label: 'Actions' },
          ]"
        >
          <template #cell-transactionNo="{ row }">
            <strong>{{ row.disbursement.transactionNo }}</strong>
            <small class="finance-cell-note">{{ date(row.disbursement.effectiveDate) }} · {{ row.installmentCount }} installments</small>
          </template>
          <template #cell-principal="{ row }">{{ bdt(row.principal) }}</template>
          <template #cell-repaid="{ row }">{{ bdt(row.repaid) }}</template>
          <template #cell-outstanding="{ row }"><strong>{{ bdt(row.outstanding) }}</strong></template>
          <template #cell-nextDueDate="{ row }">{{ row.nextDueDate ? date(row.nextDueDate) : '—' }}</template>
          <template #cell-status="{ row }"><StatusBadge :status="row.status" /></template>
          <template #cell-actions="{ row }">
            <AppButton
              v-if="auth.can('finance.write') && row.status === 'ACTIVE'"
              variant="secondary"
              @click="startRepayment(row.id, selected!.fullName)"
            >
              Repay
            </AppButton>
          </template>
          <template #empty>No approved loans for this borrower yet.</template>
        </AppTable>

        <h3 class="product-history-heading">Loan transactions</h3>
        <AppTable
          :rows="selected.transactions"
          :columns="[
            { key: 'effectiveDate', label: 'Date' },
            { key: 'transactionNo', label: 'Transaction' },
            { key: 'type', label: 'Type' },
            { key: 'amount', label: 'Amount' },
            { key: 'status', label: 'Status' },
          ]"
        >
          <template #cell-effectiveDate="{ row }">{{ date(row.effectiveDate) }}</template>
          <template #cell-transactionNo="{ row }">
            <strong>{{ row.transactionNo }}</strong>
            <small class="finance-cell-note">{{ row.cashAccount.name }}<template v-if="row.reference"> · {{ row.reference }}</template></small>
          </template>
          <template #cell-amount="{ row }">{{ bdt(row.amount) }}</template>
          <template #cell-status="{ row }"><StatusBadge :status="row.status" /></template>
          <template #empty>No loan transactions recorded yet.</template>
        </AppTable>
      </template>
    </AppModal>
  </section>
</template>
