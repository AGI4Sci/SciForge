/** Human-facing labels only; Session routing always uses exact Runtime IDs. */
export function projectCoordinatorSessionTitle(
  displayName: string,
  purpose: 'Plan 草稿' | '需求补全' | '项目协调',
  version?: number
): string {
  const suffix = ` · ${purpose}${version ? ` v${Math.max(1, Math.floor(version))}` : ''}`
  const name = displayName.replace(/[\r\n\u0085\u2028\u2029]/gu, ' ').trim()
  let prefix = ''
  for (const character of name) {
    if (prefix.length + character.length + suffix.length > 200) break
    prefix += character
  }
  return `${prefix.trimEnd()}${suffix}`
}
