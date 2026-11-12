import { useEffect,useMemo,useRef,type CSSProperties } from 'react'
import { journeyDuration,journeyEase } from './use-screen-journey'

// One unbroken landscape, extending beyond both sides and connecting every screen.
function landscape(index: number) {
  const y = index * 1000
  const reverse = index % 2 === 1
  const x = 1120
  const nodeY = [600, 590, 620, 580, 610, 600][index % 6]
  const toNode = reverse
    ? `M 1760 ${y + 660} C 1530 ${y + 720} 1370 ${y + 470} ${x} ${y + nodeY}`
    : `M -160 ${y + 660} C 100 ${y + 720} 240 ${y + 470} 520 ${y + 580} C 760 ${y + 710} 870 ${y + 480} ${x} ${y + nodeY}`
  // Adjacent screens connect outside the viewport, leaving one visible wave per screen.
  const rest = reverse
    ? ` C 870 ${y + 710} 760 ${y + 490} 520 ${y + 600} C 260 ${y + 730} 100 ${y + 470} -160 ${y + 540} C -400 ${y + 600} -400 ${y + 1640} -160 ${y + 1660}`
    : ` C 1370 ${y + 730} 1510 ${y + 470} 1760 ${y + 540} C 2000 ${y + 600} 2000 ${y + 1640} 1760 ${y + 1660}`
  return { toNode, rest, x, y: y + nodeY }
}

export default function JourneyTrail({ labels, active }: { labels: string[]; active: number }) {
  const scenes = useMemo(() => labels.map((_, i) => landscape(i)), [labels])
  const route = scenes.map((scene, i) => `${i ? scene.toNode.replace(/^M -?\d+ \d+/, '') : scene.toNode}${scene.rest}`).join(' ')
  const progressRef = useRef<SVGPathElement>(null)
  const pathRef = useRef<SVGPathElement>(null)
  const particleRef = useRef<HTMLSpanElement>(null)
  const distanceRef = useRef<number | null>(null)
  const previousRef = useRef(active)

  useEffect(() => {
    const path = pathRef.current
    const progress = progressRef.current
    const particle = particleRef.current
    if (!path || !progress || !particle) return
    const measure = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    let prefix = ''
    const stops = scenes.map((scene, i) => {
      prefix += ` ${i ? scene.toNode.replace(/^M -?\d+ \d+/, '') : scene.toNode}`
      measure.setAttribute('d', prefix)
      const stop = measure.getTotalLength()
      prefix += scene.rest
      return stop
    })
    const total = path.getTotalLength()
    const start = distanceRef.current ?? stops[active]
    const target = stops[active]
    const duration = journeyDuration(Math.abs(active - previousRef.current))
    previousRef.current = active
    let frame = 0
    const place = (distance: number) => {
      distanceRef.current = distance
      const point = path.getPointAtLength(distance)
      particle.style.left = `${point.x / 1600 * 100}%`
      particle.style.top = `${point.y / (labels.length * 1000) * 100}%`
      progress.style.strokeDasharray = `${distance} ${total}`
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || Math.abs(start - target) < 1) { place(target); return }
    const began = performance.now()
    const animate = (now: number) => {
      const phase = Math.min(1, (now - began) / duration)
      place(start + (target - start) * journeyEase(phase))
      if (phase < 1) frame = requestAnimationFrame(animate)
    }
    frame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frame)
  }, [active, labels.length, scenes])

  return <div className="journey-landscape" style={{ height: `${labels.length * 100}%` }} aria-hidden="true">
    <svg className="journey-world" viewBox={`0 0 1600 ${labels.length * 1000}`} preserveAspectRatio="none" fill="none">
      <path ref={pathRef} className="journey-track" d={route} />
      <path ref={progressRef} className="journey-progress-line" d={route} />
    </svg>
    {scenes.map((scene, i) => <div key={i} className={`landscape-stop ${i <= active ? 'is-reached' : ''} ${i === active ? 'is-current' : ''}`} style={{ left: `${scene.x / 1600 * 100}%`, top: `${scene.y / (labels.length * 1000) * 100}%` } as CSSProperties}><span className="landscape-stop-ring" /><span className="landscape-stop-copy"><small>0{i + 1}</small><strong>{labels[i]}</strong></span></div>)}
    <span ref={particleRef} className="journey-traveler"><span /></span>
  </div>
}
