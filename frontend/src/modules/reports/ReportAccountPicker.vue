<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import AppButton from '../../components/ui/AppButton.vue';
import AppSelect from '../../components/ui/AppSelect.vue';
import { api, errorMessage } from '../../services/api';
import { reportAccountLabel, type ReportAccount } from './report-data';

const props = defineProps<{ modelValue: string; required?: boolean; disabled?: boolean }>();
defineEmits<{ 'update:modelValue': [id: string] }>();
const accounts = ref<ReportAccount[]>([]);
const loading = ref(false);
const error = ref('');
const request = new AbortController();
const options = computed(() => [
  { label: props.required ? 'Choose an account' : 'All accounts', value: '' },
  ...accounts.value.map(account => ({ label: reportAccountLabel(account), value: account.id })),
]);

async function load() {
  error.value = '';
  loading.value = true;
  try {
    const { data } = await api.get<{ items: ReportAccount[] }>('/finance/report-accounts', { signal: request.signal });
    accounts.value = data.items;
  } catch (cause) {
    if (!request.signal.aborted) error.value = errorMessage(cause);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
onUnmounted(() => request.abort());
</script>

<template>
  <div class="report-account-picker">
    <AppSelect label="Cash or bank account" :model-value="modelValue" :options="options" :disabled="disabled || loading || !!error"
      @update:model-value="$emit('update:modelValue', $event)" />
    <p v-if="error" class="error-text" role="alert">{{ error }} <AppButton variant="ghost" @click="load">Retry</AppButton></p>
    <p v-else-if="!loading && !accounts.length" class="muted" role="status">No cash or bank accounts found.</p>
  </div>
</template>

<style scoped>
.report-account-picker { padding: 0 23px 16px; }
.report-account-picker :deep(.field) { max-width: 520px; }
.report-account-picker p { margin-top: 8px; font-size: 13px; }
@media (max-width: 640px) { .report-account-picker { padding-inline: 16px; } }
</style>
