<script setup lang="ts">defineProps<{ status: string }>();</script>
<template><span :class="['badge', status.toLowerCase()]"><span class="badge-dot"></span>{{ status.charAt(0) + status.slice(1).toLowerCase() }}</span></template>
