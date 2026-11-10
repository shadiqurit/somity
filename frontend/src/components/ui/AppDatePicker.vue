<script setup lang="ts">
import AppInput from './AppInput.vue';
defineProps<{ label: string; modelValue: string }>(); defineEmits<{ 'update:modelValue': [value: string] }>();
</script>
<template><AppInput :label="label" :model-value="modelValue" type="date" required @update:model-value="$emit('update:modelValue', $event)" /></template>
