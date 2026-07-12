/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SYNC_URL?: string
  readonly VITE_SYNC_TOKEN?: string
  readonly VITE_LANG?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
