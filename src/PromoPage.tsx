import { ArrowRight, ArrowUp, BookOpenText, Check, FlaskConical, Inbox, KeyRound, ListTodo, Menu, Newspaper, PenLine, UsersRound, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createTranslator, getInitialLocale, saveLocale, type Locale, type Translate } from './i18n'
import './promo.css'

const WORKSPACE_HREF = `${import.meta.env.BASE_URL}workspace`
const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')
const FASTTASK_HREF = `${API_BASE}/api/fasttask/login`
const asset = (name: string) => `${import.meta.env.BASE_URL}promo/${name}`

const MODULES = [
  { id: 'fastNews', nameKey: 'entry.fast-news.name', labelKey: 'entry.fast-news.label', image: 'module-news-static', motion: 'module-news-anim', altKey: 'promo.media.alt.news', Icon: Newspaper, width: 960, height: 620 },
  { id: 'fastRead', nameKey: 'entry.fast-read.name', labelKey: 'entry.fast-read.label', image: 'module-read-static', motion: 'module-read-anim', altKey: 'promo.media.alt.read', Icon: BookOpenText, width: 960, height: 620 },
  { id: 'fastWrite', nameKey: 'entry.fast-write.name', labelKey: 'entry.fast-write.label', image: 'module-write-static', motion: 'module-write-anim', altKey: 'promo.media.alt.write', Icon: PenLine, width: 960, height: 620 },
] as const

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(prefersReducedMotion)
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return reduced
}

function Reveal({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (prefersReducedMotion()) {
      node.classList.add('is-visible')
      return
    }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        entry.target.classList.add('is-visible')
        observer.unobserve(entry.target)
      }
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.12 })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return <div ref={ref} className={`promo-reveal ${className}`.trim()} style={delay ? { transitionDelay: `${delay}ms` } : undefined}>{children}</div>
}

function PromoImage({ src, motionSrc, alt, width, height, t, eager = false, reducedMotion }: { src: string; motionSrc?: string; alt: string; width: number; height: number; t: Translate; eager?: boolean; reducedMotion: boolean }) {
  const activeSrc = motionSrc && !reducedMotion ? motionSrc : src
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  useEffect(() => setState('loading'), [activeSrc])
  return (
    <figure className={`promo-figure is-${state}`}>
      {state === 'loading' && <div className="promo-figure-status">{t('promo.media.loading')}</div>}
      {state === 'error' && <div className="promo-figure-status promo-figure-status--error">{t('promo.media.unavailable')}</div>}
      {motionSrc && !reducedMotion && <span className="promo-motion-badge">{t('promo.media.animated')}</span>}
      <img
        src={activeSrc}
        alt={alt}
        width={width}
        height={height}
        style={{ aspectRatio: `${width} / ${height}` }}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        onLoad={() => setState('ready')}
        onError={() => setState('error')}
      />
    </figure>
  )
}

