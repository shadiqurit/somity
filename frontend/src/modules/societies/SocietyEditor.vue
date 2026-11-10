<script setup lang="ts">
import { ref } from 'vue';
import { Building2, ShieldCheck } from 'lucide-vue-next';
import { api, errorMessage } from '../../services/api';
import AppForm from '../../components/forms/AppForm.vue';
import AppInput from '../../components/ui/AppInput.vue';
import AppButton from '../../components/ui/AppButton.vue';
export interface Society { id: string; code: string; name: string; email: string | null; phone: string | null; address: string | null; isActive: boolean; version: number; _count: { members: number; memberships: number }; }
const props = defineProps<{ society?: Society }>();
const emit = defineEmits<{ saved: []; cancel: []; busy: [value: boolean] }>();
const form = ref({ name: props.society?.name ?? '', code: props.society?.code ?? '', email: props.society?.email ?? '', phone: props.society?.phone ?? '', address: props.society?.address ?? '', isActive: props.society?.isActive ?? true });
const admin = ref({ name: '', email: '', password: '' }); const busy = ref(false); const error = ref('');
async function submit() {
  busy.value = true; emit('busy', true); error.value = '';
  try {
    if (props.society) await api.put(`/societies/${props.society.id}`, { ...form.value, version: props.society.version });
    else { const { isActive, ...details } = form.value; await api.post('/societies', { ...details, admin: admin.value }); }
    emit('saved');
  } catch (e) { error.value = errorMessage(e); } finally { busy.value = false; emit('busy', false); }
}
</script>
<template>
  <AppForm :error="error" :busy="busy" @submit="submit">
    <section class="entry-section"><div class="section-heading"><span class="entry-section-icon"><Building2 :size="22" /></span><div><h3>Society details</h3><p>A separate workspace for its people and records.</p></div></div>
      <div class="form-grid"><AppInput v-model="form.name" label="Society name" required minlength="2" maxlength="120" placeholder="Enter the society’s name" /><AppInput v-model="form.code" label="Society code" required minlength="2" maxlength="40" pattern="[A-Za-z0-9-]+" placeholder="e.g. SHAPLA-01" /><AppInput v-model="form.email" label="Society email (optional)" type="email" maxlength="191" /><AppInput v-model="form.phone" label="Society phone (optional)" type="tel" maxlength="25" /><label class="field full-span"><span>Society address (optional)</span><textarea v-model="form.address" rows="2" maxlength="500"></textarea></label></div>
      <label v-if="society" class="society-active-toggle"><input v-model="form.isActive" type="checkbox"> Society is active</label>
      <p v-if="society" class="muted small-text">Inactive societies cannot be opened by their users. Their records are retained.</p>
    </section>
    <section v-if="!society" class="entry-section"><div class="section-heading"><span class="entry-section-icon"><ShieldCheck :size="22" /></span><div><h3>First administrator</h3><p>This admin can manage users and members in this society only.</p></div></div>
      <div class="form-grid"><AppInput v-model="admin.name" label="Admin full name" required minlength="2" maxlength="120" /><AppInput v-model="admin.email" label="Admin login email" type="email" required maxlength="191" autocomplete="off" /><AppInput v-model="admin.password" class="full-span" label="Admin temporary password" type="password" required minlength="12" maxlength="128" autocomplete="new-password" /></div><p class="muted small-text society-password-help">Use 12–128 characters with uppercase, lowercase and a number. The admin must change this password at first sign-in.</p>
    </section>
    <div class="form-actions entry-actions"><span class="entry-hint">Each society’s records remain separate.</span><AppButton variant="secondary" @click="$emit('cancel')">Cancel</AppButton><AppButton type="submit" :loading="busy">{{ society ? 'Save society' : 'Create society' }}</AppButton></div>
  </AppForm>
</template>
