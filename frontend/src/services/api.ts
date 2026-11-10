import axios from 'axios';
export const api = axios.create({ baseURL: `${import.meta.env.VITE_API_URL ?? ''}/api`, withCredentials: true, timeout: 20000 });
let token: string | null = null;
let societyId: string | null = sessionStorage.getItem('somity_society_id');
let onRefreshed: (user: unknown) => void = () => {};
let onExpired: () => void = () => {};
let pending: Promise<string> | null = null;
export function setToken(value: string | null) { token = value; }
export function setSocietyId(value: string | null) {
  societyId = value;
  if (value) sessionStorage.setItem('somity_society_id', value); else sessionStorage.removeItem('somity_society_id');
}
export function setRefreshedHandler(handler: (user: unknown) => void) { onRefreshed = handler; }
export function setExpiredHandler(handler: () => void) { onExpired = handler; }
api.interceptors.request.use(config => {
  if (token) config.headers.Authorization = `Bearer ${token}`;
  // Retried requests retain their original tenant, even if the UI selection changes.
  if (societyId && !config.headers.has('X-Society-Id')) config.headers.set('X-Society-Id', societyId);
  return config;
});
api.interceptors.response.use(r => r, async error => {
  const config = error.config;
  if (error.response?.status !== 401 || !config || config._retried || config.url?.startsWith('/auth/')) throw error;
  config._retried = true;
  try {
    pending ??= api.post('/auth/refresh').then(r => { setToken(r.data.accessToken); onRefreshed(r.data.user); return r.data.accessToken as string; }).finally(() => { pending = null; });
    config.headers.Authorization = `Bearer ${await pending}`;
    return await api(config);
  } catch (refreshError) { setToken(null); onExpired(); throw refreshError; }
});
export function errorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const details = error.response?.data?.error;
    if (details?.fields) {
      const fields = Object.entries(details.fields as Record<string, string[]>).map(([key, values]) => `${key}: ${values.join(', ')}`);
      if (fields.length) return fields.join(' · ');
    }
    return details?.message ?? (error.code === 'ECONNABORTED' ? 'The request timed out. Please try again.' : 'Cannot connect to the server. Please try again.');
  }
  return error instanceof Error ? error.message : 'Something went wrong';
}
