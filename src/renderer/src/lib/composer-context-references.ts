/** Remove an exact contributed reference without changing a longer word containing it. */
export function removeComposerContextReference(text: string, token: string): string {
  if (!token) return text
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return text.replace(new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, 'gu'), '$1')
}
