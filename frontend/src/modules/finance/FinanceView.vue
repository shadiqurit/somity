<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { Plus, Wallet, Landmark, ClipboardCheck, ArrowDownUp, Settings } from 'lucide-vue-next';
import { api, errorMessage } from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import { useLocale } from '../../composables/useLocale';
import { date } from '../../utils/format';
import ProductReports from './ProductReports.vue';
import TransactionLog from './TransactionLog.vue';
import { bdt, todayDhaka, type Account, type FinancialTransaction, type FinanceSummary, type IncomeSummary, type LedgerLine, type Policy } from './types';
import AppButton from '../../components/ui/AppButton.vue';
import AppInput from '../../components/ui/AppInput.vue';
import AppSelect from '../../components/ui/AppSelect.vue';
import AppModal from '../../components/modals/AppModal.vue';
import AppForm from '../../components/forms/AppForm.vue';
import AppTable from '../../components/tables/AppTable.vue';
import StatusBadge from '../../components/ui/StatusBadge.vue';
import SummaryCard from '../../components/ui/SummaryCard.vue';

const entryTypes = {
  finance: ['DEPOSIT', 'WITHDRAWAL'],
  loans: ['LOAN_DISBURSEMENT', 'LOAN_REPAYMENT'],
  investments: ['INVESTMENT_PURCHASE', 'INVESTMENT_RETURN'],
  income: ['OTHER_INCOME', 'INVESTMENT_RETURN'],
  expenses: ['EXPENSE'],
  bank: ['TRANSFER'],
  approvals: [],
} as const;
type Section = keyof typeof entryTypes;
const transactionLabels = {
  DEPOSIT: 'Deposit', WITHDRAWAL: 'Withdrawal', LOAN_DISBURSEMENT: 'Loan disbursement', LOAN_REPAYMENT: 'Loan repayment',
  INVESTMENT_PURCHASE: 'Investment purchase', INVESTMENT_RETURN: 'Investment return', OTHER_INCOME: 'Other income',
  EXPENSE: 'Expense', TRANSFER: 'Transfer', REVERSAL: 'Reversal',
};
type TransactionType = keyof typeof transactionLabels;
type EntryPreset = { type: string; loanId?: string; investmentId?: string; label?: string };
const props = defineProps<{ section?: Section }>();
const { t } = useLocale();
const section = computed(() => props.section ?? 'finance');
const incomeSummary = ref<IncomeSummary>();
const reportRevision = ref(0); const expenseTotal = ref('0.00');
const entryOptions = computed(() => entryTypes[section.value].map(value => ({
  value,
  label: t(section.value === 'income' && value === 'INVESTMENT_RETURN' ? 'Investment profit' : transactionLabels[value]),
})));
const historyTypeOptions = computed(() => [
  { label: 'All types', value: '' },
  ...Object.entries(transactionLabels).map(([value, label]) => ({ label: t(label), value })),
]);
const productOptions = ref<{label:string;value:string}[]>([]);
let entryPreset: EntryPreset | undefined;
const auth = useAuthStore(); const error = ref(''); const notice = ref(''); const loading = ref(false); const busy = ref(false); const actionError = ref('');
type FinanceTab = Exclude<Section, 'finance' | 'approvals'> | 'transactions' | 'ledger' | 'accounts' | 'log';
const tab = ref<FinanceTab>(!props.section || props.section === 'finance' || props.section === 'approvals' ? 'transactions' : props.section);
const summary = ref<FinanceSummary>(); const accounts = ref<Account[]>([]); const policy = ref<Policy>();
const rows = ref<FinancialTransaction[]>([]); const ledgerRows = ref<LedgerLine[]>([]); const page = ref(1); const pages = ref(1); const total = ref(0);
const status = ref(props.section === 'approvals' ? 'PENDING' : ''); const type = ref(''); const from = ref(''); const to = ref('');
const entryOpen = ref(false); const accountOpen = ref(false); const policyOpen = ref(false); const selected = ref<FinancialTransaction>(); const detailLoading = ref(false);
const deleteOpen = ref(false); const deleteError = ref('');
const decision = ref('APPROVE'); const comment = ref(''); const reverseOpen = ref(false); const reversalNote = ref(''); const reversalDate = ref(todayDhaka());
const blankForm = () => ({ type: '', memberId: '', cashAccountId: '', amount: '', effectiveDate: todayDhaka(), reference: '', note: '', loanId: '', investmentId: '', installmentCount: '12', firstDueDate: todayDhaka(), title: '', counterparty: '', principalReturned: '0.00', profit: '0.00', category: '', payee: '', destinationAccountId: '' });
const form = reactive(blankForm());
const needsMember = computed(() => ['DEPOSIT','WITHDRAWAL','LOAN_DISBURSEMENT'].includes(form.type));
const fullInvestmentReturn = computed(() => form.type === 'INVESTMENT_RETURN' && section.value !== 'income');
watch(() => [form.principalReturned, form.profit, fullInvestmentReturn.value], () => { if(!fullInvestmentReturn.value) return; try { const cents = (v:string) => {if(!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(v))throw new Error();const [whole='0',fraction='']=v.split('.');return BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));};const total=cents(form.principalReturned)+cents(form.profit);form.amount=String(total/100n)+'.'+String(total%100n).padStart(2,'0'); } catch { form.amount=''; } });
const accountForm = reactive({ code: '', name: '', kind: 'CASH', bankName: '', accountNumberLast4: '' });
const policyForm = reactive({ requiredApprovals: '1', allowSelfApproval: false, version: 0 });
const memberSearch = ref(''); const memberOptions = ref<{ label: string; value: string }[]>([]); const searching = ref(false);
let entryKey = ''; let entrySignature = ''; let reverseKey = ''; let reverseSignature = '';
let loadSequence = 0;
const cashOptions = computed(() => [{ label: 'Choose a cash or bank account', value: '' }, ...accounts.value.filter(a => ['CASH','BANK'].includes(a.kind) && a.isActive).map(a => ({ label: `${a.name} · ${bdt(a.balance)}`, value: a.id }))]);
const columns = [{ key: 'transactionNo', label: 'Transaction' }, { key: 'member', label: 'Member' }, { key: 'effectiveDate', label: 'Date' }, { key: 'amount', label: 'Amount' }, { key: 'status', label: 'Status' }, { key: 'actions', label: 'Details' }];
const incomeColumns = columns.map(column => column.key === 'member' ? { key: 'note', label: 'Note' } : column.key === 'amount' ? { ...column, label: 'Income amount' } : column);
const ledgerColumns = [{ key: 'effectiveDate', label: 'Date' }, { key: 'transaction', label: 'Transaction / member' }, { key: 'account', label: 'Account' }, { key: 'debit', label: 'Debit' }, { key: 'credit', label: 'Credit' }];
const accountColumns = [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Account' }, { key: 'kind', label: 'Kind' }, { key: 'balance', label: 'Posted balance' }];
const canDecide = computed(() => selected.value?.status === 'PENDING' && auth.can('finance.approve') && (selected.value.allowSelfApproval || selected.value.createdById !== auth.user?.id) && !selected.value.decisions.some(d => d.approverId === auth.user?.id));
async function load(value = 1) {
  const sequence = ++loadSequence; const requestedTab = tab.value;
  page.value = value; loading.value = true; error.value = '';
  const range = { from: from.value || undefined, to: to.value || undefined };
  const params = { ...range, page: value, pageSize: 20, status: status.value || undefined, type: requestedTab === 'expenses' ? 'EXPENSE' : type.value || undefined, scope: requestedTab === 'income' ? 'income' : undefined };
  try {
    const [s, a, p, records, expenses] = await Promise.all([
      requestedTab === 'income' ? api.get('/finance/income-summary', { params: range }) : api.get('/finance/summary', { params: range }),
      api.get('/finance/accounts'),
      api.get('/finance/policy'),
      api.get(requestedTab === 'ledger' ? '/finance/ledger' : '/finance/transactions', { params }),
      requestedTab === 'expenses' ? api.get('/finance/bank-summary', { params: range }) : undefined,
    ]);
    if (sequence !== loadSequence) return;
    if (requestedTab === 'income') incomeSummary.value = s.data;
    else summary.value = s.data;
    accounts.value = a.data; policy.value = p.data; reportRevision.value++;
    if (expenses) expenseTotal.value = expenses.data.expenses;
    if (requestedTab === 'ledger') ledgerRows.value = records.data.items; else rows.value = records.data.items;
    pages.value = records.data.pages; total.value = records.data.total;
  } catch (e) { if (sequence === loadSequence) error.value = errorMessage(e); } finally { if (sequence === loadSequence) loading.value = false; }
}
watch(tab, current => { if (current !== 'log') void load(); });
let memberRequest: AbortController | undefined;
async function searchMembers() {
  memberRequest?.abort();
  const request = new AbortController();
  memberRequest = request;
  searching.value = true; actionError.value = '';
  try {
    const { data } = await api.get('/members', { params: { status: 'ACTIVE', search: memberSearch.value, pageSize: 20 }, signal: request.signal });
    if (request.signal.aborted) return;
    memberOptions.value = [{ label: 'Choose a member', value: '' }, ...data.items.map((m: { id: string; fullName: string; memberNo: string }) => ({ label: `${m.fullName} · ${m.memberNo}`, value: m.id }))];
  } catch (e) {
    if (!request.signal.aborted) actionError.value = errorMessage(e);
  } finally {
    if (memberRequest === request) searching.value = false;
  }
}
function openEntry(preset?: EntryPreset) {
  const initial = preset ? entryOptions.value.find(option => option.value === preset.type) : entryOptions.value[0];
  if (!initial) return;
  entryPreset = preset;
  Object.assign(form, blankForm(), { type: initial.value, loanId: preset?.loanId ?? '', investmentId: preset?.investmentId ?? '' });
  memberSearch.value = ''; memberOptions.value = []; productOptions.value = [];
  entryKey = crypto.randomUUID(); entrySignature = ''; actionError.value = ''; entryOpen.value = true;
}
watch([entryOpen, needsMember], ([open, member], _, onCleanup) => {
  if (!open || !member) return;
  onCleanup(() => memberRequest?.abort());
  if (!memberOptions.value.length) void searchMembers();
});
watch([entryOpen, () => form.type], async ([open, currentType], _, onCleanup) => {
  if (!open || (currentType !== 'LOAN_REPAYMENT' && currentType !== 'INVESTMENT_RETURN')) return;
  const isLoan = currentType === 'LOAN_REPAYMENT';
  const request = new AbortController();
  onCleanup(() => request.abort());
  const placeholder = { label: isLoan ? 'Choose a loan' : 'Choose an investment', value: '' };
  const presetId = isLoan ? entryPreset?.loanId : entryPreset?.investmentId;
  const presetOption = presetId ? { label: entryPreset?.label ?? presetId, value: presetId } : undefined;
  productOptions.value = presetOption ? [placeholder, presetOption] : [placeholder];
  try {
    const { data } = await api.get<{ items: { id: string; title?: string; member?: { fullName: string }; outstanding: string; status: string }[] }>(
      isLoan ? '/finance/loans' : '/finance/investments', { params: { pageSize: 100 }, signal: request.signal },
    );
    if (request.signal.aborted) return;
    const options = data.items
      .filter(item => isLoan ? item.status === 'ACTIVE' : item.status !== 'CANCELLED')
      .map(item => ({ label: `${item.member?.fullName ?? item.title} · ${bdt(item.outstanding)}`, value: item.id }));
    if (presetOption && !options.some(option => option.value === presetOption.value)) options.push(presetOption);
    productOptions.value = [placeholder, ...options];
  } catch (e) {
    if (!request.signal.aborted) actionError.value = errorMessage(e);
  }
});
async function saveEntry() {
  const payload: Record<string, unknown> = {
    type: form.type,
    memberId: needsMember.value ? form.memberId : null,
    cashAccountId: form.cashAccountId,
    amount: form.amount,
    effectiveDate: form.effectiveDate,
    reference: form.type === 'OTHER_INCOME' ? '' : form.reference,
    note: form.note,
  };
  if(form.type==='LOAN_DISBURSEMENT')Object.assign(payload,{installmentCount:Number(form.installmentCount),firstDueDate:form.firstDueDate});
  if(form.type==='LOAN_REPAYMENT')payload.loanId=form.loanId;
  if(form.type==='INVESTMENT_PURCHASE')Object.assign(payload,{title:form.title,counterparty:form.counterparty});
  if (form.type === 'INVESTMENT_RETURN') Object.assign(payload, {
    investmentId: form.investmentId,
    principalReturned: fullInvestmentReturn.value ? form.principalReturned : '0.00',
    profit: fullInvestmentReturn.value ? form.profit : form.amount,
  });
  if(form.type==='EXPENSE')Object.assign(payload,{category:form.category,payee:form.payee});
  if(form.type==='TRANSFER')payload.destinationAccountId=form.destinationAccountId;
  const signature = JSON.stringify(payload); if (entrySignature && entrySignature !== signature) entryKey = crypto.randomUUID(); entrySignature = signature;
  busy.value = true; actionError.value = '';
  try { await api.post('/finance/transactions', payload, { headers: { 'Idempotency-Key': entryKey } }); entryOpen.value = false; notice.value = 'Request submitted for approval. Balances change only after final approval.'; await load(); }
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
async function deleteRejected() {
  if (!selected.value) return;
  busy.value = true;
  deleteError.value = '';
  try {
    await api.delete(`/finance/transactions/${selected.value.id}`);
    deleteOpen.value = false;
    selected.value = undefined;
    notice.value = 'Rejected transaction deleted. Its history is available in the transaction log.';
    await load();
  } catch (e) { deleteError.value = errorMessage(e); }
  finally { busy.value = false; }
}
async function reverse() {
  if (!selected.value) return;
  const body = { effectiveDate: reversalDate.value, note: reversalNote.value };
  const signature = JSON.stringify(body); if (reverseSignature && signature !== reverseSignature) reverseKey = crypto.randomUUID(); reverseSignature = signature;
  busy.value = true; actionError.value = '';
  try { const { data } = await api.post(`/finance/transactions/${selected.value.id}/reversal`, body, { headers: { 'Idempotency-Key': reverseKey } }); selected.value = data; reverseOpen.value = false; notice.value = 'Reversal requested. It needs approval before balances change.'; await load(); }
  catch (e) { actionError.value = errorMessage(e); } finally { busy.value = false; }
}
function detailLabel(key:string){return ({installmentCount:'Monthly installments',firstDueDate:'First installment date',principalReturned:'Principal returned (BDT)',profit:'Profit received (BDT)',destinationAccountId:'Destination account',title:'Investment title',counterparty:'Counterparty',category:'Expense category',payee:'Payee'} as Record<string,string>)[key]??key;}
function detailValue(key:string,value:string|number){return key==='destinationAccountId'?accounts.value.find(a=>a.id===value)?.name??'Account unavailable':value;}
function transactionLabel(row: FinancialTransaction) {
  const sourceType = row.reversalOf?.type ?? row.type;
  if (section.value === 'income') {
    const label = t(sourceType === 'INVESTMENT_RETURN' ? 'Investment profit' : 'Other income');
    return row.type === 'REVERSAL' ? `${t('Reversal')} · ${label}` : label;
  }
  return t(transactionLabels[row.type as TransactionType] ?? row.type);
}
function incomeAmount(row: FinancialTransaction) {
  const sourceType = row.reversalOf?.type ?? row.type;
  const amount = sourceType === 'INVESTMENT_RETURN' ? String(row.details?.profit ?? '0') : row.amount;
  return bdt(row.type === 'REVERSAL' ? `-${amount}` : amount);
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
  <div class="page-heading">
    <div>
      <h1>{{ t(section.charAt(0).toUpperCase() + section.slice(1)) }}<span class="heading-dot">.</span></h1>
      <p v-if="section === 'income'">Other income and investment profit for {{ auth.user?.society?.name }}.</p>
      <p v-else>Financial records for {{ auth.user?.society?.name }}.</p>
    </div>
    <div class="button-row">
      <AppButton v-if="auth.can('finance.settings')" variant="secondary" @click="openPolicy"><Settings :size="17" /> Approval policy</AppButton>
      <AppButton v-if="entryOptions.length && auth.can('finance.write')" @click="openEntry()"><Plus :size="18" /> New transaction</AppButton>
    </div>
  </div>
  <div v-if="notice" class="alert success" role="status">{{ notice }}</div><div v-if="error" class="alert error" role="alert">{{ error }} <AppButton variant="ghost" @click="load()">Retry</AppButton></div>
  <section v-if="incomeSummary" class="summary-grid finance-summary income-summary" aria-label="Approved income in the selected period">
    <SummaryCard :label="t('Total income')" :value="bdt(incomeSummary.total)" detail="Net approved income in this period"><Wallet :size="20" /></SummaryCard>
    <SummaryCard :label="t('Other income')" :value="bdt(incomeSummary.otherIncome)" detail="Net approved other income"><Landmark :size="20" /></SummaryCard>
    <SummaryCard :label="t('Investment profit')" :value="bdt(incomeSummary.investmentProfit)" detail="Net approved investment profit"><ArrowDownUp :size="20" /></SummaryCard>
  </section>
  <section v-if="summary" class="summary-grid finance-summary" aria-label="Financial summary"><SummaryCard label="Member savings" :value="bdt(summary.memberSavings)" detail="Approved balance at end date"><Wallet :size="20" /></SummaryCard><SummaryCard label="Savings in" :value="bdt(summary.deposits)" detail="Period increases, including reversals"><ArrowDownUp :size="20" /></SummaryCard><SummaryCard label="Savings out" :value="bdt(summary.withdrawals)" detail="Period decreases, including reversals"><Landmark :size="20" /></SummaryCard><SummaryCard label="Awaiting approval" :value="summary.pending" detail="All pending requests"><ClipboardCheck :size="20" /></SummaryCard></section>
  <section v-if="['transactions','ledger','accounts','income','expenses','log'].includes(tab)" class="panel directory">
    <div v-if="section === 'finance'" class="finance-tabs" aria-label="Finance sections">
      <AppButton :variant="tab === 'transactions' ? 'primary' : 'ghost'" @click="tab = 'transactions'">Transactions</AppButton>
      <AppButton :variant="tab === 'ledger' ? 'primary' : 'ghost'" @click="tab = 'ledger'">Society ledger</AppButton>
      <AppButton :variant="tab === 'accounts' ? 'primary' : 'ghost'" @click="tab = 'accounts'">Cash &amp; bank accounts</AppButton>
      <AppButton :variant="tab === 'log' ? 'primary' : 'ghost'" @click="tab = 'log'">Transaction log</AppButton>
    </div>
    <form v-if="tab !== 'accounts' && tab !== 'log'" class="finance-filters" @submit.prevent="load()">
      <AppInput v-model="from" label="From date" type="date" />
      <AppInput v-model="to" label="To date" type="date" />
      <AppSelect v-if="tab === 'transactions'" v-model="status" label="Status" :options="[{label:'All statuses',value:''}, ...['PENDING','POSTED','REJECTED','CANCELLED'].map(value => ({label:value,value}))]" />
      <AppSelect v-if="tab === 'transactions'" v-model="type" label="Type" :options="historyTypeOptions" />
      <AppButton type="submit" variant="secondary" :loading="loading">Apply filters</AppButton>
    </form>
    <TransactionLog v-if="tab === 'log'" :key="reportRevision" />
    <AppTable v-else-if="['transactions', 'income', 'expenses'].includes(tab)" :rows="rows" :columns="tab === 'income' ? incomeColumns : columns" :page="page" :pages="pages" :total="total" :loading="loading" @page="load">
      <template #cell-transactionNo="{ row }">
        <strong>{{ row.transactionNo }}</strong>
        <small class="finance-cell-note">{{ transactionLabel(row) }} · {{ row.cashAccount.name }}</small>
        <small v-if="tab === 'income' && row.investment" class="finance-cell-note">{{ row.investment.title }}</small>
      </template>
      <template #cell-member="{ row }">
        <RouterLink v-if="row.member" :to="`/members/${row.member.id}`" class="text-link">{{ row.member.fullName }}</RouterLink>
        <span v-else>Society transaction</span>
        <small class="finance-cell-note">{{ row.member?.memberNo }}</small>
      </template>
      <template #cell-note="{ row }"><span class="preserve-lines">{{ row.note || '—' }}</span></template>
      <template #cell-effectiveDate="{ row }">{{ date(row.effectiveDate) }}</template>
      <template #cell-amount="{ row }">{{ tab === 'income' ? incomeAmount(row) : bdt(row.amount) }}</template>
      <template #cell-status="{ row }">
        <StatusBadge :status="row.status" />
        <small v-if="row.status === 'PENDING'" class="finance-cell-note">{{ row.decisions.length }} / {{ row.requiredApprovals }} approvals</small>
      </template>
      <template #cell-actions="{ row }"><AppButton variant="ghost" :loading="detailLoading" @click="showDetails(row.id)">Review</AppButton></template>
      <template #empty>No transactions match these filters.</template>
    </AppTable>
    <AppTable v-else-if="tab === 'ledger'" :rows="ledgerRows" :columns="ledgerColumns" :page="page" :pages="pages" :total="total" :loading="loading" @page="load"><template #cell-effectiveDate="{ row }">{{ date(row.transaction.effectiveDate) }}</template><template #cell-transaction="{ row }"><strong>{{ row.transaction.transactionNo }}</strong><small class="finance-cell-note">{{ row.member?.fullName || 'Society' }} · {{ row.transaction.type }}</small></template><template #cell-account="{ row }">{{ row.account.name }}<small class="finance-cell-note">{{ row.account.code }}</small></template><template #cell-debit="{ row }">{{ bdt(row.debit) }}</template><template #cell-credit="{ row }">{{ bdt(row.credit) }}</template><template #empty>No posted ledger entries in this period.</template></AppTable>
    <template v-else><div class="panel-heading"><div><h2>Cash & bank accounts</h2><p>Balances come from approved ledger entries.</p></div><AppButton v-if="auth.can('finance.settings')" @click="openAccount"><Plus :size="18" /> Add account</AppButton></div><AppTable :rows="accounts" :columns="accountColumns" :loading="loading"><template #cell-name="{ row }"><strong>{{ row.name }}</strong><small v-if="row.bankName" class="finance-cell-note">{{ row.bankName }} {{ row.accountNumberLast4 ? `· ending ${row.accountNumberLast4}` : '' }}</small></template><template #cell-balance="{ row }">{{ bdt(row.balance) }}</template><template #empty>Add your first cash or bank account to start recording transactions.</template></AppTable></template>
  </section><ProductReports v-if="tab === 'loans' || tab === 'investments' || tab === 'bank'" :kind="tab" :refresh="reportRevision" @entry="openEntry" /><div v-if="tab === 'expenses'" class="alert success">Net approved expenses in this period: {{ bdt(expenseTotal) }}</div><p class="under-table-note">Balances update after final approval. To correct a posted transaction, request a reversal and submit a new entry.</p>

  <AppModal :open="entryOpen" title="New transaction" description="The ledger updates after final approval." :busy="busy" @close="entryOpen = false">
    <AppForm :busy="busy" :error="actionError" @submit="saveEntry">
      <div class="form-grid">
        <AppSelect v-model="form.type" label="Transaction type" :options="entryOptions" required />
        <AppInput v-model="form.effectiveDate" label="Effective date" type="date" :max="todayDhaka()" required />
      </div>
      <div v-if="needsMember" class="finance-member-search">
        <AppInput v-model="memberSearch" label="Find member by name or number" />
        <AppButton variant="secondary" :loading="searching" @click="searchMembers">Search</AppButton>
      </div>
      <AppSelect v-if="needsMember" v-model="form.memberId" label="Member" :options="memberOptions" required />
      <template v-if="form.type === 'LOAN_DISBURSEMENT'">
        <AppInput v-model="form.installmentCount" label="Number of monthly installments" type="number" min="1" max="600" required />
        <AppInput v-model="form.firstDueDate" label="First installment date" type="date" :min="form.effectiveDate" required />
        <p class="muted">The final installment includes any rounding remainder.</p>
      </template>
      <AppSelect v-if="form.type === 'LOAN_REPAYMENT'" v-model="form.loanId" label="Loan" :options="productOptions" required />
      <template v-if="form.type === 'INVESTMENT_PURCHASE'">
        <AppInput v-model="form.title" label="Investment title" maxlength="120" required />
        <AppInput v-model="form.counterparty" label="Counterparty" maxlength="120" required />
      </template>
      <AppSelect v-if="form.type === 'INVESTMENT_RETURN'" v-model="form.investmentId" label="Investment" :options="productOptions" required />
      <template v-if="fullInvestmentReturn">
        <AppInput v-model="form.principalReturned" label="Principal returned (BDT)" inputmode="decimal" required />
        <AppInput v-model="form.profit" label="Profit received (BDT)" inputmode="decimal" required />
      </template>
      <template v-if="form.type === 'EXPENSE'">
        <AppInput v-model="form.category" label="Expense category" maxlength="80" required />
        <AppInput v-model="form.payee" label="Payee" maxlength="120" required />
      </template>
      <AppSelect v-model="form.cashAccountId" label="Cash or bank account" :options="cashOptions" required />
      <AppSelect v-if="form.type === 'TRANSFER'" v-model="form.destinationAccountId" label="Destination cash or bank account" :options="cashOptions.filter(a => a.value !== form.cashAccountId || !a.value)" required />
      <p v-if="cashOptions.length === 1" class="error-text">Ask an administrator to add a cash or bank account first.</p>
      <AppInput v-model="form.amount" label="Amount (BDT)" :readonly="fullInvestmentReturn" inputmode="decimal" placeholder="0.00" pattern="(0|[1-9][0-9]{0,17})(\.[0-9]{1,2})?" required />
      <AppInput v-if="form.type !== 'OTHER_INCOME'" v-model="form.reference" label="Receipt / reference (optional)" maxlength="120" />
      <AppInput v-model="form.note" label="Note (optional)" maxlength="500" />
      <p class="muted small-text">{{ policy?.requiredApprovals ?? 1 }} approval(s) required. {{ policy?.allowSelfApproval ? 'Self-approval is allowed for authorized approvers.' : 'Another approver must review your request.' }}</p>
      <div class="form-actions">
        <AppButton variant="secondary" @click="entryOpen = false">Cancel</AppButton>
        <AppButton type="submit" :loading="busy">Submit for approval</AppButton>
      </div>
    </AppForm>
  </AppModal>

  <AppModal :open="accountOpen" title="Add cash or bank account" description="Accounts start at zero. Record actual member deposits to add funds." :busy="busy" @close="accountOpen = false"><AppForm :busy="busy" :error="actionError" @submit="saveAccount"><AppSelect v-model="accountForm.kind" label="Account kind" :options="[{label:'Cash',value:'CASH'},{label:'Bank',value:'BANK'}]" /><AppInput v-model="accountForm.code" label="Account code" placeholder="CASH-01" maxlength="40" required /><AppInput v-model="accountForm.name" label="Account name" placeholder="Main cash account" maxlength="120" required /><template v-if="accountForm.kind === 'BANK'"><AppInput v-model="accountForm.bankName" label="Bank name" maxlength="120" required /><AppInput v-model="accountForm.accountNumberLast4" label="Account number last 4 digits (optional)" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" /></template><div class="form-actions"><AppButton variant="secondary" @click="accountOpen = false">Cancel</AppButton><AppButton type="submit" :loading="busy">Create account</AppButton></div></AppForm></AppModal>

  <AppModal :open="policyOpen" title="Approval policy" description="Changes apply to new requests. Existing requests keep their original rules." :busy="busy" @close="policyOpen = false"><AppForm :busy="busy" :error="actionError" @submit="savePolicy"><AppSelect v-model="policyForm.requiredApprovals" label="Required approvals" :options="[{label:'One approver',value:'1'},{label:'Two distinct approvers',value:'2'}]" /><label class="finance-checkbox"><input v-model="policyForm.allowSelfApproval" type="checkbox" /> Allow authorized requesters to approve their own requests</label><p class="muted small-text">Admin and Approver roles can decide requests. Accountant can submit requests. Two approvals always require two different people.</p><div class="form-actions"><AppButton variant="secondary" @click="policyOpen = false">Cancel</AppButton><AppButton type="submit" :loading="busy">Save policy</AppButton></div></AppForm></AppModal>

  <AppModal :open="!!selected" :title="selected?.transactionNo ?? 'Transaction details'" :busy="busy" size="wide" @close="selected = undefined"><template v-if="selected"><div v-if="actionError" class="alert error" role="alert">{{ actionError }}</div><div class="finance-detail-heading"><div><span class="eyebrow">{{ transactionLabel(selected) }}</span><h2>{{ tab === 'income' ? incomeAmount(selected) : bdt(selected.amount) }}</h2></div><StatusBadge :status="selected.status" /></div><dl class="finance-details"><div v-if="selected.member"><dt>Member</dt><dd>{{ selected.member.fullName }} · {{ selected.member.memberNo }}</dd></div><div v-if="selected.investment"><dt>Investment</dt><dd>{{ selected.investment.title }}</dd></div><div><dt>Account</dt><dd>{{ selected.cashAccount.name }}</dd></div><div v-if="tab === 'income' && Number(selected.details?.principalReturned) > 0"><dt>Total transaction amount</dt><dd>{{ bdt(selected.amount) }}</dd></div><div><dt>Effective date</dt><dd>{{ date(selected.effectiveDate) }}</dd></div><div><dt>Requested by</dt><dd>{{ selected.createdBy.name }}</dd></div><div><dt>Reference</dt><dd>{{ selected.reference || '—' }}</dd></div><div><dt>Note</dt><dd class="preserve-lines">{{ selected.note || '—' }}</dd></div><div><dt>Approval rules</dt><dd>{{ selected.requiredApprovals }} distinct approval(s) · Policy {{ selected.policyVersion }} · {{ selected.allowSelfApproval ? 'Self-approval allowed' : 'No self-approval' }}</dd></div><div v-if="selected.reversalOf"><dt>Reverses</dt><dd><button class="text-link" :disabled="busy" @click="showDetails(selected.reversalOf.id)">{{ selected.reversalOf.transactionNo }}</button></dd></div></dl>
    <dl v-if="selected.details" class="finance-details"><div v-for="(value,key) in selected.details" :key="key"><dt>{{ detailLabel(String(key)) }}</dt><dd>{{ detailValue(String(key),value) }}</dd></div></dl><h3>Approval history</h3><p v-if="!selected.decisions.length" class="muted">No decisions yet.</p><ol class="finance-decisions"><li v-for="d in selected.decisions" :key="d.id"><strong>{{ d.step }}. {{ d.approver.name }} · {{ d.decision }}</strong><p>{{ date(d.createdAt) }} {{ d.comment ? `· ${d.comment}` : '' }}</p></li></ol>
    <AppTable v-if="selected.entries?.length" :rows="selected.entries" :columns="[{key:'account',label:'Account'},{key:'debit',label:'Debit'},{key:'credit',label:'Credit'}]"><template #cell-account="{ row }">{{ row.account.name }}</template><template #cell-debit="{ row }">{{ bdt(row.debit) }}</template><template #cell-credit="{ row }">{{ bdt(row.credit) }}</template></AppTable>
    <AppForm v-if="canDecide" :busy="busy" @submit="decide"><h3>Review request</h3><AppSelect v-model="decision" label="Decision" :options="[{label:'Approve',value:'APPROVE'},{label:'Reject',value:'REJECT'}]" /><AppInput v-model="comment" :label="decision === 'REJECT' ? 'Reason for rejection' : 'Comment (optional)'" :required="decision === 'REJECT'" :minlength="decision === 'REJECT' ? 5 : undefined" maxlength="500" /><AppButton type="submit" :variant="decision === 'REJECT' ? 'danger' : 'primary'" :loading="busy">{{ decision === 'REJECT' ? 'Reject request' : 'Approve request' }}</AppButton></AppForm>
    <div class="button-row finance-detail-actions"><AppButton v-if="selected.status === 'PENDING' && selected.createdById === auth.user?.id && auth.can('finance.write')" variant="secondary" :loading="busy" @click="cancel">Cancel pending request</AppButton><AppButton v-if="selected.status === 'POSTED' && selected.type !== 'REVERSAL' && !selected.reversals.length && auth.can('finance.write') && !reverseOpen" variant="secondary" @click="beginReversal">Request reversal</AppButton><AppButton v-if="selected.status === 'REJECTED' && auth.can('finance.delete')" variant="danger" @click="deleteError = ''; deleteOpen = true">Delete rejected transaction</AppButton><span v-if="selected.reversals.length" class="muted">A reversal is already {{ selected.reversals[0]?.status.toLowerCase() }}.</span></div>
    <AppForm v-if="reverseOpen" :busy="busy" @submit="reverse"><h3>Reverse this transaction</h3><p class="muted">The original entry stays unchanged. An approved reversal posts equal and opposite entries.</p><AppInput v-model="reversalDate" label="Reversal date" type="date" :min="selected.effectiveDate.slice(0,10)" :max="todayDhaka()" required /><AppInput v-model="reversalNote" label="Reason for reversal" minlength="5" maxlength="500" required /><div class="form-actions"><AppButton variant="secondary" @click="reverseOpen = false">Cancel</AppButton><AppButton type="submit" :loading="busy">Submit reversal request</AppButton></div></AppForm>
  </template></AppModal>
  <AppModal :open="deleteOpen" title="Delete rejected transaction?" :busy="busy" @close="deleteOpen = false">
    <p class="muted">{{ selected?.transactionNo }} will be removed from the transaction list. Its history will remain in the transaction log.</p>
    <p v-if="deleteError" class="alert error" role="alert">{{ deleteError }}</p>
    <div class="form-actions">
      <AppButton variant="secondary" :disabled="busy" @click="deleteOpen = false">Cancel</AppButton>
      <AppButton variant="danger" :loading="busy" @click="deleteRejected">Delete transaction</AppButton>
    </div>
  </AppModal>
</template>
