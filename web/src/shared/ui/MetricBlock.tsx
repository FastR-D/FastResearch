import type { ReactNode } from 'react'

export function MetricBlock({ label, value }: { label: string; value: ReactNode }) {
  return <div className="fastui-section flex min-w-0 items-center justify-between gap-4 p-5">
    <dt className="min-w-0 break-words text-sm leading-6">{label}</dt>
    <dd className="shrink-0 text-right text-3xl font-bold leading-tight tabular-nums text-[var(--fastui-focus)]">{value}</dd>
  </div>
}
