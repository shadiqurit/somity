<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useAuthStore } from '../stores/auth';
import { useLocale } from '../composables/useLocale';
import { api, errorMessage } from '../services/api';
import AppButton from '../components/ui/AppButton.vue';
import AppSelect from '../components/ui/AppSelect.vue';
import AppTable from '../components/tables/AppTable.vue';

interface Activity {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  targetLabel: string | null;
  createdAt: string;
  actorRole: string | null;
  actor: { id: string; name: string } | null;
  society: { id: string; name: string } | null;
}

const labels: Record<string, string> = {
  AUTH_LOGIN: 'Signed in', AUTH_LOGOUT: 'Signed out', PASSWORD_CHANGED: 'Changed password', PASSWORD_RESET: 'Reset password',
  SUPERADMIN_SEEDED: 'Initialized Super Admin', ADMIN_CREATED: 'Created an admin account', STAFF_CREATED: 'Created a staff account',
  SOCIETY_CREATED: 'Created a society', SOCIETY_UPDATED: 'Updated a society', SOCIETY_SELECTED: 'Switched society',
  MEMBER_CREATED: 'Added a member', MEMBER_UPDATED: 'Updated a member', MEMBER_CLOSED: 'Closed a membership',
  MEMBER_SETTLEMENT_STARTED: 'Started final settlement', MEMBER_SETTLEMENT_COMPLETED: 'Completed final settlement',
  MEMBER_DUES_STATEMENT_VIEWED: 'Viewed dues and receivables',
  MEMBER_ARCHIVED: 'Archived a member', MEMBER_LOGIN_CREATED: 'Created a member login', MEMBER_PROFILE_VIEWED: 'Viewed a member profile',
  MEMBER_PHOTO_UPLOADED: 'Uploaded a member photo', MEMBER_PHOTO_REMOVED: 'Removed a member photo',
  FINANCE_ACCOUNT_CREATED: 'Created a financial account', FINANCE_POLICY_UPDATED: 'Updated the approval policy',
  FINANCE_REQUESTED: 'Submitted a transaction', FINANCE_APPROVED: 'Approved a transaction', FINANCE_REJECTED: 'Rejected a transaction',
  FINANCE_POSTED: 'Posted a transaction', FINANCE_CANCELLED: 'Cancelled a transaction', FINANCE_DELETED: 'Deleted a rejected transaction',
  FINANCE_REVERSAL_REQUESTED: 'Requested a reversal', FINANCE_TRANSACTION_VIEWED: 'Viewed a transaction',
  FINANCE_STATEMENT_VIEWED: 'Viewed a savings statement', FINANCE_LEDGER_VIEWED: 'Viewed the society ledger',
  FINANCE_LOAN_VIEWED: 'Viewed a loan', FINANCE_LOANS_VIEWED: 'Viewed own loan history', FINANCE_INVESTMENT_VIEWED: 'Viewed an investment',
};
const roles: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin', ADMIN: 'Admin', SOCIETY_ADMIN: 'Society Admin', ACCOUNTANT: 'Accountant', APPROVER: 'Approver', MEMBER: 'Member',
};
const targets: Record<string, string> = { member: 'Member', transaction: 'Transaction', user: 'User', society: 'Society', account: 'Account', finance_policy: 'Approval policy', ledger: 'Society ledger', loan: 'Loan', investment: 'Investment' };
const actionOptions = [{ value: '', label: 'All actions' }, ...Object.entries(labels).map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))];
const roleOptions = [{ value: '', label: 'All roles' }, ...Object.entries(roles).map(([value, label]) => ({ value, label }))];
const columns = [{ key: 'createdAt', label: 'Date and time' }, { key: 'action', label: 'Action' }, { key: 'actor', label: 'Performed by' }, { key: 'target', label: 'Record' }, { key: 'society', label: 'Society' }];
const timestamp = new Intl.DateTimeFormat('en-BD', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Dhaka' });
const auth = useAuthStore();
const { t } = useLocale();
const scopes = [
  ...(auth.can('activity.read') && auth.user?.societyId ? [{ value: '/activity', label: 'Society activity' }] : []),
  { value: '/activity/me', label: 'My activity' },
  ...(auth.user?.isSuperAdmin ? [{ value: '/activity/platform', label: 'All societies and platform' }] : []),
];
const scope = ref(auth.user?.isSuperAdmin && !auth.user.societyId ? '/activity/platform' : scopes[0]!.value);
const action = ref('');
const actorRole = ref('');
const applied = ref({ scope: scope.value, action: '', actorRole: '' });
const rows = ref<Activity[]>([]);
const cursors = ref<string[]>([]);
const nextCursor = ref<string | null>(null);
const loading = ref(false);
const error = ref('');
let sequence = 0;

async function load(history = cursors.value, query = applied.value) {
  const current = ++sequence;
  loading.value = true;
  error.value = '';
  try {
    const { data } = await api.get<{ items: Activity[]; nextCursor: string | null }>(query.scope, {
      params: { after: history.at(-1), action: query.action || undefined, actorRole: query.actorRole || undefined },
    });
    if (current !== sequence) return;
    rows.value = data.items;
    cursors.value = history;
    nextCursor.value = data.nextCursor;
    applied.value = query;
  } catch (e) { if (current === sequence) error.value = errorMessage(e); }
  finally { if (current === sequence) loading.value = false; }
}

function applyFilters() {
  void load([], { scope: scope.value, action: action.value, actorRole: scope.value === '/activity/me' ? '' : actorRole.value });
}

onMounted(() => load());
</script>

<template>
  <div class="page-heading"><h1>{{ t('Activity log') }}<span class="heading-dot">.</span></h1></div>
  <section class="panel directory">
    <form class="finance-filters" @submit.prevent="applyFilters">
      <AppSelect v-if="scopes.length > 1" v-model="scope" label="Activity scope" :options="scopes" />
      <AppSelect v-model="action" label="Action" :options="actionOptions" />
      <AppSelect v-if="scope !== '/activity/me'" v-model="actorRole" label="Performed by role" :options="roleOptions" />
      <AppButton type="submit" variant="secondary" :loading="loading">Apply filters</AppButton>
    </form>
    <div v-if="error" class="alert error" role="alert">{{ error }}</div>
    <AppTable v-else :rows="rows" :columns="columns" :loading="loading">
      <template #cell-createdAt="{ row }">{{ timestamp.format(new Date(row.createdAt)) }}</template>
      <template #cell-action="{ row }">{{ labels[row.action] ?? row.action }}</template>
      <template #cell-actor="{ row }">
        <strong>{{ row.actor?.name ?? '—' }}</strong>
        <small class="finance-cell-note">{{ row.actorRole ? roles[row.actorRole] ?? row.actorRole : 'Role unrecorded' }}</small>
      </template>
      <template #cell-target="{ row }">
        {{ row.targetLabel ?? targets[row.entityType] ?? row.entityType }}
        <small v-if="!row.targetLabel && ['loan', 'member', 'transaction'].includes(row.entityType)" class="finance-cell-note">{{ row.entityId }}</small>
      </template>
      <template #cell-society="{ row }">{{ row.society?.name ?? 'Account or platform' }}</template>
      <template #empty>No activity matches these filters.</template>
    </AppTable>
    <div v-if="!error && (cursors.length || nextCursor)" class="table-footer">
      <span>Page {{ cursors.length + 1 }}</span>
      <div class="button-row">
        <AppButton variant="secondary" :disabled="loading || !cursors.length" @click="load(cursors.slice(0, -1))">Newer</AppButton>
        <AppButton variant="secondary" :disabled="loading || !nextCursor" @click="nextCursor && load([...cursors, nextCursor])">Older</AppButton>
      </div>
    </div>
  </section>
</template>
