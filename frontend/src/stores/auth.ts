import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { api, setExpiredHandler, setRefreshedHandler, setSocietyId, setToken } from '../services/api';
export interface SocietyOption { id: string; code: string; name: string; }
export interface User { id: string; name: string; email: string; roles: string[]; permissions: string[]; memberId: string | null; mustChangePassword: boolean; isSuperAdmin: boolean; societyId: string | null; society: SocietyOption | null; societies: SocietyOption[]; }
export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null); const initialized = ref(false);
  const isStaff = computed(() => !!user.value?.permissions.includes('dashboard.read'));
  const can = (permission: string) => !!user.value?.permissions.includes(permission);
  function applyUser(value: User) { user.value = value; setSocietyId(value.societyId); }
  function clear() { user.value = null; setToken(null); setSocietyId(null); }
  setExpiredHandler(() => { clear(); window.location.assign('/login'); });
  setRefreshedHandler(value => applyUser(value as User));
  async function initialize() {
    if (initialized.value) return;
    try { const { data } = await api.post('/auth/refresh'); applyUser(data.user); setToken(data.accessToken); }
    catch { clear(); } finally { initialized.value = true; }
  }
  async function login(email: string, password: string) {
    const { data } = await api.post('/auth/login', { email, password });
    applyUser(data.user); setToken(data.accessToken); initialized.value = true;
  }
  async function refreshProfile() { applyUser((await api.get('/auth/me')).data); }
  async function switchSociety(id: string) {
    const previous = user.value?.societyId ?? null;
    setSocietyId(id);
    try { await refreshProfile(); }
    catch (error) { setSocietyId(previous); throw error; }
    // A fresh document removes profiles, list results and modal state from the old society.
    window.location.assign(isStaff.value ? '/' : '/my-profile');
  }
  async function logout() { await api.post('/auth/logout'); clear(); }
  return { user, initialized, isStaff, can, initialize, login, logout, clear, refreshProfile, switchSociety };
});
