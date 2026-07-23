// Swaps the highlight.js code-block stylesheet to match the active app theme.
// Both themes target the same `.hljs` selectors, so only one can be live at a
// time — we keep a single <style> element and replace its contents on change.
import githubDark from 'highlight.js/styles/github-dark.css?inline'
import githubLight from 'highlight.js/styles/github.css?inline'

let styleEl: HTMLStyleElement | null = null

export function applyHljsTheme(theme: 'light' | 'dark') {
  if (typeof document === 'undefined') return
  if (!styleEl) {
    styleEl = document.createElement('style')
    styleEl.setAttribute('data-hljs-theme', '')
    document.head.appendChild(styleEl)
  }
  styleEl.textContent = theme === 'light' ? githubLight : githubDark
}
