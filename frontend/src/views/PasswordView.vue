<script setup lang="ts">
import { ref } from 'vue'; import { useRouter } from 'vue-router'; import { useAuthStore } from '../stores/auth'; import { api, errorMessage } from '../services/api'; import AppForm from '../components/forms/AppForm.vue'; import AppInput from '../components/ui/AppInput.vue'; import AppButton from '../components/ui/AppButton.vue';
const auth = useAuthStore(); const router = useRouter(); const current = ref(''); const password = ref(''); const confirm = ref(''); const busy = ref(false); const error = ref('');
async function submit() {
  if (password.value !== confirm.value) { error.value = 'Passwords do not match'; return; }
  busy.value = true; error.value = '';
  try { await api.post('/auth/password', { currentPassword: current.value, newPassword: password.value }); auth.clear(); await router.push('/login'); }
  catch (e) { error.value = errorMessage(e); } finally { busy.value = false; }
}
</script>
<template><div class="centered-page"><section class="panel password-panel"><span class="eyebrow">KEEP YOUR ACCOUNT SECURE</span><h1>Set your own password</h1><p class="muted">Replace your temporary password to continue. Use 12–128 characters, including uppercase, lowercase and a number. You’ll sign in again afterward.</p><AppForm :busy="busy" :error="error" @submit="submit"><AppInput v-model="current" label="Current password" type="password" autocomplete="current-password" required /><AppInput v-model="password" label="New password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required /><AppInput v-model="confirm" label="Confirm new password" type="password" autocomplete="new-password" required /><AppButton type="submit" :loading="busy">Save password</AppButton></AppForm></section></div></template>
