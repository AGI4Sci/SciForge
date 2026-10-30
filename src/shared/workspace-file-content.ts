import { WORKSPACE_ATTACHMENT_MAX_BYTES } from '@sciforge/domain-sdk/attachment-policy'

export const MAX_WORKSPACE_BINARY_BODY_BASE64_CHARS = Math.ceil(WORKSPACE_ATTACHMENT_MAX_BYTES / 3) * 4

/** Validate canonical base64 and exact decoded length before allocating a Buffer. */
export function isBoundedWorkspaceBase64(content: string): boolean {
  if (content.length > MAX_WORKSPACE_BINARY_BODY_BASE64_CHARS || content.length % 4 !== 0) return false
  if (content.length === 0) return true
  const padding = content.endsWith('==') ? 2 : content.endsWith('=') ? 1 : 0
  const body = content.slice(0, content.length - padding)
  if (/[^A-Za-z0-9+/]/u.test(body)) return false
  const decodedBytes = content.length / 4 * 3 - padding
  if (decodedBytes > WORKSPACE_ATTACHMENT_MAX_BYTES) return false
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const finalSextet = alphabet.indexOf(body.at(-1) ?? '')
  if (padding === 2 && (finalSextet & 15) !== 0) return false
  if (padding === 1 && (finalSextet & 3) !== 0) return false
  return true
}
