<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import svgPanZoomFactory from 'svg-pan-zoom'
import { storeToRefs } from 'pinia'
import { useThemeStore } from '../stores/theme'

// The bundled svg-pan-zoom types declare the module export as an `Instance`
// rather than the factory function it actually is at runtime.
const svgPanZoom = svgPanZoomFactory as unknown as (
  element: SVGElement,
  options?: SvgPanZoom.Options
) => SvgPanZoom.Instance

const props = defineProps<{ code: string }>()

const { resolved: resolvedTheme } = storeToRefs(useThemeStore())

const svg = ref('')
const error = ref('')
const containerEl = ref<HTMLDivElement | null>(null)
const viewportEl = ref<HTMLDivElement | null>(null)
const expanded = ref(false)
const isFullscreen = ref(false)

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

// "Expand" grows the diagram in place (a fixed-position overlay); "fullscreen"
// hands the container to the browser's native Fullscreen API. Only one at a time.
function toggleExpand() {
  if (isFullscreen.value) return
  expanded.value = !expanded.value
  document.body.style.overflow = expanded.value ? 'hidden' : ''
  nextTick(handleResize)
}

async function togglePopout() {
  if (!containerEl.value) return
  if (document.fullscreenElement) {
    await document.exitFullscreen()
    return
  }
  if (expanded.value) {
    expanded.value = false
    document.body.style.overflow = ''
    await nextTick()
    handleResize()
  }
  try {
    await containerEl.value.requestFullscreen()
  } catch {
    // Fullscreen can be denied (embedded iframe, permissions policy, etc.) — the
    // diagram already fell back to its normal inline layout above.
  }
}

function onFullscreenChange() {
  isFullscreen.value = document.fullscreenElement === containerEl.value
  nextTick(handleResize)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && expanded.value) toggleExpand()
}

// Mermaid can't read CSS variables, so we mirror the app palette here per theme
// and re-initialize on each render to follow light/dark mode.
const MERMAID_THEME_VARS = {
  dark: {
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
  },
  light: {
    background: '#ffffff',
    primaryColor: '#eef0f4',
    primaryTextColor: '#1a1d24',
    primaryBorderColor: '#b6bdcc',
    lineColor: '#6a7285',
    secondaryColor: '#e3e6ec',
    tertiaryColor: '#f7f8fa',
    textColor: '#3a4051',
    mainBkg: '#eef0f4',
    nodeBorder: '#b6bdcc',
    clusterBkg: '#f7f8fa',
    clusterBorder: '#d5d9e2',
    edgeLabelBackground: '#ffffff',
    fontFamily: 'JetBrains Mono, monospace'
  }
} as const

let mermaidPromise: Promise<typeof import('mermaid')> | null = null

function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid')
  }
  return mermaidPromise.then((mod) => {
    mod.default.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      fontFamily: 'JetBrains Mono, monospace',
      themeVariables: MERMAID_THEME_VARS[resolvedTheme.value]
    })
    return mod
  })
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
  window.addEventListener('keydown', onKeydown)
  document.addEventListener('fullscreenchange', onFullscreenChange)
})
watch(() => props.code, render)
// Re-render with the matching palette when the theme changes.
watch(resolvedTheme, render)
onBeforeUnmount(() => {
  destroyPanZoom()
  window.removeEventListener('resize', handleResize)
  window.removeEventListener('keydown', onKeydown)
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  if (expanded.value) document.body.style.overflow = ''
})
</script>

<template>
  <div v-if="expanded" class="mermaid-backdrop" @click="toggleExpand"></div>
  <div
    ref="containerEl"
    class="mermaid-diagram"
    :class="{ 'is-expanded': expanded }"
  >
    <div v-if="error" class="mermaid-error">
      <strong>Mermaid diagram failed to render:</strong> {{ error }}
      <pre>{{ code }}</pre>
    </div>
    <template v-else>
      <div class="mermaid-toolbar">
        <button type="button" title="Zoom out" @click="zoomOut">&minus;</button>
        <button type="button" title="Reset view" @click="resetView">&#8862;</button>
        <button type="button" title="Zoom in" @click="zoomIn">+</button>
        <button
          type="button"
          class="icon-btn"
          :title="expanded ? 'Exit expanded view' : 'Expand'"
          @click="toggleExpand"
        >
          <svg v-if="expanded" viewBox="0 0 16 16" width="11" height="11">
            <path
              d="M3 3l10 10M13 3L3 13"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
            />
          </svg>
          <svg v-else viewBox="0 0 16 16" width="11" height="11">
            <path
              d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"
              fill="none"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          class="icon-btn"
          :title="isFullscreen ? 'Exit fullscreen' : 'Fullscreen'"
          @click="togglePopout"
        >
          <svg v-if="isFullscreen" viewBox="0 0 16 16" width="11" height="11">
            <path
              d="M2 2l4 4M14 2l-4 4M2 14l4-4M14 14l-4-4"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
            />
          </svg>
          <svg v-else viewBox="0 0 16 16" width="11" height="11">
            <path
              d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"
              fill="none"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-dasharray="2 2"
            />
          </svg>
        </button>
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
.mermaid-diagram.is-expanded {
  position: fixed;
  inset: 2rem;
  z-index: 200;
  margin-bottom: 0;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
}
.mermaid-diagram:fullscreen {
  border-radius: 0;
}

.mermaid-backdrop {
  position: fixed;
  inset: 0;
  z-index: 199;
  background: rgba(0, 0, 0, 0.6);
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
.mermaid-diagram.is-expanded .mermaid-viewport,
.mermaid-diagram:fullscreen .mermaid-viewport {
  height: 100%;
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
