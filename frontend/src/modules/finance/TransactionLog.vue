<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, errorMessage } from '../../services/api';
import AppInput from '../../components/ui/AppInput.vue';
import AppSelect from '../../components/ui/AppSelect.vue';
import AppButton from '../../components/ui/AppButton.vue';
import AppTable from '../../components/tables/AppTable.vue';
import { bdt } from './types';

interface LogEvent {
  id: string;
  entityId: string;
  action: string;
  createdAt: string;
  changes: { comment?: string; note?: string; reference?: string } | null;
  actor: { name: string } | null;
  transaction: { transactionNo: string; amount: string; deletedAt: string | null } | null;
}

const actionLabels: Record<string, string> = {
  FINANCE_REQUESTED: 'Submitted',
  FINANCE_REVERSAL_REQUESTED: 'Reversal requested',
  FINANCE_APPROVED: 'Approved',
  FINANCE_REJECTED: 'Rejected',
  FINANCE_POSTED: 'Posted',
  FINANCE_CANCELLED: 'Cancelled',
  FINANCE_DELETED: 'Deleted',
};
const actions = [{ value: '', label: 'All events' }, ...Object.entries(actionLabels).map(([value, label]) => ({ value, label }))];
const columns = [
  { key: 'createdAt', label: 'Date and time' }, { key: 'transaction', label: 'Transaction' },
  { key: 'action', label: 'Event' }, { key: 'actor', label: 'Recorded by' }, { key: 'changes', label: 'Note' },
];
const timestamp = new Intl.DateTimeFormat('en-BD', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Dhaka' });
const transactionNo = ref('');
const action = ref('');
const appliedFilters = ref({ transactionNo: '', action: '' });
const rows = ref<LogEvent[]>([]);
const cursors = ref<string[]>([]);
const nextCursor = ref<string | null>(null);
const loading = ref(false);
const error = ref('');

async function load(history = cursors.value, filters = appliedFilters.value) {
  loading.value = true;
  error.value = '';
  try {
    const { data } = await api.get<{ items: LogEvent[]; nextCursor: string | null }>('/finance/transaction-log', {
      params: { after: history.at(-1), transactionNo: filters.transactionNo || undefined, action: filters.action || undefined },
    });
    rows.value = data.items;
    nextCursor.value = data.nextCursor;
    cursors.value = history;
    appliedFilters.value = filters;
  } catch (e) { error.value = errorMessage(e); }
  finally { loading.value = false; }
}

onMounted(() => load());
</script>

<template>
  <form class="finance-filters" @submit.prevent="load([], { transactionNo: transactionNo.trim(), action })">
    <AppInput v-model="transactionNo" label="Transaction number" maxlength="40" />
    <AppSelect v-model="action" label="Event" :options="actions" />
    <AppButton type="submit" variant="secondary" :loading="loading">Apply filters</AppButton>
  </form>
  <div v-if="error" class="alert error" role="alert">{{ error }}</div>
  <AppTable :rows="rows" :columns="columns" :loading="loading">
    <template #cell-createdAt="{ row }">{{ timestamp.format(new Date(row.createdAt)) }}</template>
    <template #cell-transaction="{ row }">
      <strong>{{ row.transaction?.transactionNo ?? row.entityId }}</strong>
      <small v-if="row.transaction" class="finance-cell-note">{{ bdt(row.transaction.amount) }}{{ row.transaction.deletedAt ? ' · Deleted' : '' }}</small>
    </template>
    <template #cell-action="{ row }">{{ actionLabels[row.action] ?? row.action }}</template>
    <template #cell-actor="{ row }">{{ row.actor?.name ?? '—' }}</template>
    <template #cell-changes="{ row }"><span class="preserve-lines">{{ row.changes?.comment || row.changes?.note || row.changes?.reference || '—' }}</span></template>
    <template #empty>No transaction events match these filters.</template>
  </AppTable>
  <div v-if="cursors.length || nextCursor" class="table-footer">
    <span>Page {{ cursors.length + 1 }}</span>
    <div class="button-row">
      <AppButton variant="secondary" :disabled="loading || !cursors.length" @click="load(cursors.slice(0, -1))">Newer</AppButton>
      <AppButton variant="secondary" :disabled="loading || !nextCursor" @click="nextCursor && load([...cursors, nextCursor])">Older</AppButton>
    </div>
  </div>
</template>
