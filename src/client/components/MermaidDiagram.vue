<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import svgPanZoomFactory from 'svg-pan-zoom'

// The bundled svg-pan-zoom types declare the module export as an `Instance`
// rather than the factory function it actually is at runtime.
const svgPanZoom = svgPanZoomFactory as unknown as (
  element: SVGElement,
  options?: SvgPanZoom.Options
) => SvgPanZoom.Instance

const props = defineProps<{ code: string }>()

const svg = ref('')
const error = ref('')
const viewportEl = ref<HTMLDivElement | null>(null)

let panZoom: SvgPanZoom.Instance | null = null

function destroyPanZoom() {
  panZoom?.destroy()
  panZoom = null
}

function setupPanZoom() {
  const svgEl = viewportEl.value?.querySelector('svg')
  if (!svgEl) return
  panZoom = svgPanZoom(svgEl, {
    minZoom: 0.5,
    maxZoom: 10,
    zoomScaleSensitivity: 0.25,
    fit: true,
    center: true
  })
}

function handleResize() {
  panZoom?.resize()
  panZoom?.fit()
  panZoom?.center()
}

function zoomIn() {
  panZoom?.zoomIn()
}
function zoomOut() {
  panZoom?.zoomOut()
}
function resetView() {
  panZoom?.resetZoom()
  panZoom?.resetPan()
  panZoom?.fit()
  panZoom?.center()
}

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
  destroyPanZoom()
  try {
    const mod = await loadMermaid()
    const id = `mermaid-${Math.random().toString(36).slice(2)}`
    const { svg: rendered } = await mod.default.render(id, props.code)
    if (token !== renderToken) return
    svg.value = rendered
    error.value = ''
    await nextTick()
    setupPanZoom()
  } catch (e) {
    if (token === renderToken) {
      svg.value = ''
      error.value = e instanceof Error ? e.message : String(e)
    }
  }
}

onMounted(() => {
  render()
  window.addEventListener('resize', handleResize)
})
watch(() => props.code, render)
onBeforeUnmount(() => {
  destroyPanZoom()
  window.removeEventListener('resize', handleResize)
})
</script>

<template>
  <div class="mermaid-diagram">
    <div v-if="error" class="mermaid-error">
      <strong>Mermaid diagram failed to render:</strong> {{ error }}
      <pre>{{ code }}</pre>
    </div>
    <template v-else>
      <div class="mermaid-toolbar">
        <button type="button" title="Zoom out" @click="zoomOut">&minus;</button>
        <button type="button" title="Reset view" @click="resetView">&#8862;</button>
        <button type="button" title="Zoom in" @click="zoomIn">+</button>
      </div>
      <div ref="viewportEl" class="mermaid-viewport" v-html="svg"></div>
    </template>
  </div>
</template>

<style scoped>
.mermaid-diagram {
  position: relative;
  margin-bottom: 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-1);
  overflow: hidden;
}

.mermaid-toolbar {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  z-index: 1;
  display: flex;
  gap: 0.25rem;
}
.mermaid-toolbar button {
  width: 1.6rem;
  height: 1.6rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-2);
  color: var(--text-1);
  font-family: var(--font-mono);
  font-size: 0.9rem;
  line-height: 1;
  cursor: pointer;
}
.mermaid-toolbar button:hover {
  background: var(--bg-3);
  border-color: var(--border-hover);
  color: var(--text-0);
}

.mermaid-viewport {
  height: 420px;
  cursor: grab;
}
.mermaid-viewport:active {
  cursor: grabbing;
}
.mermaid-viewport :deep(svg) {
  width: 100% !important;
  height: 100% !important;
  max-width: none !important;
  display: block;
}

.mermaid-error {
  font-size: 0.82rem;
  color: var(--text-2);
  padding: 1rem;
}
.mermaid-error pre {
  white-space: pre-wrap;
  margin-top: 0.5rem;
  font-family: var(--font-mono);
  font-size: 0.8rem;
  color: var(--text-3);
}
</style>
