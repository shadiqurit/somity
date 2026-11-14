<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Plus, Search, ShieldCheck } from 'lucide-vue-next';
import { api, errorMessage } from '../services/api';
import { useAuthStore } from '../stores/auth';
import AppForm from '../components/forms/AppForm.vue';
import AppButton from '../components/ui/AppButton.vue';
import AppInput from '../components/ui/AppInput.vue';
import AppModal from '../components/modals/AppModal.vue';
import AppTable from '../components/tables/AppTable.vue';
import StatusBadge from '../components/ui/StatusBadge.vue';
import UserEntryForm from '../modules/users/UserEntryForm.vue';
interface Account { id: string; name: string; email: string; isActive: boolean; roles: { role: { name: string } }[]; }
const auth = useAuthStore();
const router = useRouter();
const isSuperAdmin = computed(() => auth.user?.isSuperAdmin === true);
const rows = ref<Account[]>([]); const page = ref(1); const pages = ref(1); const total = ref(0); const loading = ref(false); const busy = ref(false); const open = ref(false); const error = ref(''); const notice = ref('');
const search = ref('');
const appliedSearch = ref('');
const target = ref<Account | null>(null);
const password = ref('');
const confirmation = ref('');
const passwordError = ref('');
const savingPassword = ref(false);
const columns = computed(() => [
  { key: 'name', label: 'Name' }, { key: 'email', label: 'Login email' }, { key: 'roles', label: 'Role' }, { key: 'isActive', label: 'Status' },
  ...(isSuperAdmin.value ? [{ key: 'actions', label: 'Actions' }] : []),
]);

async function load(value = page.value) {
  page.value = value;
  loading.value = true;
  error.value = '';
  try {
    const { data } = isSuperAdmin.value
      ? await api.get('/platform/users', { params: { page: value, search: appliedSearch.value } })
      : await api.get('/users', { params: { page: value } });
    rows.value = data.items;
    pages.value = data.pages;
    total.value = data.total;
  } catch (e) {
    rows.value = [];
    pages.value = 1;
    total.value = 0;
    error.value = errorMessage(e);
  } finally { loading.value = false; }
}

function findAccounts() {
  if (loading.value) return;
  appliedSearch.value = search.value.trim();
  return load(1);
}

async function saved() {
  open.value = false;
  notice.value = 'Staff account created successfully.';
  search.value = appliedSearch.value = '';
  await load(1);
}

function closePasswordDialog() {
  target.value = null;
  password.value = '';
  confirmation.value = '';
  passwordError.value = '';
}

async function savePassword() {
  const account = target.value;
  if (!account || savingPassword.value) return;
  if (password.value !== confirmation.value) {
    passwordError.value = 'Passwords do not match';
    return;
  }
  savingPassword.value = true;
  passwordError.value = '';
  try {
    await api.put(`/platform/users/${encodeURIComponent(account.id)}/password`, { password: password.value });
    closePasswordDialog();
    if (account.id === auth.user?.id) {
      auth.clear();
      await router.replace('/login');
    } else {
      notice.value = `Temporary password set for ${account.email}.`;
    }
  } catch (e) { passwordError.value = errorMessage(e); }
  finally { savingPassword.value = false; }
}
onMounted(() => load());
</script>
<template>
  <div class="page-heading">
    <div><span class="eyebrow">THE RIGHT ACCESS, FOR EVERYONE</span><h1>Team & access<span class="heading-dot">.</span></h1>
      <p>{{ isSuperAdmin ? 'Find login accounts across all societies and set temporary passwords.' : 'Manage staff access and see your society’s login accounts.' }}</p>
    </div>
    <AppButton v-if="auth.user?.societyId" @click="open = true"><Plus :size="19" /> Add staff account</AppButton>
  </div>
  <div v-if="notice" class="alert success" role="status">{{ notice }}</div>
  <div v-if="error" class="alert error" role="alert">{{ error }} <AppButton variant="ghost" @click="load()">Retry</AppButton></div>
  <section class="panel directory">
    <div class="directory-heading"><h2><ShieldCheck :size="21" /> User accounts <span class="count-pill">{{ total }}</span></h2><span v-if="isSuperAdmin" class="muted small-text">All societies</span></div>
    <form v-if="isSuperAdmin" class="filter-row" role="search" @submit.prevent="findAccounts">
      <label class="search-field"><Search :size="18" /><input v-model="search" type="search" aria-label="Search user accounts" placeholder="Search name or email…" maxlength="191"></label>
      <AppButton type="submit" variant="secondary" :disabled="loading">Search</AppButton>
    </form>
    <AppTable :rows="rows" :columns="columns" :page="page" :pages="pages" :total="total" :loading="loading" @page="load">
      <template #cell-roles="{ row }">{{ row.roles.map(r => r.role.name).join(', ') || '—' }}</template>
      <template #cell-isActive="{ row }"><StatusBadge :status="row.isActive ? 'ACTIVE' : 'INACTIVE'" /></template>
      <template #cell-actions="{ row }"><AppButton variant="secondary" @click="target = row; notice = ''">Set password</AppButton></template>
    </AppTable>
  </section>
  <p v-if="auth.user?.societyId" class="under-table-note">Create member accounts from their member profile. Accountants can submit financial requests; Approvers can approve or reject them. Both can view financial records within this society.</p>
  <AppModal :open="open" title="Add staff account" description="Create a secure login for someone on your team." :busy="busy" @close="open = false"><UserEntryForm v-if="open" @busy="busy = $event" @cancel="open = false" @saved="saved" /></AppModal>
  <AppModal :open="!!target" title="Set password" :description="target ? `${target.name} (${target.email})` : undefined" :busy="savingPassword" @close="closePasswordDialog">
    <AppForm v-if="target" :busy="savingPassword" :error="passwordError" @submit="savePassword">
      <p class="muted">This signs the user out across all societies. They’ll need to change the temporary password at their next sign-in.</p>
      <AppInput v-model="password" label="Temporary password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required />
      <AppInput v-model="confirmation" label="Confirm temporary password" type="password" autocomplete="new-password" maxlength="128" required />
      <small class="muted">Use 12–128 characters, including an uppercase letter, a lowercase letter and a number.</small>
      <div class="form-actions"><AppButton variant="secondary" @click="closePasswordDialog">Cancel</AppButton><AppButton type="submit" :loading="savingPassword">Set password</AppButton></div>
    </AppForm>
  </AppModal>
</template>
