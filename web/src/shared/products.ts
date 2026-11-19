import { text as t } from './copy'
import { BookOpenText,ChartNoAxesCombined,FlaskConical,Inbox,Layers,ListTodo,Microscope,Newspaper,PenLine,Presentation,ShieldCheck,type LucideIcon } from 'lucide-react'

export type Product = {
  id: string
  name: string
  category: string
  Icon: LucideIcon
  title: [string, string]
  description: string
  promise: string
  image?: string
  imageAlt?: string
  points: [string, string, string]
  steps: [string, string, string, string]
  features: { title: string; body: string }[]
  note: string
  tool?: string
  href?: string
}

export const products: Product[] = [
  {
    id: 'news', name: t('products.news.name'), category: t('products.news.category'), Icon: Newspaper,
    title: [t('products.news.title.1'), t('products.news.title.2')],
    description: t('products.news.description'),
    promise: t('products.news.promise'),
    image: 'promo/module-news-static.webp', imageAlt: t('products.news.imageAlt'),
    points: [t('products.news.points.1'), t('products.news.points.2'), t('products.news.points.3')], steps: [t('products.news.steps.1'), t('products.news.steps.2'), t('products.news.steps.3'), t('products.news.steps.4')], tool: 'fast-news',
    features: [
      { title: t('products.news.features.1.title'), body: t('products.news.features.1.body') },
      { title: t('products.news.features.2.title'), body: t('products.news.features.2.body') },
      { title: t('products.news.features.3.title'), body: t('products.news.features.3.body') },
    ], note: t('products.news.note'),
  },
  {
    id: 'read', name: t('products.read.name'), category: t('products.read.category'), Icon: BookOpenText,
    title: [t('products.read.title.1'), t('products.read.title.2')],
    description: t('products.read.description'),
    promise: t('products.read.promise'),
    image: 'promo/module-read-static.webp', imageAlt: t('products.read.imageAlt'),
    points: [t('products.read.points.1'), t('products.read.points.2'), t('products.read.points.3')], steps: [t('products.read.steps.1'), t('products.read.steps.2'), t('products.read.steps.3'), t('products.read.steps.4')], tool: 'fast-read',
    features: [
      { title: t('products.read.features.1.title'), body: t('products.read.features.1.body') },
      { title: t('products.read.features.2.title'), body: t('products.read.features.2.body') },
      { title: t('products.read.features.3.title'), body: t('products.read.features.3.body') },
    ], note: t('products.read.note'),
  },
  {
    id: 'write', name: t('products.write.name'), category: t('products.write.category'), Icon: PenLine,
    title: [t('products.write.title.1'), t('products.write.title.2')],
    description: t('products.write.description'),
    promise: t('products.write.promise'),
    image: 'promo/module-write-static.webp', imageAlt: t('products.write.imageAlt'),
    points: [t('products.write.points.1'), t('products.write.points.2'), t('products.write.points.3')], steps: [t('products.write.steps.1'), t('products.write.steps.2'), t('products.write.steps.3'), t('products.write.steps.4')], tool: 'fast-write',
    features: [
      { title: t('products.write.features.1.title'), body: t('products.write.features.1.body') },
      { title: t('products.write.features.2.title'), body: t('products.write.features.2.body') },
      { title: t('products.write.features.3.title'), body: t('products.write.features.3.body') },
    ], note: t('products.write.note'),
  },
  {
    id: 'ppt', name: t('products.ppt.name'), category: t('products.ppt.category'), Icon: Presentation,
    title: [t('products.ppt.title.1'), t('products.ppt.title.2')],
    description: t('products.ppt.description'),
    promise: t('products.ppt.promise'),
    image: 'fastppt/assets/government/slide-06.webp', imageAlt: t('products.ppt.imageAlt'),
    points: [t('products.ppt.points.1'), t('products.ppt.points.2'), t('products.ppt.points.3')], steps: [t('products.ppt.steps.1'), t('products.ppt.steps.2'), t('products.ppt.steps.3'), t('products.ppt.steps.4')], tool: 'fast-ppt',
    features: [
      { title: t('products.ppt.features.1.title'), body: t('products.ppt.features.1.body') },
      { title: t('products.ppt.features.2.title'), body: t('products.ppt.features.2.body') },
      { title: t('products.ppt.features.3.title'), body: t('products.ppt.features.3.body') },
    ], note: t('products.ppt.note'),
  },
  {
    id: 'lab', name: t('products.lab.name'), category: t('products.lab.category'), Icon: Microscope,
    title: [t('products.lab.title.1'), t('products.lab.title.2')],
    description: t('products.lab.description'),
    promise: t('products.lab.promise'),
    points: [t('products.lab.points.1'), t('products.lab.points.2'), t('products.lab.points.3')], steps: [t('products.lab.steps.1'), t('products.lab.steps.2'), t('products.lab.steps.3'), t('products.lab.steps.4')], tool: 'fast-lab',
    features: [
      { title: t('products.lab.features.1.title'), body: t('products.lab.features.1.body') },
      { title: t('products.lab.features.2.title'), body: t('products.lab.features.2.body') },
      { title: t('products.lab.features.3.title'), body: t('products.lab.features.3.body') },
    ], note: t('products.lab.note'),
  },
  {
    id: 'task', name: t('products.task.name'), category: t('products.task.category'), Icon: ListTodo,
    title: [t('products.task.title.1'), t('products.task.title.2')],
    description: t('products.task.description'),
    promise: t('products.task.promise'),
    points: [t('products.task.points.1'), t('products.task.points.2'), t('products.task.points.3')], steps: [t('products.task.steps.1'), t('products.task.steps.2'), t('products.task.steps.3'), t('products.task.steps.4')], href: '/api/workspace/apps/fast-task/launch',
    features: [
      { title: t('products.task.features.1.title'), body: t('products.task.features.1.body') },
      { title: t('products.task.features.2.title'), body: t('products.task.features.2.body') },
      { title: t('products.task.features.3.title'), body: t('products.task.features.3.body') },
    ], note: t('products.task.note'),
  },
  {
    id: 'insight', name: t('products.insight.name'), category: t('products.insight.category'), Icon: Inbox,
    title: [t('products.insight.title.1'), t('products.insight.title.2')],
    description: t('products.insight.description'),
    promise: t('products.insight.promise'),
    image: 'promo/insight.webp', imageAlt: t('products.insight.imageAlt'),
    points: [t('products.insight.points.1'), t('products.insight.points.2'), t('products.insight.points.3')], steps: [t('products.insight.steps.1'), t('products.insight.steps.2'), t('products.insight.steps.3'), t('products.insight.steps.4')],
    features: [
      { title: t('products.insight.features.1.title'), body: t('products.insight.features.1.body') },
      { title: t('products.insight.features.2.title'), body: t('products.insight.features.2.body') },
      { title: t('products.insight.features.3.title'), body: t('products.insight.features.3.body') },
    ], note: t('products.insight.note'),
  },
  {
    id: 'figure', name: t('products.figure.name'), category: t('products.figure.category'), Icon: ChartNoAxesCombined,
    title: [t('products.figure.title.1'), t('products.figure.title.2')],
    description: t('products.figure.description'),
    promise: t('products.figure.promise'),
    points: [t('products.figure.points.1'), t('products.figure.points.2'), t('products.figure.points.3')], href: import.meta.env.VITE_FASTFIGURE_URL || 'https://figure.fastrd.io/', steps: [t('products.figure.steps.1'), t('products.figure.steps.2'), t('products.figure.steps.3'), t('products.figure.steps.4')],
    features: [
      { title: t('products.figure.features.1.title'), body: t('products.figure.features.1.body') },
      { title: t('products.figure.features.2.title'), body: t('products.figure.features.2.body') },
      { title: t('products.figure.features.3.title'), body: t('products.figure.features.3.body') },
    ], note: t('products.figure.note'),
  },
  {
    id: 'cas', name: t('products.cas.name'), category: t('products.cas.category'), Icon: ShieldCheck,
    title: [t('products.cas.title.1'), t('products.cas.title.2')],
    description: t('products.cas.description'),
    promise: t('products.cas.promise'),
    points: [t('products.cas.points.1'), t('products.cas.points.2'), t('products.cas.points.3')], steps: [t('products.cas.steps.1'), t('products.cas.steps.2'), t('products.cas.steps.3'), t('products.cas.steps.4')],
    features: [
      { title: t('products.cas.features.1.title'), body: t('products.cas.features.1.body') },
      { title: t('products.cas.features.2.title'), body: t('products.cas.features.2.body') },
      { title: t('products.cas.features.3.title'), body: t('products.cas.features.3.body') },
    ], note: t('products.cas.note'),
  },
  {
    id: 'ui', name: t('products.ui.name'), category: t('products.ui.category'), Icon: Layers,
    title: [t('products.ui.title.1'), t('products.ui.title.2')],
    description: t('products.ui.description'),
    promise: t('products.ui.promise'),
    points: [t('products.ui.points.1'), t('products.ui.points.2'), t('products.ui.points.3')], steps: [t('products.ui.steps.1'), t('products.ui.steps.2'), t('products.ui.steps.3'), t('products.ui.steps.4')], href: 'https://fastr-d.github.io/FastUI/',
    features: [
      { title: t('products.ui.features.1.title'), body: t('products.ui.features.1.body') },
      { title: t('products.ui.features.2.title'), body: t('products.ui.features.2.body') },
      { title: t('products.ui.features.3.title'), body: t('products.ui.features.3.body') },
    ], note: t('products.ui.note'),
  },
]

export const productHref = (id: string) => `${import.meta.env.BASE_URL}intro/${id}`
export const workspaceHref = `${import.meta.env.BASE_URL}workspace`
export function launchHref(product: Product) {
  if (product.href) return product.href.startsWith('/') ? `${(import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')}${product.href}` : product.href
  if (product.tool) return `${workspaceHref}?tool=${product.tool}`
  return `${workspaceHref}${product.id === 'insight' ? '?view=insight' : ''}`
}
export const ResearchIcon = FlaskConical
