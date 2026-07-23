<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'

const props = defineProps<{ code: string }>()

const svg = ref('')
const error = ref('')

let mermaidPromise: Promise<typeof import('mermaid')> | null = null

function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((mod) => {
      mod.default.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        fontFamily: 'JetBrains Mono, monospace',
        themeVariables: {
          background: '#0e1015',
          primaryColor: '#151820',
          primaryTextColor: '#f0f2f5',
          primaryBorderColor: '#3a4155',
          lineColor: '#7c849a',
          secondaryColor: '#1c2029',
          tertiaryColor: '#151820',
          textColor: '#c1c7d4',
          mainBkg: '#151820',
          nodeBorder: '#3a4155',
          clusterBkg: '#0e1015',
          clusterBorder: '#252a35',
          edgeLabelBackground: '#0e1015',
          fontFamily: 'JetBrains Mono, monospace'
        }
      })
      return mod
    })
  }
  return mermaidPromise
}

let renderToken = 0

async function render() {
  const token = ++renderToken
  try {
    const mod = await loadMermaid()
    const id = `mermaid-${Math.random().toString(36).slice(2)}`
    const { svg: rendered } = await mod.default.render(id, props.code)
    if (token === renderToken) {
      svg.value = rendered
      error.value = ''
    }
  } catch (e) {
    if (token === renderToken) {
      svg.value = ''
      error.value = e instanceof Error ? e.message : String(e)
    }
  }
}

onMounted(render)
watch(() => props.code, render)
</script>

<template>
  <div class="mermaid-diagram">
    <div v-if="error" class="mermaid-error">
      <strong>Mermaid diagram failed to render:</strong> {{ error }}
      <pre>{{ code }}</pre>
    </div>
    <div v-else class="mermaid-svg" v-html="svg"></div>
  </div>
</template>

<style scoped>
.mermaid-diagram {
  margin-bottom: 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1rem;
  overflow-x: auto;
  background: var(--bg-1);
}
.mermaid-svg {
  display: flex;
  justify-content: center;
}
.mermaid-svg :deep(svg) {
  max-width: 100%;
  height: auto;
}
.mermaid-error {
  font-size: 0.82rem;
  color: var(--text-2);
}
.mermaid-error pre {
  white-space: pre-wrap;
  margin-top: 0.5rem;
  font-family: var(--font-mono);
  font-size: 0.8rem;
  color: var(--text-3);
}
</style>
