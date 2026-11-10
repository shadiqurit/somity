<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Plus, ShieldCheck } from 'lucide-vue-next';
import { api, errorMessage } from '../services/api';
import AppButton from '../components/ui/AppButton.vue';
import AppModal from '../components/modals/AppModal.vue';
import AppTable from '../components/tables/AppTable.vue';
import StatusBadge from '../components/ui/StatusBadge.vue';
import UserEntryForm from '../modules/users/UserEntryForm.vue';
interface Staff { id: string; name: string; email: string; isActive: boolean; roles: { role: { name: string } }[]; }
const rows = ref<Staff[]>([]); const page = ref(1); const pages = ref(1); const total = ref(0); const loading = ref(false); const busy = ref(false); const open = ref(false); const error = ref(''); const notice = ref('');
const columns = [{ key: 'name', label: 'Name' }, { key: 'email', label: 'Login email' }, { key: 'roles', label: 'Role' }, { key: 'isActive', label: 'Status' }];
async function load(value = page.value) { page.value = value; loading.value = true; error.value = ''; try { const { data } = await api.get('/users', { params: { page: value } }); rows.value = data.items; pages.value = data.pages; total.value = data.total; } catch (e) { error.value = errorMessage(e); } finally { loading.value = false; } }
async function saved() { open.value = false; notice.value = 'Staff account created successfully.'; await load(1); }
onMounted(() => load());
</script>
<template>
  <div class="page-heading"><div><span class="eyebrow">THE RIGHT ACCESS, FOR EVERYONE</span><h1>Team & access<span class="heading-dot">.</span></h1><p>Manage staff access and see your society’s login accounts.</p></div><AppButton @click="open = true"><Plus :size="19" /> Add staff account</AppButton></div>
  <div v-if="notice" class="alert success" role="status">{{ notice }}</div>
  <div v-if="error" class="alert error" role="alert">{{ error }} <AppButton variant="ghost" @click="load()">Retry</AppButton></div>
  <section class="panel directory"><div class="directory-heading"><h2><ShieldCheck :size="21" /> User accounts <span class="count-pill">{{ total }}</span></h2><span class="muted small-text">Access for every role</span></div><AppTable :rows="rows" :columns="columns" :page="page" :pages="pages" :total="total" :loading="loading" @page="load"><template #cell-roles="{ row }">{{ row.roles.map(r => r.role.name).join(', ') }}</template><template #cell-isActive="{ row }"><StatusBadge :status="row.isActive ? 'ACTIVE' : 'INACTIVE'" /></template></AppTable></section>
  <p class="under-table-note">Create member accounts from their member profile. Accountants can submit financial requests; Approvers can approve or reject them. Both can view financial records within this society.</p>
  <AppModal :open="open" title="Add staff account" description="Create a secure login for someone on your team." :busy="busy" @close="open = false"><UserEntryForm v-if="open" @busy="busy = $event" @cancel="open = false" @saved="saved" /></AppModal>
</template>
