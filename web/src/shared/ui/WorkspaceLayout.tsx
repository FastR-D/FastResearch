import { ListRow, PanelHeader } from '@fastrd/ui-react'
import type { ReactNode } from 'react'

// Standard layout utilities provide reading space; FastUI owns the surfaces.
export function PanelBody({ children }: { children: ReactNode }) {
  return <div className="grid gap-6 p-5 md:p-8 text-sm leading-7">{children}</div>
}

export function PanelHeading({ children }: { children: ReactNode }) {
  return <PanelHeader><div className="flex w-full flex-wrap items-center gap-3 py-2 text-sm">{children}</div></PanelHeader>
}

export function PanelRow({ children }: { children: ReactNode }) {
  return <ListRow><div className="flex w-full min-w-0 flex-wrap items-center gap-4 py-2 text-sm leading-6">{children}</div></ListRow>
}
