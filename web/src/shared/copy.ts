import catalog from '../i18n.json'

export type Copy = (key: string, vars?: Record<string, string | number>) => string

// All editable frontend copy lives in web/src/i18n.json. Keep {{name}}
// placeholders intact; components supply their values when rendering.
const messages: Record<string, string> = catalog

export const text: Copy = (key, vars = {}) => (messages[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(vars[name] ?? `{{${name}}}`))
