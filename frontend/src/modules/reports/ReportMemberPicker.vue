<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import AppButton from '../../components/ui/AppButton.vue';
import AppInput from '../../components/ui/AppInput.vue';
import AppSelect from '../../components/ui/AppSelect.vue';
import { api, errorMessage } from '../../services/api';
import { reportMemberLabel, type ReportMember } from './report-data';

const props = defineProps<{ member?: ReportMember; required?: boolean; disabled?: boolean }>();
const emit = defineEmits<{ change: [member: ReportMember | undefined] }>();
const search = ref('');
const matches = ref<ReportMember[]>([]);
const hasMore = ref(false);
const loading = ref(false);
const error = ref('');
let request: AbortController | undefined;

const choices = computed(() => {
  const selected = props.member;
  return selected && !matches.value.some(item => item.id === selected.id) ? [selected, ...matches.value] : matches.value;
});
const options = computed(() => [
  { label: props.required ? 'Choose a member' : 'All members', value: '' },
  ...choices.value.map(member => ({ label: reportMemberLabel(member), value: member.id })),
]);

async function findMembers() {
  request?.abort();
  const current = new AbortController();
  request = current;
  loading.value = true;
  error.value = '';
  try {
    const { data } = await api.get<{ items: ReportMember[]; hasMore: boolean }>('/finance/report-members', {
      params: { search: search.value.trim() }, signal: current.signal,
    });
    if (current.signal.aborted) return;
    matches.value = data.items;
    hasMore.value = data.hasMore;
  } catch (cause) {
    if (!current.signal.aborted) error.value = errorMessage(cause);
  } finally {
    if (!current.signal.aborted) loading.value = false;
  }
}

onMounted(findMembers);
onUnmounted(() => request?.abort());
</script>

<template>
  <form class="member-picker" aria-label="Member filter" @submit.prevent="findMembers">
    <AppInput v-model="search" label="Find member by name or number" type="search" maxlength="120" :disabled="disabled" />
    <AppButton type="submit" variant="secondary" :loading="loading" :disabled="disabled || loading">Search members</AppButton>
    <AppSelect label="Member" :model-value="member?.id ?? ''" :options="options" :disabled="disabled || loading"
      @update:model-value="id => emit('change', choices.find(item => item.id === id))" />
    <p v-if="error" class="error-text member-picker-note" role="alert">{{ error }}</p>
    <p v-else-if="!loading && !matches.length" class="muted member-picker-note" role="status">No matching members.</p>
    <p v-else-if="hasMore" class="muted member-picker-note" role="status">Search by name or member number to narrow the list.</p>
  </form>
</template>

<style scoped>
.member-picker { display: flex; flex-wrap: wrap; align-items: end; gap: 12px; padding: 0 23px 16px; }
.member-picker :deep(.field) { flex: 1 1 205px; min-width: 0; }
.member-picker-note { flex-basis: 100%; margin: 0; font-size: 13px; }
@media (max-width: 640px) {
  .member-picker { padding-inline: 16px; }
  .member-picker :deep(.field:last-of-type) { flex-basis: 100%; }
}
</style>
