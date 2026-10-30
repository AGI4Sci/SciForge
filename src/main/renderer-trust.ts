export function isTrustedRendererUrl(candidate: string, expected: string): boolean {
  try {
    const candidateUrl = new URL(candidate)
    const expectedUrl = new URL(expected)
    return candidateUrl.protocol === expectedUrl.protocol &&
      candidateUrl.username === expectedUrl.username &&
      candidateUrl.password === expectedUrl.password &&
      candidateUrl.hostname === expectedUrl.hostname &&
      candidateUrl.port === expectedUrl.port &&
      candidateUrl.pathname === expectedUrl.pathname &&
      candidateUrl.search === expectedUrl.search
  } catch {
    return false
  }
}
