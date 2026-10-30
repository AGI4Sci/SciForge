export { isSafeExternalUrl } from '@shared/external-url-policy'
import { normalizeSafeExternalUrl } from '@shared/external-url-policy'

export async function openSafeExternalUrl(value: string | null | undefined): Promise<boolean> {
  const trimmed = normalizeSafeExternalUrl(value)
  if (!trimmed) return false
  const targetWindow = typeof window === 'undefined' ? null : window
  if (!targetWindow) return false
  if (typeof targetWindow.sciforge?.openExternal === 'function') {
    await targetWindow.sciforge.openExternal(trimmed)
    return true
  }
  targetWindow.open(trimmed, '_blank', 'noopener,noreferrer')
  return true
}
