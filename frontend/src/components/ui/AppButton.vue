<script setup lang="ts">
withDefaults(defineProps<{ variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; loading?: boolean; type?: 'button' | 'submit' }>(), { variant: 'primary', type: 'button' });
</script>
<template><button :type="type" :class="['btn', `btn-${variant}`]" :disabled="loading" :aria-busy="loading"><span v-if="loading" class="spinner small"></span><slot /></button></template>
