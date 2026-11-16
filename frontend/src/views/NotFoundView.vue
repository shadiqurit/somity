<script setup lang="ts">
import ThemeToggle from '../components/ui/ThemeToggle.vue';
</script>

<template><div class="centered-page"><ThemeToggle class="standalone-theme-toggle" /><div class="panel"><span class="eyebrow">404</span><h1>Page not found</h1><p class="muted">This page isn’t available.</p><RouterLink class="btn btn-primary" to="/">Back to workspace</RouterLink></div></div></template>
