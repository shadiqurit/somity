<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { api } from '../../services/api'; import { initials } from '../../utils/format';
const props = defineProps<{ name: string; documentId?: string; large?: boolean }>(); const url = ref(''); let currentRequest = 0;
watch(() => props.documentId, async id => {
  const request = ++currentRequest;
  if (url.value) URL.revokeObjectURL(url.value); url.value = '';
  if (!id) return;
  try { const { data } = await api.get(`/documents/${id}`, { responseType: 'blob' }); if (request === currentRequest) url.value = URL.createObjectURL(data); } catch { /* Initials remain available when an image cannot load. */ }
}, { immediate: true });
onBeforeUnmount(() => { currentRequest++; if (url.value) URL.revokeObjectURL(url.value); });
</script>
<template><span :class="['avatar', { large }]" :aria-label="name"><img v-if="url" :src="url" :alt="name"><span v-else>{{ initials(name) }}</span></span></template>
