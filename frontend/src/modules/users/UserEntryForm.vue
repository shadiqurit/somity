<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ShieldCheck, UserRound } from 'lucide-vue-next';
import { api, errorMessage } from '../../services/api';
import AppForm from '../../components/forms/AppForm.vue';
import AppInput from '../../components/ui/AppInput.vue';
import AppSelect from '../../components/ui/AppSelect.vue';
import AppButton from '../../components/ui/AppButton.vue';
const emit = defineEmits<{ saved: []; cancel: []; busy: [value: boolean] }>();
const name = ref(''); const email = ref(''); const password = ref(''); const roleCode = ref('ADMIN');
const roles = ref<{ label: string; value: string }[]>([]); const busy = ref(false); const error = ref(''); const loading = ref(true);
async function loadRoles() {
  loading.value = true; error.value = '';
  try { roles.value = (await api.get('/roles')).data.filter((r: { code: string }) => r.code !== 'MEMBER').map((r: { code: string; name: string }) => ({ label: r.name, value: r.code })); }
  catch (e) { error.value = errorMessage(e); } finally { loading.value = false; }
}
async function submit() {
  busy.value = true; emit('busy', true); error.value = '';
  try { await api.post('/users', { name: name.value, email: email.value, password: password.value, roleCode: roleCode.value }); emit('saved'); }
  catch (e) { error.value = errorMessage(e); } finally { busy.value = false; emit('busy', false); }
}
onMounted(loadRoles);
</script>
<template>
  <AppForm :error="error" :busy="busy" @submit="submit">
    <div class="section-heading"><span class="entry-section-icon"><UserRound :size="22" /></span><div><h3>Account details</h3><p>Invite a team member with the right level of access.</p></div></div>
    <AppInput v-model="name" label="Full name" placeholder="Enter the user’s full name" required minlength="2" maxlength="120" autocomplete="name" />
    <AppInput v-model="email" label="Login email" type="email" placeholder="name@example.com" required maxlength="191" autocomplete="off" />
    <AppSelect v-model="roleCode" label="Access role" :options="roles" :disabled="loading" required />
    <AppButton v-if="!loading && !roles.length" variant="secondary" @click="loadRoles">Reload roles</AppButton>
    <AppInput v-model="password" label="Temporary password" type="password" placeholder="At least 12 characters" autocomplete="new-password" required minlength="12" maxlength="128" />
    <div class="entry-security-note"><ShieldCheck :size="22" /><p>Include uppercase, lowercase and a number. The user will set their own password at first sign-in.</p></div>
    <div class="form-actions"><AppButton variant="secondary" @click="$emit('cancel')">Cancel</AppButton><AppButton type="submit" :loading="busy" :disabled="loading || !roles.length">Create account</AppButton></div>
  </AppForm>
</template>
