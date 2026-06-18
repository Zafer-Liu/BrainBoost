/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_NAME?: string
  readonly VITE_CLAUDE_BASE_URL?: string
  readonly VITE_LOG_SERVER?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