function PromoPage() {
  const [locale, setLocale] = useState<Locale>(getInitialLocale)
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const t = useMemo(() => createTranslator(locale), [locale])
  const reducedMotion = usePrefersReducedMotion()

  const changeLocale = () => {
    const next = locale === 'zh-CN' ? 'en-US' : 'zh-CN'
    setLocale(next)
    saveLocale(next)
  }

  useEffect(() => {
    document.documentElement.lang = locale
    document.title = t('promo.meta.title')
    document.querySelector('meta[name="description"]')?.setAttribute('content', t('promo.meta.description'))
  }, [locale, t])

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [menuOpen])

  const navLinks = [
    { href: '#workflow', label: t('promo.nav.workflow') },
    { href: '#modules', label: t('promo.nav.modules') },
    { href: '#insight', label: t('promo.nav.insight') },
    { href: '#team', label: t('promo.nav.team') },
  ]
  const steps = [
    { title: t('promo.workflow.news'), detail: t('promo.workflow.newsDetail') },
    { title: t('promo.workflow.read'), detail: t('promo.workflow.readDetail') },
    { title: t('promo.workflow.write'), detail: t('promo.workflow.writeDetail') },
  ]

  return (
    <div className="promo-page" id="top">
      <nav className={`promo-nav ${scrolled || menuOpen ? 'is-scrolled' : ''}`} aria-label="FastResearch">
        <div className="promo-container promo-nav-inner">
          <a className="promo-brand" href="#top">
            <span className="promo-brand-icon"><FlaskConical size={16} /></span>
            <span className="promo-brand-name"><b>Fast</b>Research</span>
          </a>
          <div className="promo-nav-links">
            {navLinks.map((link) => <a key={link.href} href={link.href}>{link.label}</a>)}
          </div>
          <div className="promo-nav-actions">
            <button type="button" className="promo-lang" onClick={changeLocale} aria-label={t('promo.language.label')}>
              {locale === 'zh-CN' ? 'English' : '中文'}
            </button>
            <a className="promo-btn promo-btn--ghost promo-nav-cta" href={FASTTASK_HREF} aria-label={t('header.fastTask')} title={t('header.fastTask')}>
              <ListTodo size={16} />
              <span className="promo-nav-fasttask-label">{t('header.fastTask')}</span>
            </a>
            <a className="promo-btn promo-btn--primary promo-nav-cta" href={WORKSPACE_HREF}>{t('promo.cta.workspaceShort')}</a>
            <button
              type="button"
              className="promo-menu-button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-controls="promo-menu"
              aria-label={menuOpen ? t('promo.menu.close') : t('promo.menu.open')}
            >
              {menuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>
        <div id="promo-menu" className="promo-menu" hidden={!menuOpen}>
          {navLinks.map((link) => <a key={link.href} href={link.href} onClick={() => setMenuOpen(false)}>{link.label}</a>)}
          <a className="promo-btn promo-btn--ghost" href={FASTTASK_HREF} onClick={() => setMenuOpen(false)}><ListTodo size={15} /> {t('header.fastTask')}</a>
          <button type="button" className="promo-menu-lang" onClick={() => { changeLocale(); setMenuOpen(false) }} aria-label={t('promo.language.label')}>
            {locale === 'zh-CN' ? 'English' : '中文'}
          </button>
          <a className="promo-btn promo-btn--primary" href={WORKSPACE_HREF}>{t('promo.cta.workspace')}</a>
        </div>
      </nav>

      <header className="promo-hero">
        <div className="promo-hero-media">
          <picture>
            <source media="(max-width: 767px)" srcSet={asset('hero-mobile.webp')} type="image/webp" />
            <source media="(min-width: 768px)" srcSet={asset('hero-desktop.webp')} type="image/webp" />
            <img src={asset('hero-desktop.webp')} alt={t('promo.hero.imageAlt')} width={1440} height={680} loading="eager" decoding="async" />
          </picture>
        </div>
        <svg className="promo-path" viewBox="0 0 1200 200" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <path d="M-20 168 C 220 168, 240 96, 430 96 S 700 40, 900 40 S 1080 74, 1220 66" pathLength={1} />
        </svg>
        <div className="promo-container promo-hero-inner">
          <span className="promo-kicker">ACADEMIC PIPELINE</span>
          <h1>{t('promo.hero.title')}</h1>
          <p className="promo-hero-lead">{t('promo.hero.description')}</p>
          <div className="promo-hero-actions">
            <a className="promo-btn promo-btn--primary" href={WORKSPACE_HREF}>{t('promo.cta.workspace')}</a>
            <a className="promo-btn promo-btn--ghost" href={FASTTASK_HREF}><ListTodo size={16} /> {t('header.fastTask')}</a>
            <a className="promo-btn promo-btn--ghost" href="#workflow">{t('promo.cta.explore')}</a>
          </div>
        </div>
        <span className="promo-demo-label">{t('promo.hero.demoLabel')}</span>
      </header>

      <section id="workflow" className="promo-section promo-band--base">
        <div className="promo-container">
          <Reveal className="promo-section-head">
            <span className="promo-kicker">01 · PIPELINE</span>
            <h2>{t('promo.workflow.title')}</h2>
            <p className="promo-lead">{t('promo.workflow.description')}</p>
          </Reveal>
          <ol className="promo-steps">
            {steps.map((step, index) => (
              <li key={step.title}>
                <Reveal delay={index * 90}>
                  <span className="promo-step-index">{String(index + 1).padStart(2, '0')}</span>
                  <strong>{step.title}</strong>
                  <p>{step.detail}</p>
                </Reveal>
              </li>
            ))}
          </ol>
          <Reveal className="promo-workflow-visual">
            <PromoImage src={asset('workflow-board.webp')} alt={t('promo.media.alt.workflow')} width={2636} height={1198} t={t} reducedMotion={reducedMotion} />
          </Reveal>
        </div>
      </section>

      <section id="modules" className="promo-section promo-band--surface">
        <div className="promo-container promo-modules">
          {MODULES.map((module, index) => {
            const { Icon } = module
            return (
              <article className="promo-module" key={module.id}>
                <Reveal className="promo-module-copy">
                  <span className="promo-module-kicker"><Icon size={15} /> {t(module.nameKey)} · {t(module.labelKey).split(' · ')[0]}</span>
                  <h2>{t(`promo.${module.id}.title`)}</h2>
                  <p>{t(`promo.${module.id}.description`)}</p>
                  <dl>
                    <div><dt>{t('promo.modules.actionLabel')}</dt><dd>{t(`promo.${module.id}.action`)}</dd></div>
                    <div><dt>{t('promo.modules.outputLabel')}</dt><dd>{t(`promo.${module.id}.output`)}</dd></div>
                  </dl>
                  <a className="promo-link" href={WORKSPACE_HREF}>{t('promo.modules.openCta')} <ArrowRight size={15} /></a>
                </Reveal>
                <Reveal className="promo-module-media" delay={index ? 60 : 0}>
                  <PromoImage src={asset(`${module.image}.webp`)} motionSrc={'motion' in module ? asset(`${module.motion}.webp`) : undefined} alt={t(module.altKey)} width={module.width} height={module.height} t={t} reducedMotion={reducedMotion} />
                </Reveal>
              </article>
            )
          })}
        </div>
      </section>

      <section id="insight" className="promo-section promo-band--base">
        <div className="promo-container">
          <article className="promo-module promo-module--reverse">
            <Reveal className="promo-module-copy">
              <span className="promo-module-kicker"><Inbox size={15} /> {t('insight.label')}</span>
              <h2>{t('promo.insight.title')}</h2>
              <p>{t('promo.insight.description')}</p>
              <p className="promo-note"><Check size={14} /> {t('promo.insight.requirement')}</p>
            </Reveal>
            <Reveal className="promo-module-media">
              <PromoImage src={asset('insight.webp')} alt={t('promo.media.alt.insight')} width={2636} height={1198} t={t} reducedMotion={reducedMotion} />
            </Reveal>
          </article>
        </div>
      </section>

      <section id="team" className="promo-section promo-band--base promo-band--tight">
        <div className="promo-container">
          <article className="promo-module promo-module--reverse">
            <Reveal className="promo-module-copy">
              <span className="promo-module-kicker"><UsersRound size={15} /> {t('team.label')}</span>
              <h2>{t('promo.team.title')}</h2>
              <p>{t('promo.team.description')}</p>
              <p className="promo-note"><Check size={14} /> {t('promo.team.fastTaskOptional')}</p>
            </Reveal>
            <Reveal className="promo-module-media">
              <PromoImage src={asset('team.webp')} alt={t('promo.media.alt.team')} width={2508} height={1094} t={t} reducedMotion={reducedMotion} />
            </Reveal>
          </article>
        </div>
      </section>

      <section id="access" className="promo-section promo-band--accent">
        <div className="promo-container promo-access">
          <Reveal className="promo-access-copy">
            <span className="promo-access-icon"><KeyRound size={18} /></span>
            <h2>{t('promo.access.title')}</h2>
            <p>{t('promo.access.description')}</p>
            <p className="promo-note"><Check size={14} /> {t('promo.access.fastCasOptional')}</p>
          </Reveal>
          <Reveal className="promo-closing" delay={80}>
            <strong>{t('promo.closing.title')}</strong>
            <a className="promo-btn promo-btn--primary" href={WORKSPACE_HREF}>{t('promo.cta.workspace')}</a>
          </Reveal>
        </div>
      </section>

      <footer className="promo-footer">
        <div className="promo-container promo-footer-inner">
          <div className="promo-footer-brand">
            <span className="promo-brand-icon"><FlaskConical size={15} /></span>
            <span className="promo-brand-name"><b>Fast</b>Research</span>
          </div>
          <div className="promo-footer-links">
            <a href={WORKSPACE_HREF}>{t('promo.cta.workspace')}</a>
            <button type="button" onClick={changeLocale} aria-label={t('promo.language.label')}>{locale === 'zh-CN' ? 'English' : '中文'}</button>
            <a className="promo-back-to-top" href="#top">{t('promo.cta.backToTop')} <ArrowUp size={13} /></a>
          </div>
          <p className="promo-footer-note">{t('promo.footer.note')}</p>
        </div>
      </footer>
    </div>
  )
}

export default PromoPage
