<script setup lang="ts">
import { useId } from 'vue';
defineOptions({ inheritAttrs: false });
defineProps<{ label: string; modelValue: string; options: { label: string; value: string }[] }>();
defineEmits<{ 'update:modelValue': [value: string] }>(); const id = useId();
</script>
<template><label class="field" :for="id"><span :id="`${id}-label`">{{ label }}</span><select :id="id" v-bind="$attrs" :aria-labelledby="`${id}-label`" :value="modelValue" @change="$emit('update:modelValue', ($event.target as HTMLSelectElement).value)"><option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option></select></label></template>
