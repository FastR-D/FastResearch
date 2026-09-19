/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  readonly VITE_READ_URL?: string
  readonly VITE_WRITE_URL?: string
  readonly VITE_FASTTASK_URL?: string
  readonly VITE_FASTNEWS_URL?: string
  readonly VITE_FASTPPT_URL?: string
  readonly VITE_FASTLAB_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}