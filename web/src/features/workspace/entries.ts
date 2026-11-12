import { BookOpenText,FlaskConical,Layers,Newspaper,PenLine } from 'lucide-react'
import { type Copy } from '../../shared/copy'
import type { Entry,EntryId } from '../../shared/types'
export const MODULE_HUB_ORDER: EntryId[] = ['fast-news', 'fast-read', 'fast-write', 'fast-ppt', 'fast-lab']
const ENTRY_CONFIG: Record<EntryId, { nameKey: string; labelKey: string; descriptionKey: string; Icon: typeof BookOpenText; url?: string; tone: string }> = {
  'fast-write': { nameKey: 'entry.fast-write.name', labelKey: 'entry.fast-write.label', descriptionKey: 'entry.fast-write.description', Icon: PenLine, url: import.meta.env.VITE_WRITE_URL || 'http://127.0.0.1:3003', tone: 'blue' },
  'fast-read': { nameKey: 'entry.fast-read.name', labelKey: 'entry.fast-read.label', descriptionKey: 'entry.fast-read.description', Icon: BookOpenText, url: import.meta.env.VITE_READ_URL || 'http://127.0.0.1:3015', tone: 'blue' },
  'fast-news': { nameKey: 'entry.fast-news.name', labelKey: 'entry.fast-news.label', descriptionKey: 'entry.fast-news.description', Icon: Newspaper, url: import.meta.env.VITE_FASTNEWS_URL || 'http://127.0.0.1:4173', tone: 'blue' },
  'fast-ppt': { nameKey: 'entry.fast-ppt.name', labelKey: 'entry.fast-ppt.label', descriptionKey: 'entry.fast-ppt.description', Icon: Layers, url: import.meta.env.VITE_FASTPPT_URL, tone: 'blue' },
  'fast-lab': { nameKey: 'entry.fast-lab.name', labelKey: 'entry.fast-lab.label', descriptionKey: 'entry.fast-lab.description', Icon: FlaskConical, url: import.meta.env.VITE_FASTLAB_URL, tone: 'blue' },
}
export function createEntries(t: Copy): Record<EntryId, Entry> {
  return Object.fromEntries(Object.entries(ENTRY_CONFIG).map(([id, config]) => [id, { id: id as EntryId, name: t(config.nameKey), label: t(config.labelKey), description: t(config.descriptionKey), Icon: config.Icon, url: config.url, tone: config.tone }])) as Record<EntryId, Entry>
}
