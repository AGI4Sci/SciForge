import type { SciForgeApi } from '../shared/sciforge-api'

export type * from '../shared/sciforge-api'

declare global {
  interface Window {
    sciforge: SciForgeApi
  }
}
