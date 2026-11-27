import { Alert, Button, Checkbox, TextField } from '@fastrd/ui-react'
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Dialog } from '../../shared/ui/Dialog'
import type { Copy } from '../../shared/copy'
import type { FastInsightRoster } from '../../shared/types'
import { DEFAULT, type RosterNode } from './RosterGraph'

const toggle = (values: string[], value: string) => values.includes(value) ? values.filter(v => v !== value) : [...values, value]
export function RosterNodeDialog({ node, roster, onApply, onClose, t }: {
  node: RosterNode; roster: FastInsightRoster; onApply: (roster: FastInsightRoster) => void; onClose: () => void; t: Copy
}) {
  const isDefault = node.id === DEFAULT
  const direction = roster.directions.find(d => d.id === node.id)
  const member = roster.members.find(m => m.id === node.id)
  const [name, setName] = useState(node.kind === 'keyword' ? node.id : node.kind === 'member' ? member?.name ?? '' : direction?.name ?? '')
  const [feishu, setFeishu] = useState(member?.feishu_open_id ?? '')
  const [receiver, setReceiver] = useState(member?.receiver_ref ?? '')
  const [priority, setPriority] = useState(direction?.priority ?? 0)
  const [keywords, setKeywords] = useState(direction?.keywords ?? [])
  const [members, setMembers] = useState(isDefault ? roster.default_owner ? [roster.default_owner.id] : [] : direction?.owners.map(m => m.id) ?? [])
  const [directions, setDirections] = useState(roster.directions.filter(d => node.kind === 'keyword' ? d.keywords.includes(node.id) : d.owners.some(m => m.id === node.id)).map(d => d.id))
  const [defaultOwner, setDefaultOwner] = useState(Boolean(member && roster.default_owner?.id === member.id))
  const [error, setError] = useState('')
  const existing = Boolean(node.id)
  const tags = (options: { id: string; label: string }[], values: string[], onChange: (values: string[]) => void, single = false) => <div className="flex flex-wrap gap-2">
    {options.map(option => <label key={option.id} className="fastui-badge flex items-center gap-2 cursor-pointer"><Checkbox checked={values.includes(option.id)} onChange={() => onChange(single ? values.includes(option.id) ? [] : [option.id] : toggle(values, option.id))} />{option.label}</label>)}
    {!options.length && <p className="text-xs">{t('routing.noTags')}</p>}
  </div>
  const apply = (event: FormEvent) => {
    event.preventDefault()
    const value = name.trim()
    if (!isDefault && (!value || (node.kind === 'keyword' && value === DEFAULT))) { setError(t('routing.invalidName')); return }
    if (node.kind === 'keyword' && !isDefault && roster.keywords.some(k => k === value && k !== node.id) || node.kind === 'direction' && !isDefault && roster.directions.some(d => d.name === value && d.id !== node.id)) { setError(t('routing.duplicateName')); return }
    const next = structuredClone(roster)
    if (isDefault) {
      next.default_owner = next.members.find(m => m.id === members[0])
    } else if (node.kind === 'keyword') {
      next.keywords = existing ? next.keywords.map(k => k === node.id ? value : k) : [...next.keywords, value]
      next.directions = next.directions.map(d => ({ ...d, keywords: [...d.keywords.filter(k => k !== node.id), ...(directions.includes(d.id) ? [value] : [])] }))
    } else if (node.kind === 'direction') {
      const updated = { id: node.id || crypto.randomUUID(), name: value, priority, keywords, owners: next.members.filter(m => members.includes(m.id)) }
      next.directions = existing ? next.directions.map(d => d.id === node.id ? updated : d) : [...next.directions, updated]
    } else {
      const updated = { id: node.id || crypto.randomUUID(), name: value, feishu_open_id: feishu.trim(), receiver_ref: receiver.trim() }
      next.members = existing ? next.members.map(m => m.id === node.id ? updated : m) : [...next.members, updated]
      next.directions = next.directions.map(d => ({ ...d, owners: [...d.owners.filter(m => m.id !== node.id), ...(directions.includes(d.id) ? [updated] : [])] }))
      if (defaultOwner) next.default_owner = updated
      else if (next.default_owner?.id === node.id) delete next.default_owner
    }
    onApply(next)
  }
  const remove = () => {
    const next = structuredClone(roster)
    if (node.kind === 'keyword') { next.keywords = next.keywords.filter(k => k !== node.id); next.directions.forEach(d => { d.keywords = d.keywords.filter(k => k !== node.id) }) }
    if (node.kind === 'direction') next.directions = next.directions.filter(d => d.id !== node.id)
    if (node.kind === 'member') {
      next.members = next.members.filter(m => m.id !== node.id)
      next.directions.forEach(d => { d.owners = d.owners.filter(m => m.id !== node.id) })
      if (next.default_owner?.id === node.id) delete next.default_owner
    }
    onApply(next)
  }
  return <Dialog title={t(isDefault ? 'routing.defaultRule' : `${existing ? 'routing.edit' : 'routing.add'}.${node.kind}`)} onClose={onClose} t={t}>
    <form onSubmit={apply} className="grid gap-4">
      {error && <Alert tone="danger">{error}</Alert>}
      {isDefault ? <><p>{t('routing.defaultOwnerHint')}</p>{tags(roster.members.map(m => ({ id: m.id, label: m.name })), members, setMembers, true)}</> : <>
        <label className="fastui-field">{t(`routing.name.${node.kind}`)}<TextField autoFocus value={name} onChange={event => setName(event.target.value)} maxLength={node.kind === 'member' ? 80 : node.kind === 'keyword' ? 120 : 100} required /></label>
        {node.kind === 'member' && <label className="fastui-field">{t('routing.feishuOpenId')}<TextField value={feishu} onChange={event => setFeishu(event.target.value)} maxLength={200} placeholder={t('routing.feishuPlaceholder')} /></label>}
        {node.kind === 'member' && <label className="fastui-field">{t('routing.receiverRef')}<TextField value={receiver} onChange={event => setReceiver(event.target.value)} maxLength={200} placeholder={t('routing.receiverPlaceholder')} /></label>}
        {node.kind === 'direction' && <>
          <label className="fastui-field">{t('routing.priority')}<TextField type="number" value={priority} onChange={event => setPriority(Number(event.target.value))} min="0" step="1" required /></label>
          <fieldset className="grid gap-2"><legend>{t('routing.keywords')}</legend>{tags(roster.keywords.map(k => ({ id: k, label: k })), keywords, setKeywords)}</fieldset>
          <fieldset className="grid gap-2"><legend>{t('routing.owners')}</legend>{tags(roster.members.map(m => ({ id: m.id, label: m.name })), members, setMembers)}</fieldset>
        </>}
        {node.kind !== 'direction' && <fieldset className="grid gap-2"><legend>{t('routing.selectDirections')}</legend>{tags(roster.directions.map(d => ({ id: d.id, label: d.name })), directions, setDirections)}</fieldset>}
        {node.kind === 'member' && <label className="fastui-badge flex items-center gap-2 w-fit cursor-pointer"><Checkbox checked={defaultOwner} onChange={event => setDefaultOwner(event.target.checked)} />{t('routing.receiveDefault')}</label>}
      </>}
      <div className="flex flex-wrap justify-end gap-2">
        {existing && !isDefault && <Button variant="quiet" onClick={remove}><Trash2 size={14} />{t('routing.deleteNode')}</Button>}
        <Button variant="secondary" onClick={onClose}>{t('routing.cancel')}</Button>
        <Button type="submit" variant="primary">{t('routing.apply')}</Button>
      </div>
    </form>
  </Dialog>
}
