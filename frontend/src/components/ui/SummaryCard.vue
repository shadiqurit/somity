<script setup lang="ts">defineProps<{ label: string; value: number; detail: string }>();</script>
<template><article class="summary-card"><div class="summary-top"><span>{{ label }}</span><span class="summary-icon"><slot /></span></div><strong>{{ value.toLocaleString('en-BD') }}</strong><small>{{ detail }}</small></article></template>
