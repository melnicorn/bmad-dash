<script setup lang="ts">
import { Sun, Moon, Monitor } from '@lucide/vue'
import { useThemeStore, type ThemePreference } from '../stores/theme'

const theme = useThemeStore()

const options: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]
</script>

<template>
  <div class="theme-toggle" role="radiogroup" aria-label="Color theme">
    <button
      v-for="o in options"
      :key="o.value"
      class="theme-opt"
      :class="{ active: theme.preference === o.value }"
      role="radio"
      :aria-checked="theme.preference === o.value"
      :title="`${o.label} theme`"
      @click="theme.setPreference(o.value)"
    >
      <component :is="o.icon" :size="15" :stroke-width="2" />
      <span class="sr-only">{{ o.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.theme-toggle {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.theme-opt {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 22px;
  border: none;
  background: none;
  border-radius: 4px;
  color: var(--text-2);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.theme-opt:hover { color: var(--text-0); }
.theme-opt.active {
  background: var(--bg-0);
  color: var(--accent);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
</style>
