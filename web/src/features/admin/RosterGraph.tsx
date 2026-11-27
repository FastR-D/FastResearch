import { Badge, Button, PanelHeader, Section } from '@fastrd/ui-react'
import { Circle, Plus } from 'lucide-react'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent, ReactNode } from 'react'
import type { Copy } from '../../shared/copy'
import type { FastInsightRoster } from '../../shared/types'

export type RosterNode = { kind: 'keyword' | 'direction' | 'member'; id: string }
export const DEFAULT = '__default__'
export type RosterEdge = { from: RosterNode; to: RosterNode; label: string; fixed?: boolean }
const nodeKey = (node: RosterNode) => JSON.stringify([node.kind, node.id])
const curve = (a: Point, b: Point) => `M ${a.x} ${a.y} C ${(a.x + b.x) / 2} ${a.y}, ${(a.x + b.x) / 2} ${b.y}, ${b.x} ${b.y}`
type Point = { x: number; y: number }
type Line = { edge: RosterEdge; start: Point; end: Point }

export function RosterGraph({ roster, disabled, onEdit, onAdd, onConnect, onRemove, t }: {
  roster: FastInsightRoster; disabled: boolean; onEdit: (node: RosterNode) => void
  onAdd: (kind: RosterNode['kind']) => void; onConnect: (a: RosterNode, b: RosterNode) => void
  onRemove: (edge: RosterEdge) => void; t: Copy
}) {
  const canvas = useRef<HTMLDivElement>(null)
  const nodes = useRef(new Map<string, HTMLDivElement>())
  const [lines, setLines] = useState<Line[]>([])
  const [source, setSource] = useState<RosterNode | null>(null)
  const [preview, setPreview] = useState<{ start: Point; end: Point } | null>(null)
  const drag = useRef<{ node: RosterNode; x: number; y: number; moved: boolean } | null>(null)
  const measure = useCallback(() => {
    const root = canvas.current?.getBoundingClientRect()
    if (!root) return
    const edges: RosterEdge[] = [{ from: { kind: 'keyword', id: DEFAULT }, to: { kind: 'direction', id: DEFAULT }, label: t('routing.defaultRule'), fixed: true }]
    for (const d of roster.directions) {
      for (const k of d.keywords) edges.push({ from: { kind: 'keyword', id: k }, to: { kind: 'direction', id: d.id }, label: `${k} → ${d.name}` })
      for (const m of d.owners) edges.push({ from: { kind: 'direction', id: d.id }, to: { kind: 'member', id: m.id }, label: `${d.name} → ${m.name}` })
    }
    if (roster.default_owner) edges.push({ from: { kind: 'direction', id: DEFAULT }, to: { kind: 'member', id: roster.default_owner.id }, label: `${t('routing.defaultRule')} → ${roster.default_owner.name}` })
    const next: Line[] = []
    for (const edge of edges) {
      const a = nodes.current.get(nodeKey(edge.from)), b = nodes.current.get(nodeKey(edge.to))
      if (!a || !b) continue
      const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect()
      const av = a.parentElement!.getBoundingClientRect(), bv = b.parentElement!.getBoundingClientRect()
      const ay = ar.top + ar.height / 2, by = br.top + br.height / 2
      if (ay < av.top || ay > av.bottom || by < bv.top || by > bv.bottom) continue
      const ap = a.querySelectorAll<HTMLButtonElement>('button[data-node]')
      const bp = b.querySelectorAll<HTMLButtonElement>('button[data-node]')
      const sourcePort = ap[ap.length - 1]?.getBoundingClientRect(), targetPort = bp[0]?.getBoundingClientRect()
      if (!sourcePort || !targetPort) continue
      next.push({ edge,
        start: { x: sourcePort.left + sourcePort.width / 2 + 6 - root.left, y: ay - root.top },
        end: { x: targetPort.left + targetPort.width / 2 - 6 - root.left, y: by - root.top },
      })
    }
    setLines(next)
  }, [roster, t])
  useLayoutEffect(() => {
    measure()
    const observer = new ResizeObserver(measure)
    if (canvas.current) {
      observer.observe(canvas.current)
      for (const node of nodes.current.values()) observer.observe(node)
    }
    window.addEventListener('resize', measure)
    return () => { observer.disconnect(); window.removeEventListener('resize', measure) }
  }, [measure])

  const port = (node: RosterNode, side: 'left' | 'right', label: string) => <Button variant="icon" className="relative z-20 shrink-0 touch-none" disabled={disabled}
    aria-label={t('routing.connectNode', { name: label })} aria-pressed={source && nodeKey(source) === nodeKey(node) || false}
    data-node={nodeKey(node)}
    onPointerDown={event => {
      if (event.button !== 0) return
      drag.current = { node, x: event.clientX, y: event.clientY, moved: false }
      event.currentTarget.setPointerCapture(event.pointerId)
    }}
    onPointerMove={(event: PointerEvent<HTMLButtonElement>) => {
      const d = drag.current, root = canvas.current?.getBoundingClientRect()
      if (!d || !root) return
      if (Math.hypot(event.clientX - d.x, event.clientY - d.y) > 5) d.moved = true
      if (d.moved) setPreview({ start: { x: d.x - root.left, y: d.y - root.top }, end: { x: event.clientX - root.left, y: event.clientY - root.top } })
    }}
    onPointerUp={event => {
      const d = drag.current
      drag.current = null; setPreview(null)
      if (!d?.moved) return
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-node]')
      if (target?.dataset.node) {
        const [kind, id] = JSON.parse(target.dataset.node) as [RosterNode['kind'], string]
        onConnect(d.node, { kind, id })
      }
      setSource(null)
      // A drag also emits click; consume it before the keyboard/click fallback.
      suppressClick.current = true
    }}
    onPointerCancel={() => { drag.current = null; setPreview(null); setSource(null) }}
    onClick={() => {
      if (suppressClick.current) { suppressClick.current = false; return }
      if (source) { onConnect(source, node); setSource(null) } else setSource(node)
    }}><Circle size={12} fill={source && nodeKey(source) === nodeKey(node) ? 'currentColor' : 'none'} aria-hidden="true" /><span className="sr-only">{side}</span></Button>
  const suppressClick = useRef(false)
  const row = (node: RosterNode, label: string, detail?: ReactNode) => <div key={nodeKey(node)} data-node={nodeKey(node)}
    ref={el => { if (el) nodes.current.set(nodeKey(node), el); else nodes.current.delete(nodeKey(node)) }}
    className="flex items-center gap-1 min-w-0 h-10" data-fastui-density="compact">
    {node.kind !== 'keyword' && port(node, 'left', label)}
    <Button variant="quiet" size="xs" title={label} className="relative z-20 flex-1 min-w-0" onClick={() => onEdit(node)} disabled={disabled}>
      <span className="flex w-full min-w-0 flex-col items-start text-left"><span className="max-w-full truncate">{label}</span>{detail && <small className="max-w-full truncate text-xs">{detail}</small>}</span>
    </Button>
    {node.kind !== 'member' && port(node, 'right', label)}
  </div>
  const column = (kind: RosterNode['kind'], title: string, count: number, children: ReactNode) => <Section className="flex flex-col min-w-0 overflow-hidden">
    <PanelHeader><div className="flex w-full items-center justify-between gap-2"><h3 className="text-sm">{title} <Badge>{count}</Badge></h3><Button variant="icon" aria-label={t(`routing.add.${kind}`)} onClick={() => onAdd(kind)} disabled={disabled}><Plus size={15} /></Button></div></PanelHeader>
    <div role="region" aria-label={title} tabIndex={0} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1" data-roster-column={kind}>{children}</div>
  </Section>
  return <div className="grid gap-2" onKeyDown={event => { if (event.key === 'Escape') { setSource(null); setPreview(null); drag.current = null } }}>
    <p className="text-xs" aria-live="polite">{source ? t('routing.connectNext') : t('routing.graphHint')}</p>
    <div className="overflow-x-auto max-w-full">
      <div ref={canvas} onScrollCapture={measure} className="relative grid grid-cols-3 gap-10 min-w-160 h-[min(60vh,640px)] min-h-64" data-fastui-density="compact">
        <svg className="absolute inset-0 w-full h-full pointer-events-none z-10 overflow-hidden" aria-label={t('routing.relationships')}>
          {lines.map(({ edge, start, end }) => <g key={`${nodeKey(edge.from)}:${nodeKey(edge.to)}`}>
            <path d={curve(start, end)} fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.35" />
            {!edge.fixed && <path d={curve(start, end)} fill="none" stroke="transparent" strokeWidth="12" className="pointer-events-auto cursor-pointer"
              role="button" tabIndex={disabled ? -1 : 0} aria-label={t('routing.removeLink', { name: edge.label })}
              onClick={() => { if (!disabled) onRemove(edge) }} onKeyDown={event => { if (!disabled && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onRemove(edge) } }}><title>{t('routing.removeLink', { name: edge.label })}</title></path>}
          </g>)}
          {preview && <path d={curve(preview.start, preview.end)} fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" />}
        </svg>
        {column('keyword', t('routing.keywordCount'), roster.keywords.length, <>
          {row({ kind: 'keyword', id: DEFAULT }, t('routing.defaultKeyword'), t('routing.noMatch'))}
          {roster.keywords.map(k => row({ kind: 'keyword', id: k }, k))}
        </>)}
        {column('direction', t('routing.directionCount'), roster.directions.length, <>
          {row({ kind: 'direction', id: DEFAULT }, t('routing.defaultRule'))}
          {roster.directions.map(d => row({ kind: 'direction', id: d.id }, d.name, t('routing.directionMeta', { keywords: d.keywords.length, members: d.owners.length })))}
        </>)}
        {column('member', t('routing.ownerCount'), roster.members.length, <>
          {roster.members.map(m => row({ kind: 'member', id: m.id }, m.name, roster.default_owner?.id === m.id ? t('routing.defaultOwner') : undefined))}
          {!roster.members.length && <p className="p-3 text-xs">{t('routing.emptyMembers')}</p>}
        </>)}
      </div>
    </div>
  </div>
}
