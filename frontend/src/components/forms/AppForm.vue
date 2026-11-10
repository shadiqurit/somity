<script setup lang="ts">defineProps<{ error?: string; busy?: boolean }>(); defineEmits<{ submit: [] }>();</script>
<template><form class="app-form" :aria-busy="busy" @submit.prevent="$emit('submit')"><div v-if="error" class="alert error" role="alert">{{ error }}</div><fieldset :disabled="busy"><slot /></fieldset></form></template>
