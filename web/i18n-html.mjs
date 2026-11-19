import { readFileSync } from 'node:fs'

// HTML entry points share the same catalog as React and the legacy static page.
const escapeHTML = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
const catalogSource = () => readFileSync(new URL('./src/i18n.json', import.meta.url), 'utf8')

function localizeHTML(html) {
  const messages = JSON.parse(catalogSource())
  return html.replace(/\{\{i18n:([\w.-]+)\}\}/g, (_, key) => {
    if (!(key in messages)) throw new Error(`Missing i18n key: ${key}`)
    return escapeHTML(messages[key])
  })
}

const pptRedirectHTML = () => localizeHTML(readFileSync(new URL('./public/fastppt/index.html', import.meta.url), 'utf8'))

export default function i18nHTML() {
  return {
    name: 'fastresearch-html-copy',
    transformIndexHtml: localizeHTML,
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = req.url?.split('?')[0]
        if (pathname === '/i18n.json') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(catalogSource())
          return
        }
        if (pathname !== '/fastppt/' && pathname !== '/fastppt/index.html') return next()
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end(pptRedirectHTML())
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'i18n.json', source: catalogSource() })
      this.emitFile({ type: 'asset', fileName: 'fastppt/index.html', source: pptRedirectHTML() })
    },
  }
}
