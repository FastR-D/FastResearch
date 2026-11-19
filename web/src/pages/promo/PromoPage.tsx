import { text as t } from '../../shared/copy'
import '../../styles/promo.css'
import { BrandLink } from '../../shared/ui/BrandLink'
import { Button } from '@fastrd/ui-react'
import { ArrowDown,ArrowUp,ArrowUpRight,Check,FlaskConical,Menu,ScanLine,X } from 'lucide-react'
import { useEffect,useMemo,useRef,useState,type CSSProperties } from 'react'
import { launchHref,productHref,products,workspaceHref,type Product } from '../../shared/products'
import JourneyTrail from './JourneyTrail'
import PPTComparisonGallery from './PPTComparisonGallery'
import { useScreenJourney } from './use-screen-journey'

type Chapter = {
  label: string
  eyebrow: string
  title: [string, string]
  description: string
  points?: string[]
  apps?: string[]
  image?: string
  imageAlt?: string
  note?: string
  directory?: boolean
  gallery?: boolean
  steps?: string[]
}

const rootChapters: Chapter[] = [
  { label: t('promo.chapters.start.label'), eyebrow: t('promo.chapters.start.eyebrow'), title: [t('promo.chapters.start.title.1'), t('promo.chapters.start.title.2')], description: t('promo.chapters.start.description'), points: [t('promo.chapters.start.points.1'), t('promo.chapters.start.points.2'), t('promo.chapters.start.points.3')] },
  { label: t('promo.chapters.discover.label'), eyebrow: t('promo.chapters.discover.eyebrow'), title: [t('promo.chapters.discover.title.1'), t('promo.chapters.discover.title.2')], description: t('promo.chapters.discover.description'), apps: ['news', 'insight'], image: 'promo/module-news-static.webp', imageAlt: t('promo.chapters.discover.imageAlt'), note: t('promo.chapters.discover.note') },
  { label: t('promo.chapters.read.label'), eyebrow: t('promo.chapters.read.eyebrow'), title: [t('promo.chapters.read.title.1'), t('promo.chapters.read.title.2')], description: t('promo.chapters.read.description'), apps: ['read'], image: 'promo/module-read-static.webp', imageAlt: t('promo.chapters.read.imageAlt'), points: [t('promo.chapters.read.points.1'), t('promo.chapters.read.points.2'), t('promo.chapters.read.points.3')] },
  { label: t('promo.chapters.express.label'), eyebrow: t('promo.chapters.express.eyebrow'), title: [t('promo.chapters.express.title.1'), t('promo.chapters.express.title.2')], description: t('promo.chapters.express.description'), apps: ['write', 'ppt', 'figure'], image: 'promo/module-write-static.webp', imageAlt: t('promo.chapters.express.imageAlt') },
  { label: t('promo.chapters.advance.label'), eyebrow: t('promo.chapters.advance.eyebrow'), title: [t('promo.chapters.advance.title.1'), t('promo.chapters.advance.title.2')], description: t('promo.chapters.advance.description'), apps: ['task', 'lab', 'cas'], steps: [t('promo.chapters.advance.steps.1'), t('promo.chapters.advance.steps.2'), t('promo.chapters.advance.steps.3'), t('promo.chapters.advance.steps.4')], note: t('promo.chapters.advance.note') },
  { label: t('promo.chapters.begin.label'), eyebrow: t('promo.chapters.begin.eyebrow'), title: [t('promo.chapters.begin.title.1'), t('promo.chapters.begin.title.2')], description: t('promo.chapters.begin.description'), directory: true },
]

function appChapters(product: Product): Chapter[] {
  const chapters: Chapter[] = [
    { label: t('promo.product.overviewLabel'), eyebrow: t('promo.product.eyebrow', { name: product.name, category: product.category }), title: product.title, description: product.description, points: product.points },
    { label: t('promo.product.featuresLabel'), eyebrow: t('promo.product.featuresEyebrow'), title: [product.promise, t('promo.product.featuresTitle')], description: product.features[0].body, image: product.image, imageAlt: product.imageAlt, points: product.features.map(feature => feature.title), note: product.image ? t('promo.product.mediaNote') : product.note },
    { label: t('promo.product.pathLabel'), eyebrow: t('promo.product.pathEyebrow'), title: [t('promo.product.pathTitle.1'), t('promo.product.pathTitle.2')], description: product.features[1].body, steps: product.steps, note: product.features[2].body },
    { label: t('promo.product.startLabel'), eyebrow: t('promo.product.startEyebrow'), title: [product.promise, t('promo.product.startTitle')], description: product.note, apps: products.filter(item => item.id !== product.id && ['news', 'read', 'write', 'task'].includes(item.id)).map(item => item.id).slice(0, 3) },
  ]
  if (product.id === 'ppt') chapters.splice(2, 0, {
    label: t('promo.product.comparisonLabel'), eyebrow: t('promo.product.comparisonEyebrow'),
    title: [t('promo.product.comparisonTitle.1'), t('promo.product.comparisonTitle.2')],
    description: t('promo.product.comparisonDescription'),
    gallery: true,
  })
  return chapters
}

function ProductImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false)
  return <figure className={`story-media ${failed ? 'is-error' : ''}`}>
    <div className="story-media-bar"><span /><span /><span /><small>{t('promo.media.caption')}</small></div>
    {failed ? <div className="story-image-fallback"><ScanLine size={32} aria-hidden="true" /><p>{t('promo.media.failed')}</p></div> : <img src={`${import.meta.env.BASE_URL}${src}`} alt={alt} width={960} height={620} loading="lazy" decoding="async" onError={() => setFailed(true)} />}
  </figure>
}

export default function PromoPage({ product }: { product?: Product }) {
  const chapters = useMemo(() => product ? appChapters(product) : rootChapters, [product])
  const { active, moving, navigate, containerRef: scrollRef } = useScreenJourney(chapters.length)
  const [menuOpen, setMenuOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const labels = useMemo(() => chapters.map(chapter => chapter.label), [chapters])
  const BrandIcon = product?.Icon ?? FlaskConical
  const primaryHref = product ? launchHref(product) : workspaceHref
  const isLastChapter = active === chapters.length - 1
  const nextHref = isLastChapter ? product ? import.meta.env.BASE_URL : '#chapter-0' : `#chapter-${active + 1}`
  const nextLabel = isLastChapter ? t(product ? 'promo.backToOverview' : 'promo.backToStart') : t(active === 0 ? 'promo.explore' : 'promo.nextChapter')

  useEffect(() => {
    document.documentElement.lang = 'zh-CN'
    document.title = product ? t('promo.product.documentTitle', { name: product.name, category: product.category }) : t('promo.documentTitle')
    document.querySelector('meta[name="description"]')?.setAttribute('content', product?.description ?? rootChapters[0].description)
  }, [product])

  useEffect(() => {
    if (!menuOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMenuOpen(false); triggerRef.current?.focus() }
    }
    const onPointerDown = (event: PointerEvent) => { if (!navRef.current?.contains(event.target as Node)) setMenuOpen(false) }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => { document.removeEventListener('keydown', onKeyDown); document.removeEventListener('pointerdown', onPointerDown) }
  }, [menuOpen])

  return <div className="story-page promo-page" data-fastui-theme="light" data-active-screen={active} data-moving={moving} onClick={event => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const anchor = (event.target as Element).closest<HTMLAnchorElement>('a[href^="#chapter-"]')
    const index = anchor?.getAttribute('href')?.match(/^#chapter-(\d+)$/)?.[1]
    if (index === undefined) return
    event.preventDefault()
    navigate(Number(index))
  }}>
    <a className="story-skip" href="#story-content">{t('site.skip')}</a>
    <nav ref={navRef} className="story-nav" aria-label={t('promo.navigationAria')}>
      <div className="story-nav-inner">
        <BrandLink className="story-brand" href={import.meta.env.BASE_URL} name={product?.name} Icon={BrandIcon} tagline={product ? product.category : t('promo.tagline')} />
        <div className="story-nav-links"><a href="#chapter-0">{product ? t('promo.navigation.productOverview') : t('promo.navigation.start')}</a><a href="#chapter-1">{product ? t('promo.navigation.features') : t('promo.navigation.journey')}</a>{product?.id === 'ppt' && <a href="#chapter-2">{t('promo.navigation.comparison')}</a>}<a href={`#chapter-${chapters.length - 1}`}>{product ? t('promo.navigation.getStarted') : t('promo.navigation.directory')}</a>{product && <a href={import.meta.env.BASE_URL}>{t('promo.navigation.allProducts')}</a>}</div>
        <div className="story-nav-actions"><a className="story-button story-button--small" href={workspaceHref}>{t('promo.navigation.workspace')}<ArrowUpRight size={14} aria-hidden="true" /></a><Button ref={triggerRef} variant="icon" className="story-menu-toggle" aria-label={menuOpen ? t('promo.navigation.closeMenu') : t('promo.navigation.openMenu')} aria-controls="story-menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)}>{menuOpen ? <X size={19} /> : <Menu size={19} />}</Button></div>
      </div>
      <div id="story-menu" className="story-menu" hidden={!menuOpen}><a href={import.meta.env.BASE_URL}>{t('promo.navigation.home')}</a>{products.map(app => <a key={app.id} href={productHref(app.id)} aria-current={product?.id === app.id ? 'page' : undefined}><app.Icon size={16} aria-hidden="true" /><span>{app.name}<small>{app.category}</small></span><ArrowUpRight size={13} aria-hidden="true" /></a>)}</div>
    </nav>

    <main id="story-content" ref={scrollRef} className="story-scroll" tabIndex={0} aria-busy={moving} aria-label={product ? t('promo.product.journeyAria', { name: product.name }) : t('promo.journeyAria')}>
      <JourneyTrail labels={labels} active={active} />
      {chapters.map((chapter, index) => <section key={index} id={`chapter-${index}`} data-chapter={index} inert={active !== index} aria-labelledby={`chapter-title-${index}`} className={`story-screen ${active === index ? 'is-active' : ''} ${chapter.directory ? 'story-screen--directory' : ''} ${chapter.gallery ? 'story-screen--gallery' : ''} ${index === 0 ? 'story-screen--hero' : ''} ${index === chapters.length - 1 ? 'story-screen--last' : ''}`}>
        <div className="story-grid">
          <div className="story-copy">
            <div className="story-eyebrow"><span /><span>{chapter.eyebrow}</span></div>
            {index === 0 ? <h1 tabIndex={-1} id={`chapter-title-${index}`}>{chapter.title[0]}<br /><em>{chapter.title[1]}</em></h1> : <h2 tabIndex={-1} id={`chapter-title-${index}`}>{chapter.title[0]}<br /><em>{chapter.title[1]}</em></h2>}
            <p className="story-description">{chapter.description}</p>
            {chapter.points && <ul className="story-points">{chapter.points.map(point => <li key={point}><Check size={13} aria-hidden="true" />{point}</li>)}</ul>}
            {chapter.apps && <div className="story-app-links">{chapter.apps.map(id => { const app = products.find(item => item.id === id)!; return <a key={id} href={productHref(id)}><app.Icon size={17} aria-hidden="true" /><span>{app.name}<small>{app.category}</small></span><ArrowUpRight size={14} aria-hidden="true" /></a> })}</div>}
            {!chapter.gallery && <div className="story-actions"><a className="story-button" href={primaryHref}>{product ? product.id === 'ui' ? t('promo.viewUIDocs') : t('promo.startProduct', { name: product.name }) : t('promo.enterWorkspace')}<ArrowUpRight size={17} aria-hidden="true" /></a></div>}
            {chapter.note && <p className="story-note">{chapter.note}</p>}
          </div>
          <div className={`story-visual ${chapter.image ? 'story-visual--media' : ''}`}>
            {chapter.gallery ? <PPTComparisonGallery /> : chapter.directory ? <div className="story-directory" aria-label={t('promo.directoryAria')}>{products.map(app => <a key={app.id} href={productHref(app.id)}><span className="story-directory-icon"><app.Icon size={21} strokeWidth={1.5} aria-hidden="true" /></span><span><strong>{app.name}</strong><small>{app.category}</small></span><ArrowUpRight size={15} aria-hidden="true" /></a>)}</div> : <>

              {!chapter.image && !chapter.steps && <div className="story-route-copy"><span>{t('promo.routeEyebrow')}</span><strong>{product?.promise ?? <>{t('promo.routeTitle.1')}<br />{t('promo.routeTitle.2')}</>}</strong></div>}
              {chapter.image && <ProductImage src={chapter.image} alt={chapter.imageAlt ?? t('promo.media.defaultAlt', { name: product?.name ?? t('site.name') })} />}
              {chapter.steps && <ol className="story-steps">{chapter.steps.map((step, i) => <li key={step}><span>0{i + 1}</span><strong>{step}</strong><span className="story-step-dot" /></li>)}</ol>}
            </>}
          </div>
        </div>
        <div className="story-screen-meta"><span>{product?.name ?? t('site.name')} / {chapter.label}</span><span>0{index + 1} — 0{chapters.length}</span></div>
      </section>)}
    </main>
    <nav className="story-pager" aria-label={t('promo.chaptersAria')} style={{ '--chapter-progress': active / (chapters.length - 1) } as CSSProperties}>
      {chapters.map((chapter, index) => <a key={index} href={`#chapter-${index}`} aria-label={t('promo.chapterAria', { index: index + 1, label: chapter.label })} aria-current={index === active ? 'step' : undefined} className={`${index <= active ? 'is-reached' : ''} ${index === active ? 'is-current' : ''}`}><span className="story-pager-dot" /><span className="story-pager-label">{chapter.label}</span></a>)}
      <a className="story-next story-pager-next" href={nextHref}><span>{nextLabel}</span>{isLastChapter ? product ? <ArrowUpRight size={15} aria-hidden="true" /> : <ArrowUp size={15} aria-hidden="true" /> : <ArrowDown size={15} aria-hidden="true" />}</a>
    </nav>
    <div className="story-announcement" role="status" aria-live="polite">{t('promo.announcement', { index: active + 1, total: chapters.length, label: chapters[active].label })}</div>
  </div>
}
