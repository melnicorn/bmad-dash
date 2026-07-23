import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router/index'
import { useProjectStore } from './stores/project'
import { useThemeStore } from './stores/theme'
import './style.css'

// ─── App Bootstrap ───
const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)

// ─── Theme ───
// Reconcile the persisted preference with the DOM (the index.html inline script
// set an initial data-theme to avoid a flash) and start live OS-scheme tracking.
useThemeStore().init()

// ─── Data Hydration ───
// Production: Express injects window.__INITIAL_DATA__ before </head>
// Dev: Vite serves index.html directly — no Express injection — fall back to API
const store = useProjectStore()
const raw = (window as any).__INITIAL_DATA__
if (raw) {
  store.setProject(raw)
} else {
  fetch('/api/project')
    .then((r) => r.json())
    .then((data) => store.setProject(data))
    .catch((err) => console.error('[bmad] Failed to fetch project data:', err))
}

// ─── Realtime Updates ───
function connectSSE() {
  const es = new EventSource('/api/updates')
  es.onmessage = (event) => {
    try {
      store.setProject(JSON.parse(event.data))
    } catch (err) {
      console.error('[bmad] SSE parse error:', err)
    }
  }
}
connectSSE()

app.mount('#app')
