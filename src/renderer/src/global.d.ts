import type { FrameLensApi } from '@shared/api'

declare global {
  interface Window {
    frameLens: FrameLensApi
  }
}

export {}
