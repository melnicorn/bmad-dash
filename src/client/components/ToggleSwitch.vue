<template>
  <label class="toggle" :class="{ on: modelValue }">
    <input
      class="toggle-input"
      type="checkbox"
      role="switch"
      :checked="modelValue"
      @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
    />
    <span class="toggle-track" aria-hidden="true"><span class="toggle-thumb" /></span>
    <span class="toggle-label"><slot /></span>
  </label>
</template>

<script setup lang="ts">
defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<style scoped>
.toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}

/* Real checkbox: kept in the a11y tree & focusable, visually hidden */
.toggle-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  margin: 0;
}

.toggle-track {
  position: relative;
  flex: none;
  width: 28px;
  height: 16px;
  border-radius: 999px;
  background: var(--bg-3);
  border: 1px solid var(--border);
  transition: background 0.18s, border-color 0.18s;
}

.toggle-thumb {
  position: absolute;
  top: 50%;
  left: 2px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--text-2);
  transform: translateY(-50%);
  transition: transform 0.18s cubic-bezier(0.4, 0, 0.2, 1), background 0.18s;
}

.toggle-label {
  font-size: 0.76rem;
  color: var(--text-2);
  transition: color 0.18s;
}

.toggle:hover .toggle-track { border-color: var(--border-hover); }
.toggle:hover .toggle-label { color: var(--text-1); }

.toggle.on .toggle-track { background: var(--accent-dim); border-color: var(--accent); }
.toggle.on .toggle-thumb { background: var(--accent); transform: translate(12px, -50%); }
.toggle.on .toggle-label { color: var(--text-1); }

.toggle-input:focus-visible + .toggle-track {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .toggle-track,
  .toggle-thumb,
  .toggle-label { transition: none; }
}
</style>
