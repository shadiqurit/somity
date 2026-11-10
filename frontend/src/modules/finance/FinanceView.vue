<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { Plus, Wallet, Landmark, ClipboardCheck, ArrowDownUp, Settings } from 'lucide-vue-next';
import { api, errorMessage } from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import { date } from '../../utils/format';
import { bdt, todayDhaka, type Account, type FinancialTransaction, type FinanceSummary, type LedgerLine, type Policy } from './types';
import AppButton from '../../components/ui/AppButton.vue';
import AppInput from '../../components/ui/AppInput.vue';
import AppSelect from '../../components/ui/AppSelect.vue';
import AppModal from '../../components/modals/AppModal.vue';
import AppForm from '../../components/forms/AppForm.vue';
import AppTable from '../../components/tables/AppTable.vue';
import StatusBadge from '../../components/ui/StatusBadge.vue';
import SummaryCard from '../../components/ui/SummaryCard.vue';

const auth = useAuthStore(); const error = ref(''); const notice = ref(''); const loading = ref(false); const busy = ref(false); const actionError = ref('');
const tab = ref('transactions'); const summary = ref<FinanceSummary>(); const accounts = ref<Account[]>([]); const policy = ref<Policy>();
const rows = ref<FinancialTransaction[]>([]); const ledgerRows = ref<LedgerLine[]>([]); const page = ref(1); const pages = ref(1); const total = ref(0);
const status = ref(''); const type = ref(''); const from = ref(''); const to = ref('');
const entryOpen = ref(false); const accountOpen = ref(false); const policyOpen = ref(false); const selected = ref<FinancialTransaction>(); const detailLoading = ref(false);
const decision = ref('APPROVE'); const comment = ref(''); const reverseOpen = ref(false); const reversalNote = ref(''); const reversalDate = ref(todayDhaka());
const form = reactive({ type: 'DEPOSIT', memberId: '', cashAccountId: '', amount: '', effectiveDate: todayDhaka(), reference: '', note: '' });
const accountForm = reactive({ code: '', name: '', kind: 'CASH', bankName: '', accountNumberLast4: '' });
const policyForm = reactive({ requiredApprovals: '1', allowSelfApproval: false, version: 0 });
const memberSearch = ref(''); const memberOptions = ref<{ label: string; value: string }[]>([]); const searching = ref(false);
let entryKey = ''; let entrySignature = ''; let reverseKey = ''; let reverseSignature = '';
let loadSequence = 0;
const cashOptions = computed(() => [{ label: 'Choose a cash or bank account', value: '' }, ...accounts.value.filter(a => a.kind !== 'MEMBER_SAVINGS' && a.isActive).map(a => ({ label: `${a.name} · ${bdt(a.balance)}`, value: a.id }))]);
const columns = [{ key: 'transactionNo', label: 'Transaction' }, { key: 'member', label: 'Member' }, { key: 'effectiveDate', label: 'Date' }, { key: 'amount', label: 'Amount' }, { key: 'status', label: 'Status' }, { key: 'actions', label: 'Details' }];
const ledgerColumns = [{ key: 'effectiveDate', label: 'Date' }, { key: 'transaction', label: 'Transaction / member' }, { key: 'account', label: 'Account' }, { key: 'debit', label: 'Debit' }, { key: 'credit', label: 'Credit' }];
const accountColumns = [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Account' }, { key: 'kind', label: 'Kind' }, { key: 'balance', label: 'Posted balance' }];
const canDecide = computed(() => selected.value?.status === 'PENDING' && auth.can('finance.approve') && (selected.value.allowSelfApproval || selected.value.createdById !== auth.user?.id) && !selected.value.decisions.some(d => d.approverId === auth.user?.id));
async function load(value = 1) {
  const sequence = ++loadSequence; const requestedTab = tab.value;
  page.value = value; loading.value = true; error.value = '';
  const params = { page: value, pageSize: 20, status: status.value || undefined, type: type.value || undefined, from: from.value || undefined, to: to.value || undefined };
  try {
    const [s, a, p, records] = await Promise.all([api.get('/finance/summary', { params: { from: params.from, to: params.to } }), api.get('/finance/accounts'), api.get('/finance/policy'), api.get(requestedTab === 'ledger' ? '/finance/ledger' : '/finance/transactions', { params })]);
    if (sequence !== loadSequence) return;
    summary.value = s.data; accounts.value = a.data; policy.value = p.data;
    if (requestedTab === 'ledger') ledgerRows.value = records.data.items; else rows.value = records.data.items;
    pages.value = records.data.pages; total.value = records.data.total;
  } catch (e) { if (sequence === loadSequence) error.value = errorMessage(e); } finally { if (sequence === loadSequence) loading.value = false; }
}
watch(tab, () => load());
async function searchMembers() {
  searching.value = true; actionError.value = '';
  try { const { data } = await api.get('/members', { params: { status: 'ACTIVE', search: memberSearch.value, pageSize: 20 } }); memberOptions.value = [{ label: 'Choose a member', value: '' }, ...data.items.map((m: { id: string; fullName: string; memberNo: string }) => ({ label: `${m.fullName} · ${m.memberNo}`, value: m.id }))]; }
  catch (e) { actionError.value = errorMessage(e); } finally { searching.value = false; }
}
async function openEntry() {
  Object.assign(form, { type: 'DEPOSIT', memberId: '', cashAccountId: '', amount: '', effectiveDate: todayDhaka(), reference: '', note: '' });
  memberSearch.value = ''; memberOptions.value = []; entryKey = crypto.randomUUID(); entrySignature = ''; actionError.value = ''; entryOpen.value = true; await searchMembers();
}
async function saveEntry() {
  const signature = JSON.stringify(form); if (entrySignature && entrySignature !== signature) entryKey = crypto.randomUUID(); entrySignature = signature;
  busy.value = true; actionError.value = '';
  try { await api.post('/finance/transactions', form, { headers: { 'Idempotency-Key': entryKey } }); entryOpen.value = false; notice.value = 'Request submitted for approval. Balances change only after final approval.'; await load(); }
  catch (e) { actionError.value = errorMessage(e); } finally { busy.value = false; }
}
async function showDetails(id: string) {
  detailLoading.value = true; actionError.value = ''; comment.value = ''; reverseOpen.value = false;
  try { selected.value = (await api.get(`/finance/transactions/${id}`)).data; }
  catch (e) { error.value = errorMessage(e); } finally { detailLoading.value = false; }
}
async function decide() {
  if (!selected.value) return; busy.value = true; actionError.value = '';
  try { selected.value = (await api.post(`/finance/transactions/${selected.value.id}/decision`, { decision: decision.value, comment: comment.value })).data; comment.value = ''; notice.value = selected.value?.status === 'POSTED' ? 'Approved and posted to the ledger.' : 'Decision recorded.'; await load(page.value); }
  catch (e) { actionError.value = errorMessage(e); } finally { busy.value = false; }
}
async function cancel() {
  if (!selected.value) return; busy.value = true; actionError.value = '';
  try { selected.value = (await api.post(`/finance/transactions/${selected.value.id}/cancel`)).data; notice.value = 'Pending request cancelled.'; await load(page.value); }
  catch (e) { actionError.value = errorMessage(e); } finally { busy.value = false; }
}
async function reverse() {
  if (!selected.value) return;
  const body = { effectiveDate: reversalDate.value, note: reversalNote.value };
  const signature = JSON.stringify(body); if (reverseSignature && signature !== reverseSignature) reverseKey = crypto.randomUUID(); reverseSignature = signature;
  busy.value = true; actionError.value = '';
  try { const { data } = await api.post(`/finance/transactions/${selected.value.id}/reversal`, body, { headers: { 'Idempotency-Key': reverseKey } }); selected.value = data; reverseOpen.value = false; notice.value = 'Reversal requested. It needs approval before balances change.'; await load(); }
  catch (e) { actionError.value = errorMessage(e); } finally { busy.value = false; }
}
function beginReversal() { reverseOpen.value = true; reversalNote.value = ''; reversalDate.value = todayDhaka(); reverseKey = crypto.randomUUID(); reverseSignature = ''; actionError.value = ''; }
function openAccount() { Object.assign(accountForm, { code: '', name: '', kind: 'CASH', bankName: '', accountNumberLast4: '' }); actionError.value = ''; accountOpen.value = true; }
async function saveAccount() {
  busy.value = true; actionError.value = '';
  try { await api.post('/finance/accounts', accountForm); accountOpen.value = false; notice.value = 'Account created with a zero opening balance.'; await load(); }
  catch (e) { actionError.value = errorMessage(e); } finally { busy.value = false; }
}
function openPolicy() { if (!policy.value) return; Object.assign(policyForm, { requiredApprovals: String(policy.value.requiredApprovals), allowSelfApproval: policy.value.allowSelfApproval, version: policy.value.version }); actionError.value = ''; policyOpen.value = true; }
async function savePolicy() {
  busy.value = true; actionError.value = '';
  try { await api.put('/finance/policy', { ...policyForm, requiredApprovals: Number(policyForm.requiredApprovals) }); policyOpen.value = false; notice.value = 'Policy saved. Existing requests retain their captured approval rules.'; await load(); }
  catch (e) { actionError.value = errorMessage(e); } finally { busy.value = false; }
}
onMounted(() => load());
</script>
<template>
  <div class="page-heading"><div><span class="eyebrow">SAVINGS, WITH A CLEAR RECORD</span><h1>Finance<span class="heading-dot">.</span></h1><p>Member deposits, withdrawals and approvals for {{ auth.user?.society?.name }}.</p></div><div class="button-row"><AppButton v-if="auth.can('finance.settings')" variant="secondary" @click="openPolicy"><Settings :size="17" /> Approval policy</AppButton><AppButton v-if="auth.can('finance.write')" @click="openEntry"><Plus :size="18" /> New transaction</AppButton></div></div>
  <div v-if="notice" class="alert success" role="status">{{ notice }}</div><div v-if="error" class="alert error" role="alert">{{ error }} <AppButton variant="ghost" @click="load()">Retry</AppButton></div>
  <section v-if="summary" class="summary-grid finance-summary" aria-label="Financial summary"><SummaryCard label="Member savings" :value="bdt(summary.memberSavings)" detail="Approved balance at end date"><Wallet :size="20" /></SummaryCard><SummaryCard label="Savings in" :value="bdt(summary.deposits)" detail="Period increases, including reversals"><ArrowDownUp :size="20" /></SummaryCard><SummaryCard label="Savings out" :value="bdt(summary.withdrawals)" detail="Period decreases, including reversals"><Landmark :size="20" /></SummaryCard><SummaryCard label="Awaiting approval" :value="summary.pending" detail="All pending requests"><ClipboardCheck :size="20" /></SummaryCard></section>
  <section class="panel directory"><div class="finance-tabs" aria-label="Finance sections"><AppButton :variant="tab === 'transactions' ? 'primary' : 'ghost'" @click="tab = 'transactions'">Transactions</AppButton><AppButton :variant="tab === 'ledger' ? 'primary' : 'ghost'" @click="tab = 'ledger'">Society ledger</AppButton><AppButton :variant="tab === 'accounts' ? 'primary' : 'ghost'" @click="tab = 'accounts'">Cash & bank accounts</AppButton></div>
    <form v-if="tab !== 'accounts'" class="finance-filters" @submit.prevent="load()"><AppInput v-model="from" label="From date" type="date" /><AppInput v-model="to" label="To date" type="date" /><AppSelect v-if="tab === 'transactions'" v-model="status" label="Status" :options="[{label:'All statuses',value:''}, ...['PENDING','POSTED','REJECTED','CANCELLED'].map(value => ({label:value,value}))]" /><AppSelect v-if="tab === 'transactions'" v-model="type" label="Type" :options="[{label:'All types',value:''}, ...['DEPOSIT','WITHDRAWAL','REVERSAL'].map(value => ({label:value,value}))]" /><AppButton type="submit" variant="secondary" :loading="loading">Apply filters</AppButton></form>
    <template v-if="tab === 'transactions'"><AppTable :rows="rows" :columns="columns" :page="page" :pages="pages" :total="total" :loading="loading" @page="load"><template #cell-transactionNo="{ row }"><strong>{{ row.transactionNo }}</strong><small class="finance-cell-note">{{ row.type }} · {{ row.cashAccount.name }}</small></template><template #cell-member="{ row }"><RouterLink :to="`/members/${row.member.id}`" class="text-link">{{ row.member.fullName }}</RouterLink><small class="finance-cell-note">{{ row.member.memberNo }}</small></template><template #cell-effectiveDate="{ row }">{{ date(row.effectiveDate) }}</template><template #cell-amount="{ row }">{{ bdt(row.amount) }}</template><template #cell-status="{ row }"><StatusBadge :status="row.status" /><small v-if="row.status === 'PENDING'" class="finance-cell-note">{{ row.decisions.length }} / {{ row.requiredApprovals }} approvals</small></template><template #cell-actions="{ row }"><AppButton variant="ghost" :loading="detailLoading" @click="showDetails(row.id)">Review</AppButton></template><template #empty>No transactions match these filters.</template></AppTable></template>
    <AppTable v-else-if="tab === 'ledger'" :rows="ledgerRows" :columns="ledgerColumns" :page="page" :pages="pages" :total="total" :loading="loading" @page="load"><template #cell-effectiveDate="{ row }">{{ date(row.transaction.effectiveDate) }}</template><template #cell-transaction="{ row }"><strong>{{ row.transaction.transactionNo }}</strong><small class="finance-cell-note">{{ row.member.fullName }} · {{ row.transaction.type }}</small></template><template #cell-account="{ row }">{{ row.account.name }}<small class="finance-cell-note">{{ row.account.code }}</small></template><template #cell-debit="{ row }">{{ bdt(row.debit) }}</template><template #cell-credit="{ row }">{{ bdt(row.credit) }}</template><template #empty>No posted ledger entries in this period.</template></AppTable>
    <template v-else><div class="panel-heading"><div><h2>Cash & bank accounts</h2><p>Balances come from approved ledger entries.</p></div><AppButton v-if="auth.can('finance.settings')" @click="openAccount"><Plus :size="18" /> Add account</AppButton></div><AppTable :rows="accounts" :columns="accountColumns" :loading="loading"><template #cell-name="{ row }"><strong>{{ row.name }}</strong><small v-if="row.bankName" class="finance-cell-note">{{ row.bankName }} {{ row.accountNumberLast4 ? `· ending ${row.accountNumberLast4}` : '' }}</small></template><template #cell-balance="{ row }">{{ bdt(row.balance) }}</template><template #empty>Add your first cash or bank account to start recording transactions.</template></AppTable></template>
  </section><p class="under-table-note">Only final approval changes balances. Posted transactions are preserved; corrections use an approved reversal and a new request.</p>

  <AppModal :open="entryOpen" title="New transaction" description="Submit a member deposit or withdrawal for approval." :busy="busy" @close="entryOpen = false"><AppForm :busy="busy" :error="actionError" @submit="saveEntry"><div class="form-grid"><AppSelect v-model="form.type" label="Transaction type" :options="[{label:'Deposit',value:'DEPOSIT'},{label:'Withdrawal',value:'WITHDRAWAL'}]" required /><AppInput v-model="form.effectiveDate" label="Effective date" type="date" :max="todayDhaka()" required /></div><div class="finance-member-search"><AppInput v-model="memberSearch" label="Find member by name or number" /><AppButton variant="secondary" :loading="searching" @click="searchMembers">Search</AppButton></div><AppSelect v-model="form.memberId" label="Member" :options="memberOptions" required /><AppSelect v-model="form.cashAccountId" label="Cash or bank account" :options="cashOptions" required /><p v-if="cashOptions.length === 1" class="error-text">Ask an administrator to add a cash or bank account first.</p><AppInput v-model="form.amount" label="Amount (BDT)" inputmode="decimal" placeholder="0.00" pattern="(0|[1-9][0-9]{0,17})(\.[0-9]{1,2})?" required /><AppInput v-model="form.reference" label="Receipt / reference (optional)" maxlength="120" /><AppInput v-model="form.note" label="Note (optional)" maxlength="500" /><p class="muted small-text">{{ policy?.requiredApprovals ?? 1 }} approval(s) required. {{ policy?.allowSelfApproval ? 'Self-approval is allowed for authorized approvers.' : 'The requester cannot approve their own request.' }}</p><div class="form-actions"><AppButton variant="secondary" @click="entryOpen = false">Cancel</AppButton><AppButton type="submit" :loading="busy">Submit for approval</AppButton></div></AppForm></AppModal>

  <AppModal :open="accountOpen" title="Add cash or bank account" description="Accounts start at zero. Record actual member deposits to add funds." :busy="busy" @close="accountOpen = false"><AppForm :busy="busy" :error="actionError" @submit="saveAccount"><AppSelect v-model="accountForm.kind" label="Account kind" :options="[{label:'Cash',value:'CASH'},{label:'Bank',value:'BANK'}]" /><AppInput v-model="accountForm.code" label="Account code" placeholder="CASH-01" maxlength="40" required /><AppInput v-model="accountForm.name" label="Account name" placeholder="Main cash account" maxlength="120" required /><template v-if="accountForm.kind === 'BANK'"><AppInput v-model="accountForm.bankName" label="Bank name" maxlength="120" required /><AppInput v-model="accountForm.accountNumberLast4" label="Account number last 4 digits (optional)" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" /></template><div class="form-actions"><AppButton variant="secondary" @click="accountOpen = false">Cancel</AppButton><AppButton type="submit" :loading="busy">Create account</AppButton></div></AppForm></AppModal>

  <AppModal :open="policyOpen" title="Approval policy" description="Changes apply to new requests. Existing requests keep their original rules." :busy="busy" @close="policyOpen = false"><AppForm :busy="busy" :error="actionError" @submit="savePolicy"><AppSelect v-model="policyForm.requiredApprovals" label="Required approvals" :options="[{label:'One approver',value:'1'},{label:'Two distinct approvers',value:'2'}]" /><label class="finance-checkbox"><input v-model="policyForm.allowSelfApproval" type="checkbox" /> Allow authorized requesters to approve their own requests</label><p class="muted small-text">Admin and Approver roles can decide requests. Accountant can submit requests. Two approvals always require two different people.</p><div class="form-actions"><AppButton variant="secondary" @click="policyOpen = false">Cancel</AppButton><AppButton type="submit" :loading="busy">Save policy</AppButton></div></AppForm></AppModal>

  <AppModal :open="!!selected" :title="selected?.transactionNo ?? 'Transaction details'" :busy="busy" size="wide" @close="selected = undefined"><template v-if="selected"><div v-if="actionError" class="alert error" role="alert">{{ actionError }}</div><div class="finance-detail-heading"><div><span class="eyebrow">{{ selected.type }}</span><h2>{{ bdt(selected.amount) }}</h2></div><StatusBadge :status="selected.status" /></div><dl class="finance-details"><div><dt>Member</dt><dd>{{ selected.member.fullName }} · {{ selected.member.memberNo }}</dd></div><div><dt>Account</dt><dd>{{ selected.cashAccount.name }}</dd></div><div><dt>Effective date</dt><dd>{{ date(selected.effectiveDate) }}</dd></div><div><dt>Requested by</dt><dd>{{ selected.createdBy.name }}</dd></div><div><dt>Reference</dt><dd>{{ selected.reference || '—' }}</dd></div><div><dt>Note</dt><dd class="preserve-lines">{{ selected.note || '—' }}</dd></div><div><dt>Approval rules</dt><dd>{{ selected.requiredApprovals }} distinct approval(s) · Policy {{ selected.policyVersion }} · {{ selected.allowSelfApproval ? 'Self-approval allowed' : 'No self-approval' }}</dd></div><div v-if="selected.reversalOf"><dt>Reverses</dt><dd><button class="text-link" :disabled="busy" @click="showDetails(selected.reversalOf.id)">{{ selected.reversalOf.transactionNo }}</button></dd></div></dl>
    <h3>Approval history</h3><p v-if="!selected.decisions.length" class="muted">No decisions yet.</p><ol class="finance-decisions"><li v-for="d in selected.decisions" :key="d.id"><strong>{{ d.step }}. {{ d.approver.name }} · {{ d.decision }}</strong><p>{{ date(d.createdAt) }} {{ d.comment ? `· ${d.comment}` : '' }}</p></li></ol>
    <AppTable v-if="selected.entries?.length" :rows="selected.entries" :columns="[{key:'account',label:'Account'},{key:'debit',label:'Debit'},{key:'credit',label:'Credit'}]"><template #cell-account="{ row }">{{ row.account.name }}</template><template #cell-debit="{ row }">{{ bdt(row.debit) }}</template><template #cell-credit="{ row }">{{ bdt(row.credit) }}</template></AppTable>
    <AppForm v-if="canDecide" :busy="busy" @submit="decide"><h3>Review request</h3><AppSelect v-model="decision" label="Decision" :options="[{label:'Approve',value:'APPROVE'},{label:'Reject',value:'REJECT'}]" /><AppInput v-model="comment" :label="decision === 'REJECT' ? 'Reason for rejection' : 'Comment (optional)'" :required="decision === 'REJECT'" :minlength="decision === 'REJECT' ? 5 : undefined" maxlength="500" /><AppButton type="submit" :variant="decision === 'REJECT' ? 'danger' : 'primary'" :loading="busy">{{ decision === 'REJECT' ? 'Reject request' : 'Approve request' }}</AppButton></AppForm>
    <div class="button-row finance-detail-actions"><AppButton v-if="selected.status === 'PENDING' && selected.createdById === auth.user?.id && auth.can('finance.write')" variant="secondary" :loading="busy" @click="cancel">Cancel pending request</AppButton><AppButton v-if="selected.status === 'POSTED' && selected.type !== 'REVERSAL' && !selected.reversals.length && auth.can('finance.write') && !reverseOpen" variant="secondary" @click="beginReversal">Request reversal</AppButton><span v-if="selected.reversals.length" class="muted">A reversal is already {{ selected.reversals[0]?.status.toLowerCase() }}.</span></div>
    <AppForm v-if="reverseOpen" :busy="busy" @submit="reverse"><h3>Reverse this transaction</h3><p class="muted">The original entry stays unchanged. An approved reversal posts equal and opposite entries.</p><AppInput v-model="reversalDate" label="Reversal date" type="date" :min="selected.effectiveDate.slice(0,10)" :max="todayDhaka()" required /><AppInput v-model="reversalNote" label="Reason for reversal" minlength="5" maxlength="500" required /><div class="form-actions"><AppButton variant="secondary" @click="reverseOpen = false">Cancel</AppButton><AppButton type="submit" :loading="busy">Submit reversal request</AppButton></div></AppForm>
  </template></AppModal>
</template>
