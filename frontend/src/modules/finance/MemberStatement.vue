<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, errorMessage } from '../../services/api';
import { date } from '../../utils/format';
import { bdt, type MemberStatement } from './types';
import AppTable from '../../components/tables/AppTable.vue';
import AppButton from '../../components/ui/AppButton.vue';
import AppInput from '../../components/ui/AppInput.vue';
import SummaryCard from '../../components/ui/SummaryCard.vue';
const props = defineProps<{ memberId?: string; own?: boolean }>();
const data = ref<MemberStatement>(); const error = ref(''); const loading = ref(false); const from = ref(''); const to = ref('');
const columns = [{ key: 'effectiveDate', label: 'Date' }, { key: 'transactionNo', label: 'Transaction' }, { key: 'type', label: 'Type' }, { key: 'deposit', label: 'Savings in' }, { key: 'withdrawal', label: 'Savings out' }, { key: 'balance', label: 'Balance' }];
let loadSequence = 0;
async function load(page = 1) {
  const sequence = ++loadSequence;
  loading.value = true; error.value = '';
  try { const response = await api.get(props.own ? '/finance/statements/me' : `/finance/statements/${props.memberId}`, { params: { page, pageSize: 20, from: from.value || undefined, to: to.value || undefined } }); if (sequence === loadSequence) data.value = response.data; }
  catch (e) { if (sequence === loadSequence) error.value = errorMessage(e); } finally { if (sequence === loadSequence) loading.value = false; }
}
onMounted(() => load());
</script>
<template>
  <section class="panel finance-statement">
    <div class="panel-heading"><div><h2>Member statement</h2><p>Approved savings movements, including reversals.</p></div></div>
    <form class="finance-filters" @submit.prevent="load()"><AppInput v-model="from" label="From date" type="date" /><AppInput v-model="to" label="To date" type="date" /><AppButton type="submit" variant="secondary" :loading="loading">Apply dates</AppButton></form>
    <div v-if="error" class="alert error" role="alert">{{ error }} <AppButton variant="ghost" @click="load()">Retry</AppButton></div>
    <div v-if="data" class="summary-grid statement-summary"><SummaryCard label="Opening balance" :value="bdt(data.openingBalance)" detail="Before selected period" /><SummaryCard label="Savings in" :value="bdt(data.deposits)" detail="Includes reversed withdrawals" /><SummaryCard label="Savings out" :value="bdt(data.withdrawals)" detail="Includes reversed deposits" /><SummaryCard label="Closing balance" :value="bdt(data.closingBalance)" detail="At end of selected period" /></div>
    <AppTable :rows="data?.items ?? []" :columns="columns" :page="data?.page ?? 1" :pages="data?.pages ?? 1" :total="data?.total ?? 0" :loading="loading" @page="load"><template #cell-effectiveDate="{ row }">{{ date(row.effectiveDate) }}</template><template #cell-transactionNo="{ row }"><strong>{{ row.transactionNo }}</strong><small class="finance-cell-note">{{ row.reference || row.note }}</small></template><template #cell-deposit="{ row }">{{ bdt(row.deposit) }}</template><template #cell-withdrawal="{ row }">{{ bdt(row.withdrawal) }}</template><template #cell-balance="{ row }"><strong>{{ bdt(row.balance) }}</strong></template><template #empty>No approved transactions in this period.</template></AppTable>
  </section>
</template>
