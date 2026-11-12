import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'
import { useState } from 'react'
import './ppt-comparison-gallery.css'

const examples = [
  { id: 'pipeline', label: '流水线时序', title: '把时序关系，整理成清晰的阅读顺序。' },
  { id: 'memory', label: '存储系统', title: '用分组与层级，梳理概念之间的关系。' },
  { id: 'instructions', label: '指令编码', title: '让基本思想、推导与结论各有位置。' },
  { id: 'interconnect', label: '章节封面', title: '从章节内容出发，重新组织封面表达。' },
]

export default function PPTComparisonGallery() {
  const [selected, setSelected] = useState(0)
  const example = examples[selected]
  const change = (direction: number) => setSelected(current => (current + direction + examples.length) % examples.length)

  return <div className="ppt-gallery" role="region" aria-label="PPT 修改前后对比画廊">
    <div className="ppt-gallery-choices" role="group" aria-label="选择 PPT 案例">
      {examples.map((item, index) => <button key={item.id} type="button" aria-pressed={selected === index} onClick={() => setSelected(index)}>{item.label}</button>)}
    </div>
    <div className="ppt-gallery-pair" key={example.id}>
      {(['before', 'after'] as const).map(version => {
        const label = version === 'before' ? '修改前' : '修改后'
        const src = `${import.meta.env.BASE_URL}fastppt/assets/comparisons/${example.id}-${version}.webp`
        return <figure className={`ppt-gallery-slide ppt-gallery-slide--${version}`} key={version}>
          <figcaption><span>{label}</span><a href={src} target="_blank" rel="noopener noreferrer" aria-label={`查看${example.label}${label}原图（新窗口）`}>查看原图<ExternalLink size={12} aria-hidden="true" /></a></figcaption>
          <img src={src} alt={`${example.label} PPT ${label}`} width={3200} height={version === 'before' ? 2400 : 1800} loading="lazy" decoding="async" />
        </figure>
      })}
    </div>
    <div className="ppt-gallery-footer">
      <p aria-live="polite" aria-atomic="true"><span>{String(selected + 1).padStart(2, '0')} / 04</span>{example.title}</p>
      <div className="ppt-gallery-arrows">
        <button type="button" onClick={() => change(-1)} aria-label="上一个 PPT 案例"><ChevronLeft size={18} /></button>
        <button type="button" onClick={() => change(1)} aria-label="下一个 PPT 案例"><ChevronRight size={18} /></button>
      </div>
    </div>
  </div>
}
