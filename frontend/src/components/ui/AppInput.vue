<script setup lang="ts">
import { useId } from 'vue';
defineOptions({ inheritAttrs: false });
defineProps<{ label: string; modelValue: string | number; type?: string; error?: string }>();
defineEmits<{ 'update:modelValue': [value: string] }>();
const id = useId();
</script>
<template><label class="field" :for="id"><span>{{ label }}</span><input :id="id" v-bind="$attrs" :type="type ?? 'text'" :value="modelValue" :aria-invalid="!!error" :aria-describedby="error ? `${id}-error` : undefined" @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"><small v-if="error" :id="`${id}-error`" class="error-text">{{ error }}</small></label></template>
