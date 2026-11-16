<script setup lang="ts">
import AppModal from './AppModal.vue'; import AppButton from '../ui/AppButton.vue';
withDefaults(defineProps<{ open: boolean; title: string; message: string; busy?: boolean; error?: string; confirmLabel?: string }>(), { confirmLabel: 'Archive member' }); defineEmits<{ close: []; confirm: [] }>();
</script>
<template><AppModal :open="open" :title="title" :busy="busy" @close="$emit('close')"><p class="muted">{{ message }}</p><p v-if="error" role="alert" class="alert error">{{ error }}</p><div class="form-actions"><AppButton variant="secondary" :disabled="busy" @click="$emit('close')">Cancel</AppButton><AppButton variant="danger" :loading="busy" @click="$emit('confirm')">{{ confirmLabel }}</AppButton></div></AppModal></template>
