/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_READ_URL?: string
  readonly VITE_WRITE_URL?: string
  readonly VITE_FASTTASK_URL?: string
  readonly VITE_FASTNEWS_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
