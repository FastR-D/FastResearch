import { text as t } from '../../shared/copy'
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'
import { useState } from 'react'
import './ppt-comparison-gallery.css'

const examples = [
  { id: 'pipeline', label: t('promo.gallery.examples.pipeline.label'), title: t('promo.gallery.examples.pipeline.title') },
  { id: 'memory', label: t('promo.gallery.examples.memory.label'), title: t('promo.gallery.examples.memory.title') },
  { id: 'instructions', label: t('promo.gallery.examples.instructions.label'), title: t('promo.gallery.examples.instructions.title') },
  { id: 'interconnect', label: t('promo.gallery.examples.interconnect.label'), title: t('promo.gallery.examples.interconnect.title') },
]

export default function PPTComparisonGallery() {
  const [selected, setSelected] = useState(0)
  const example = examples[selected]
  const change = (direction: number) => setSelected(current => (current + direction + examples.length) % examples.length)

  return <div className="ppt-gallery" role="region" aria-label={t('promo.gallery.title')}>
    <div className="ppt-gallery-choices" role="group" aria-label={t('promo.gallery.choicesAria')}>
      {examples.map((item, index) => <button key={item.id} type="button" aria-pressed={selected === index} onClick={() => setSelected(index)}>{item.label}</button>)}
    </div>
    <div className="ppt-gallery-pair" key={example.id}>
      {(['before', 'after'] as const).map(version => {
        const label = version === 'before' ? t('promo.gallery.before') : t('promo.gallery.after')
        const src = `${import.meta.env.BASE_URL}fastppt/assets/comparisons/${example.id}-${version}.webp`
        return <figure className={`ppt-gallery-slide ppt-gallery-slide--${version}`} key={version}>
          <figcaption><span>{label}</span><a href={src} target="_blank" rel="noopener noreferrer" aria-label={t('promo.gallery.originalAria', { example: example.label, version: label })}>{t('promo.gallery.original')}<ExternalLink size={12} aria-hidden="true" /></a></figcaption>
          <img src={src} alt={t('promo.gallery.imageAlt', { example: example.label, version: label })} width={3200} height={version === 'before' ? 2400 : 1800} loading="lazy" decoding="async" />
        </figure>
      })}
    </div>
    <div className="ppt-gallery-footer">
      <p aria-live="polite" aria-atomic="true"><span>{String(selected + 1).padStart(2, '0')} / 04</span>{example.title}</p>
      <div className="ppt-gallery-arrows">
        <button type="button" onClick={() => change(-1)} aria-label={t('promo.gallery.previous')}><ChevronLeft size={18} /></button>
        <button type="button" onClick={() => change(1)} aria-label={t('promo.gallery.next')}><ChevronRight size={18} /></button>
      </div>
    </div>
  </div>
}
