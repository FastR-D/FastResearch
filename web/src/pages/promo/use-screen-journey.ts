import { useCallback,useEffect,useRef,useState } from 'react'

export const journeyEase = (value: number) => (1 - Math.cos(Math.PI * value)) / 2
export const journeyDuration = (distance: number) => 620 + Math.min(Math.max(distance - 1, 0), 3) * 80
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** One deliberate wheel burst / swipe advances exactly one viewport. */
export function useScreenJourney(count: number) {
  const initial = Math.min(count - 1, Math.max(0, Number(window.location.hash.match(/^#chapter-(\d+)$/)?.[1] ?? 0)))
  const [active, setActive] = useState(initial)
  const [moving, setMoving] = useState(false)
  const containerRef = useRef<HTMLElement>(null)
  const activeRef = useRef(initial)
  const movingRef = useRef(false)
  const frameRef = useRef(0)

  const navigate = useCallback((requested: number, focus = false, updateHash = true) => {
    const root = containerRef.current
    if (!root) return
    const target = Math.min(count - 1, Math.max(0, requested))
    cancelAnimationFrame(frameRef.current)
    const start = root.scrollTop / root.clientHeight
    activeRef.current = target
    setActive(target)
    if (updateHash) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#chapter-${target}`)
    const finish = () => {
      root.scrollTop = target * root.clientHeight
      movingRef.current = false
      setMoving(false)
      if (focus) root.querySelector<HTMLElement>(`#chapter-title-${target}`)?.focus({ preventScroll: true })
    }
    if (reducedMotion() || Math.abs(start - target) < .002) { finish(); return }
    movingRef.current = true
    setMoving(true)
    const started = performance.now()
    const duration = journeyDuration(Math.abs(target - start))
    const animate = (now: number) => {
      const progress = Math.min(1, (now - started) / duration)
      root.scrollTop = (start + (target - start) * journeyEase(progress)) * root.clientHeight
      if (progress < 1) frameRef.current = requestAnimationFrame(animate)
      else finish()
    }
    frameRef.current = requestAnimationFrame(animate)
  }, [count])

  useEffect(() => {
    const root = containerRef.current
    if (!root) return
    root.scrollTop = activeRef.current * root.clientHeight
    let lastWheel = -Infinity
    let consumed = false
    let accumulated = 0
    let touchStart: { x: number; y: number } | null = null
    let touchConsumed = false
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return
      event.preventDefault()
      const now = performance.now()
      // A quiet interval starts a new gesture. Momentum never queues a second page.
      if (now - lastWheel > 220 && !movingRef.current) { consumed = false; accumulated = 0 }
      lastWheel = now
      if (movingRef.current || consumed) return
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? root.clientHeight : 1)
      if (Math.sign(delta) !== Math.sign(accumulated)) accumulated = 0
      accumulated += delta
      if (Math.abs(accumulated) < 24) return
      consumed = true
      navigate(activeRef.current + Math.sign(accumulated))
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || (event.target as Element).closest('input, textarea, select, [contenteditable=true]')) return
      const direction = event.key === 'PageDown' || event.key === 'ArrowDown' || (event.key === ' ' && !event.shiftKey) ? 1
        : event.key === 'PageUp' || event.key === 'ArrowUp' || (event.key === ' ' && event.shiftKey) ? -1 : 0
      const target = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : direction ? activeRef.current + direction : null
      if (target === null || (event.key === ' ' && (event.target as Element).closest('button, a'))) return
      event.preventDefault()
      if (movingRef.current || event.repeat) return
      navigate(target, true)
    }
    const onTouchStart = (event: TouchEvent) => {
      touchStart = event.touches.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null
      touchConsumed = false
    }
    const onTouchMove = (event: TouchEvent) => {
      if (!touchStart || event.touches.length !== 1) return
      const dx = event.touches[0].clientX - touchStart.x
      const dy = touchStart.y - event.touches[0].clientY
      if (Math.abs(dy) <= Math.abs(dx)) return
      event.preventDefault()
      if (touchConsumed || movingRef.current || Math.abs(dy) < 45) return
      touchConsumed = true
      navigate(activeRef.current + Math.sign(dy))
    }
    const onTouchEnd = () => { touchStart = null }
    const onHashChange = () => {
      const match = window.location.hash.match(/^#chapter-(\d+)$/)
      if (match) navigate(Number(match[1]), false, false)
    }
    const resize = new ResizeObserver(() => {
      if (!movingRef.current) root.scrollTop = activeRef.current * root.clientHeight
    })
    resize.observe(root)
    root.addEventListener('wheel', onWheel, { passive: false })
    root.addEventListener('keydown', onKeyDown)
    root.addEventListener('touchstart', onTouchStart, { passive: true })
    root.addEventListener('touchmove', onTouchMove, { passive: false })
    root.addEventListener('touchend', onTouchEnd)
    window.addEventListener('hashchange', onHashChange)
    return () => {
      cancelAnimationFrame(frameRef.current)
      movingRef.current = false
      resize.disconnect()
      root.removeEventListener('wheel', onWheel)
      root.removeEventListener('keydown', onKeyDown)
      root.removeEventListener('touchstart', onTouchStart)
      root.removeEventListener('touchmove', onTouchMove)
      root.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('hashchange', onHashChange)
    }
  }, [count, navigate])

  return { active, moving, navigate, containerRef }
}
