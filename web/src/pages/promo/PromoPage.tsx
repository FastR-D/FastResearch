import '../../styles/promo.css'
import { BrandLink } from '../../shared/ui/BrandLink'
import { Button } from '@fastrd/ui-react'
import { ArrowDown,ArrowRight,ArrowUpRight,Check,FlaskConical,Menu,Mouse,ScanLine,X } from 'lucide-react'
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
  { label: '起点', eyebrow: '让每一步研究，都朝着成果前进', title: ['把研究的每一步，', '连成下一次突破。'], description: '从发现一篇新论文，到写下自己的研究。让动态、文献、写作与每日行动沿一条清晰的路线，持续向前。', points: ['发现值得读的', '留下真正理解的', '写出属于自己的'] },
  { label: '发现', eyebrow: '第一站 · 发现研究线索', title: ['先看见新问题，', '再找到新方向。'], description: '从学术动态与论文情报中捕捉线索。用 FastNews 浏览领域进展，用 FastInsight 将相关论文送入个人信箱。', apps: ['news', 'insight'], image: 'promo/module-news-static.webp', imageAlt: 'FastNews 研究动态与论文总览', note: '论文分发需要配置来源、方向与接收成员。' },
  { label: '研读', eyebrow: '第二站 · 把阅读变成理解', title: ['沿着证据深读，', '让理解有所依据。'], description: '在 FastRead 中阅读原文、提炼问题、继续追问。让报告与笔记留在论文旁，需要引用时，能够回到来源核对。', apps: ['read'], image: 'promo/module-read-static.webp', imageAlt: 'FastRead 原文阅读与证据化报告', points: ['原文与页码', '阅读与追问', '笔记与总结'] },
  { label: '表达', eyebrow: '第三站 · 让研究进入表达', title: ['让积累进入草稿，', '把想法讲得清楚。'], description: '用 FastWrite 组织论文，用 FastPPT 打磨汇报，用 FastFigure 表达方法与结构。让每一种成果，都有合适的表达工具。', apps: ['write', 'ppt', 'figure'], image: 'promo/module-write-static.webp', imageAlt: 'FastWrite 论文编辑与编译预览' },
  { label: '推进', eyebrow: '第四站 · 从想法走向行动', title: ['小步向前，', '让进展持续发生。'], description: 'FastTask 将长期目标拆成每日行动，FastLab 承接实验与验证。回到工作台，看清任务、研究工序与团队进度。', apps: ['task', 'lab', 'cas'], steps: ['明确研究目标', '安排今天的一步', '记录实验与成果', '回顾团队进度'], note: '任务同步、统一身份与实验能力以实际配置为准。' },
  { label: '开始', eyebrow: '你的下一步，从这里开始', title: ['选择此刻需要的，', '走向下一个发现。'], description: '每个工具，都有自己的专长。先了解产品，再进入工作台；按你的研究节奏，组合自己的工作方式。', directory: true },
]

function appChapters(product: Product): Chapter[] {
  const chapters: Chapter[] = [
    { label: '概览', eyebrow: `${product.name} · ${product.category}`, title: product.title, description: product.description, points: product.points },
    { label: '能力', eyebrow: '沿着问题，走近核心能力', title: [product.promise, '每一步，都有着落。'], description: product.features[0].body, image: product.image, imageAlt: product.imageAlt, points: product.features.map(feature => feature.title), note: product.image ? '产品界面或案例演示，使用脱敏内容。' : product.note },
    { label: '路径', eyebrow: '一条清晰的工作路径', title: ['知道从哪里开始，', '也知道下一步去哪里。'], description: product.features[1].body, steps: product.steps, note: product.features[2].body },
    { label: '开始', eyebrow: '让研究继续向前', title: [product.promise, '现在，开始下一步。'], description: product.note, apps: products.filter(item => item.id !== product.id && ['news', 'read', 'write', 'task'].includes(item.id)).map(item => item.id).slice(0, 3) },
  ]
  if (product.id === 'ppt') chapters.splice(2, 0, {
    label: '对比', eyebrow: '同一份内容，看见每一页的变化',
    title: ['从修改前，', '看到修改后。'],
    description: '切换四组演示案例，对照版式、信息层级与页面表达的变化。',
    gallery: true,
  })
  return chapters
}

function ProductImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false)
  return <figure className={`story-media ${failed ? 'is-error' : ''}`}>
    <div className="story-media-bar"><span /><span /><span /><small>产品界面 · 示例内容</small></div>
    {failed ? <div className="story-image-fallback"><ScanLine size={32} aria-hidden="true" /><p>图片暂时无法加载，功能说明与入口仍可使用。</p></div> : <img src={`${import.meta.env.BASE_URL}${src}`} alt={alt} width={960} height={620} loading="lazy" decoding="async" onError={() => setFailed(true)} />}
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

  useEffect(() => {
    document.documentElement.lang = 'zh-CN'
    document.title = product ? `${product.name} · ${product.category} | FastResearch` : 'FastResearch · 让每一步研究，都朝着成果前进'
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
    <a className="story-skip" href="#story-content">跳至主要内容</a>
    <nav ref={navRef} className="story-nav" aria-label="产品导航">
      <div className="story-nav-inner">
        <BrandLink className="story-brand" href={import.meta.env.BASE_URL} name={product?.name} Icon={BrandIcon} tagline={product ? product.category : '研究，向前一步'} />
        <div className="story-nav-links"><a href="#chapter-0">{product ? '产品概览' : '研究起点'}</a><a href="#chapter-1">{product ? '核心能力' : '研究路线'}</a>{product?.id === 'ppt' && <a href="#chapter-2">前后对比</a>}<a href={`#chapter-${chapters.length - 1}`}>{product ? '开始使用' : '产品矩阵'}</a>{product && <a href={import.meta.env.BASE_URL}>全部产品</a>}</div>
        <div className="story-nav-actions"><a className="story-button story-button--small" href={workspaceHref}>工作台<ArrowUpRight size={14} aria-hidden="true" /></a><Button ref={triggerRef} variant="icon" className="story-menu-toggle" aria-label={menuOpen ? '关闭产品菜单' : '打开产品菜单'} aria-controls="story-menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)}>{menuOpen ? <X size={19} /> : <Menu size={19} />}</Button></div>
      </div>
      <div id="story-menu" className="story-menu" hidden={!menuOpen}><a href={import.meta.env.BASE_URL}>FastResearch · 产品总览</a>{products.map(app => <a key={app.id} href={productHref(app.id)} aria-current={product?.id === app.id ? 'page' : undefined}><app.Icon size={16} aria-hidden="true" /><span>{app.name}<small>{app.category}</small></span><ArrowUpRight size={13} aria-hidden="true" /></a>)}</div>
    </nav>

    <main id="story-content" ref={scrollRef} className="story-scroll" tabIndex={0} aria-busy={moving} aria-label={product ? `${product.name} 产品介绍，向下滚动逐屏浏览` : 'FastResearch 产品介绍，向下滚动逐屏浏览'}>
      <JourneyTrail labels={labels} active={active} />
      {chapters.map((chapter, index) => <section key={index} id={`chapter-${index}`} data-chapter={index} inert={active !== index} aria-labelledby={`chapter-title-${index}`} className={`story-screen ${active === index ? 'is-active' : ''} ${chapter.directory ? 'story-screen--directory' : ''} ${chapter.gallery ? 'story-screen--gallery' : ''} ${index === 0 ? 'story-screen--hero' : ''} ${index === chapters.length - 1 ? 'story-screen--last' : ''}`}>
        <div className="story-grid">
          <div className="story-copy">
            <div className="story-eyebrow"><span /><span>{chapter.eyebrow}</span></div>
            {index === 0 ? <h1 tabIndex={-1} id={`chapter-title-${index}`}>{chapter.title[0]}<br /><em>{chapter.title[1]}</em></h1> : <h2 tabIndex={-1} id={`chapter-title-${index}`}>{chapter.title[0]}<br /><em>{chapter.title[1]}</em></h2>}
            <p className="story-description">{chapter.description}</p>
            {chapter.points && <ul className="story-points">{chapter.points.map(point => <li key={point}><Check size={13} aria-hidden="true" />{point}</li>)}</ul>}
            {chapter.apps && <div className="story-app-links">{chapter.apps.map(id => { const app = products.find(item => item.id === id)!; return <a key={id} href={productHref(id)}><app.Icon size={17} aria-hidden="true" /><span>{app.name}<small>{app.category}</small></span><ArrowUpRight size={14} aria-hidden="true" /></a> })}</div>}
            {!chapter.gallery && <div className="story-actions"><a className="story-button" href={primaryHref}>{product ? product.id === 'ui' ? '查看 FastUI 文档' : `开始使用 ${product.name}` : '进入科研工作台'}<ArrowUpRight size={17} aria-hidden="true" /></a>{index < chapters.length - 1 ? <a className="story-next" href={`#chapter-${index + 1}`}>{index === 0 ? '沿着路线，继续探索' : '前往下一站'}<ArrowDown size={15} aria-hidden="true" /></a> : <a className="story-next" href={product ? import.meta.env.BASE_URL : '#chapter-0'}>{product ? '返回产品总览' : '回到研究起点'}<ArrowRight size={15} aria-hidden="true" /></a>}</div>}
            {chapter.note && <p className="story-note">{chapter.note}</p>}
          </div>
          <div className={`story-visual ${chapter.image ? 'story-visual--media' : ''}`}>
            {chapter.gallery ? <PPTComparisonGallery /> : chapter.directory ? <div className="story-directory" aria-label="各应用介绍">{products.map(app => <a key={app.id} href={productHref(app.id)}><span className="story-directory-icon"><app.Icon size={21} strokeWidth={1.5} aria-hidden="true" /></span><span><strong>{app.name}</strong><small>{app.category}</small></span><ArrowUpRight size={15} aria-hidden="true" /></a>)}</div> : <>

              {!chapter.image && !chapter.steps && <div className="story-route-copy"><span>一步，一次连接</span><strong>{product?.promise ?? <>沿着研究的脉络，<br />持续向前。</>}</strong></div>}
              {chapter.image && <ProductImage src={chapter.image} alt={chapter.imageAlt ?? `${product?.name ?? 'FastResearch'} 产品界面`} />}
              {chapter.steps && <ol className="story-steps">{chapter.steps.map((step, i) => <li key={step}><span>0{i + 1}</span><strong>{step}</strong><span className="story-step-dot" /></li>)}</ol>}
            </>}
          </div>
        </div>
        <div className="story-screen-meta"><span>{product?.name ?? 'FastResearch'} / {chapter.label}</span><span>0{index + 1} — 0{chapters.length}</span></div>
      </section>)}
    </main>
    <nav className="story-pager" aria-label="研究路线章节" style={{ '--chapter-progress': active / (chapters.length - 1) } as CSSProperties}>{chapters.map((chapter, index) => <a key={index} href={`#chapter-${index}`} aria-label={`第 ${index + 1} 屏：${chapter.label}`} aria-current={index === active ? 'step' : undefined} className={`${index <= active ? 'is-reached' : ''} ${index === active ? 'is-current' : ''}`}><span className="story-pager-dot" /><span className="story-pager-label">{chapter.label}</span></a>)}<span className="story-pager-wheel" role="img" aria-label="滚动切换屏幕" title="向下滚动前进一屏，向上滚动返回一屏"><Mouse size={17} aria-hidden="true" /></span></nav>
    <div className="story-announcement" role="status" aria-live="polite">第 {active + 1} 屏，共 {chapters.length} 屏：{chapters[active].label}</div>
  </div>
}
