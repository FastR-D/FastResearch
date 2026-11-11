import { useSyncExternalStore } from 'react'
import { initColorMode } from '@fastrd/ui-foundation'

// News on the same origin uses this existing preference too.
const colorMode = initColorMode({ storageKey: 'fastresearch-theme' })

export function useColorMode() {
  const dark = useSyncExternalStore(
    listener => colorMode.subscribe(listener),
    () => colorMode.resolved === 'dark',
  )
  return { dark, toggle: () => colorMode.setMode(dark ? 'light' : 'dark') }
}
