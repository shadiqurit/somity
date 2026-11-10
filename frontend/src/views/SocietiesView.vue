<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ArrowUpRight, Building2, Pencil, Plus, Search } from 'lucide-vue-next';
import { api, errorMessage } from '../services/api';
import { useAuthStore } from '../stores/auth';
import AppButton from '../components/ui/AppButton.vue';
import AppModal from '../components/modals/AppModal.vue';
import AppTable from '../components/tables/AppTable.vue';
import StatusBadge from '../components/ui/StatusBadge.vue';
import SocietyEditor, { type Society } from '../modules/societies/SocietyEditor.vue';
const auth = useAuthStore(); const rows = ref<Society[]>([]); const page = ref(1); const pages = ref(1); const total = ref(0); const search = ref(''); const loading = ref(false); const busy = ref(false); const switching = ref(false); const error = ref(''); const notice = ref(''); const open = ref(false); const editing = ref<Society>(); let timer: ReturnType<typeof setTimeout>; let sequence = 0;
const columns = [{ key: 'name', label: 'Society' }, { key: 'code', label: 'Code' }, { key: 'members', label: 'Members' }, { key: 'users', label: 'Users' }, { key: 'status', label: 'Status' }, { key: 'actions', label: 'Actions' }];
async function load(value = page.value) { const request = ++sequence; page.value = value; loading.value = true; error.value = ''; try { const { data } = await api.get('/societies', { params: { page: value, search: search.value } }); if (request === sequence) { rows.value = data.items; pages.value = data.pages; total.value = data.total; } } catch (e) { if (request === sequence) error.value = errorMessage(e); } finally { if (request === sequence) loading.value = false; } }
function edit(society?: Society) { editing.value = society; open.value = true; }
async function saved() { open.value = false; notice.value = 'Society saved successfully.'; await auth.refreshProfile(); await load(1); }
async function enter(id: string) { switching.value = true; error.value = ''; try { await auth.switchSociety(id); } catch (e) { error.value = errorMessage(e); switching.value = false; } }
watch(search, () => { clearTimeout(timer); timer = setTimeout(() => load(1), 300); }); onBeforeUnmount(() => { clearTimeout(timer); sequence++; }); onMounted(() => load());
</script>
<template>
  <div class="page-heading"><div><span class="eyebrow">SUPER ADMIN WORKSPACE</span><h1>Societies<span class="heading-dot">.</span></h1><p>Independent communities, each with its own people and records.</p></div><AppButton @click="edit()"><Plus :size="19" /> Add society</AppButton></div>
  <div v-if="error" class="alert error" role="alert">{{ error }} <AppButton variant="ghost" @click="load()">Retry</AppButton></div><div v-if="notice" class="alert success" role="status">{{ notice }}</div>
  <section class="panel directory"><div class="directory-heading"><h2><Building2 :size="21" /> All societies <span class="count-pill">{{ total }}</span></h2><span class="muted small-text">Only Super Admin can manage this list</span></div><div class="filter-row"><label class="search-field"><Search :size="18" /><input v-model="search" aria-label="Search societies" placeholder="Search society name or code…"></label></div>
    <AppTable :rows="rows" :columns="columns" :page="page" :pages="pages" :total="total" :loading="loading" @page="load"><template #cell-name="{ row }"><strong>{{ row.name }}</strong></template><template #cell-members="{ row }">{{ row._count.members }}</template><template #cell-users="{ row }">{{ row._count.memberships }}</template><template #cell-status="{ row }"><StatusBadge :status="row.isActive ? 'ACTIVE' : 'INACTIVE'" /></template><template #cell-actions="{ row }"><div class="button-row"><AppButton variant="secondary" :disabled="!row.isActive || switching" :aria-label="`Open ${row.name}`" @click="enter(row.id)">Open <ArrowUpRight :size="17" /></AppButton><button class="icon-button" :aria-label="`Edit ${row.name}`" @click="edit(row)"><Pencil :size="18" /></button></div></template></AppTable>
  </section>
  <AppModal :open="open" :title="editing ? 'Edit society' : 'Add society'" description="Society admins, approvers, members and data stay within their own workspace." size="wide" :busy="busy" @close="open = false"><SocietyEditor v-if="open" :society="editing" @busy="busy = $event" @cancel="open = false" @saved="saved" /></AppModal>
</template>
