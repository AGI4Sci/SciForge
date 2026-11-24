import type { BrowserPresentationInput } from '../contract'
import { measureNativeViewViewport } from '@sciforge/domain-sdk/renderer'

export function measureNativeBrowserViewport(element: HTMLElement, active: boolean): BrowserPresentationInput {
  return measureNativeViewViewport(element, active)
}
