import { marked } from 'marked'
import { markedHighlight } from 'marked-highlight'
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import bash from 'highlight.js/lib/languages/bash'
import json from 'highlight.js/lib/languages/json'
import css from 'highlight.js/lib/languages/css'
import xml from 'highlight.js/lib/languages/xml'
import python from 'highlight.js/lib/languages/python'
import 'highlight.js/styles/github-dark.css'

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('js', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('ts', typescript)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('sh', bash)
hljs.registerLanguage('json', json)
hljs.registerLanguage('css', css)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('python', python)

marked.use(markedHighlight({
  langPrefix: 'hljs language-',
  highlight(code, lang) {
    if (hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value
    }
    return code
  }
}))

export function renderMarkdown(text: string): string {
  return marked(text, { gfm: true, breaks: false }) as string
}

/**
 * Pull ```mermaid fenced blocks out of the raw markdown before it hits `marked`.
 * Mermaid syntax (`-->`, `<br/>`, `<|--`, ...) would otherwise get mangled by
 * marked's HTML-escaping/highlighting pipeline. Each block is replaced with an
 * HTML placeholder div that marked/GFM passes through untouched as a raw HTML
 * block, to be swapped for a rendered diagram after `renderMarkdown` runs.
 */
export function extractMermaidBlocks(text: string): { text: string; blocks: string[] } {
  const blocks: string[] = []
  const stripped = text.replace(/```mermaid[ \t]*\r?\n([\s\S]*?)\r?\n?```/g, (_match, code: string) => {
    const idx = blocks.length
    blocks.push(code)
    return `\n<div data-mermaid-idx="${idx}"></div>\n`
  })
  return { text: stripped, blocks }
}
