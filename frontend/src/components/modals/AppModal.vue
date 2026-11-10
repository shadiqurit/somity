<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
import { X } from 'lucide-vue-next';
const props = defineProps<{ open: boolean; title: string; description?: string; busy?: boolean; size?: 'default' | 'wide' }>();
const emit = defineEmits<{ close: [] }>(); const dialog = ref<HTMLDialogElement>();
const titleId = useId();
watch(() => props.open, async value => { await nextTick(); if (value) dialog.value?.showModal(); else dialog.value?.close(); }, { immediate: true });
function cancel(event: Event) { event.preventDefault(); if (!props.busy) emit('close'); }
onBeforeUnmount(() => dialog.value?.close());
</script>
<template>
  <dialog ref="dialog" :class="['modal', { 'modal-wide': size === 'wide' }]" :aria-labelledby="titleId" :aria-describedby="description ? `${titleId}-description` : undefined" @cancel="cancel">
    <div class="modal-header"><div><h2 :id="titleId">{{ title }}</h2><p v-if="description" :id="`${titleId}-description`" class="modal-description">{{ description }}</p></div><button class="icon-button" aria-label="Close dialog" :disabled="busy" @click="$emit('close')"><X :size="22" /></button></div>
    <div class="modal-content"><slot /></div>
  </dialog>
</template>
