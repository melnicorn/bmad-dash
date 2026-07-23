import { defineStore } from 'pinia'
import { applyHljsTheme } from '../utils/hljs-theme'

// ─── Theme preference ───
// Tri-state light/dark/system preference, persisted to localStorage. "system"
// tracks the OS color scheme live. The resolved theme (always light or dark) is
// mirrored onto <html data-theme> so CSS variables in style.css switch palettes,
// and pushed to the highlight.js code-block stylesheet.

export type ThemePreference = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'bmad-dash.theme'

function load(): ThemePreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw
  } catch { /* ignore */ }
  return 'system'
}

const media = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : null

function systemPrefersDark(): boolean {
  return media ? media.matches : true
}

export const useThemeStore = defineStore('theme', {
  state: () => ({
    preference: load() as ThemePreference,
    systemDark: systemPrefersDark(),
  }),
  getters: {
    // The concrete theme actually rendered (light | dark).
    resolved: (s): 'light' | 'dark' =>
      s.preference === 'system' ? (s.systemDark ? 'dark' : 'light') : s.preference,
  },
  actions: {
    setPreference(pref: ThemePreference) {
      this.preference = pref
      try { localStorage.setItem(STORAGE_KEY, pref) } catch { /* ignore */ }
      this.apply()
    },
    // Reflect the resolved theme into the DOM and dependent stylesheets.
    apply() {
      const theme = this.resolved
      document.documentElement.dataset.theme = theme
      applyHljsTheme(theme)
    },
    // Wire up live OS-scheme tracking; call once at bootstrap.
    init() {
      if (media) {
        media.addEventListener('change', (e) => {
          this.systemDark = e.matches
          if (this.preference === 'system') this.apply()
        })
      }
      this.apply()
    },
  },
})
