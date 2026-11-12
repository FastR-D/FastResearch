import { FlaskConical, type LucideIcon } from 'lucide-react'

export function BrandLink({ href, name = 'FastResearch', Icon = FlaskConical, tagline, className = '' }: {
  href: string
  name?: string
  Icon?: LucideIcon
  tagline?: string
  className?: string
}) {
  return <a className={`inline-flex min-h-10 shrink-0 items-center gap-[7px] max-[360px]:gap-[6px] min-[641px]:gap-[9px] whitespace-nowrap text-[15px] min-[641px]:text-base font-semibold tracking-[-0.04em] text-[var(--fastui-text)] no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fastui-focus)] ${className}`} href={href}>
    <span className="story-brand-mark grid h-[29px] w-[27px] min-[641px]:h-[31px] min-[641px]:w-[29px] shrink-0 place-items-center rounded-[var(--fastui-radius-panel)] bg-[var(--fastui-primary)] text-[var(--fastui-on-primary)]"><Icon size={19} aria-hidden="true" /></span>
    <span>{name}</span>
    {tagline && <small className="hidden min-[1181px]:inline-block ml-[7px] border-l border-[var(--fastui-border)] pl-[13px] text-[9px] font-normal tracking-[0.04em] text-[var(--fastui-secondary)]">{tagline}</small>}
  </a>
}
