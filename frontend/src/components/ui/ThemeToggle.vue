<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { Moon, Sun } from 'lucide-vue-next';
import { useLocale } from '../../composables/useLocale';

const { t } = useLocale();
const root = document.documentElement;
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
const systemIsDark = ref(systemTheme.matches);
const selectedTheme = ref(root.dataset.theme);
const isDark = computed(() => selectedTheme.value ? selectedTheme.value === 'dark' : systemIsDark.value);

function onSystemThemeChange(event: MediaQueryListEvent) {
  systemIsDark.value = event.matches;
}

function toggleTheme() {
  const theme = isDark.value ? 'light' : 'dark';
  selectedTheme.value = theme;
  root.dataset.theme = theme;
  try {
    localStorage.setItem('somity_theme', theme);
  } catch {
    // The choice still applies to the current page when storage is unavailable.
  }
}

onMounted(() => systemTheme.addEventListener('change', onSystemThemeChange));
onUnmounted(() => systemTheme.removeEventListener('change', onSystemThemeChange));
</script>

<template>
  <button
    class="icon-button"
    type="button"
    :aria-label="t('Dark mode')"
    :aria-pressed="isDark"
    :title="t(isDark ? 'Switch to light mode' : 'Switch to dark mode')"
    @click="toggleTheme"
  >
    <Sun v-if="isDark" :size="19" aria-hidden="true" />
    <Moon v-else :size="19" aria-hidden="true" />
  </button>
</template>
