const reservedWindowsFileNamePattern = /^(?:(?:con|prn|aux|nul|clock\$|conin\$|conout\$)|(?:com|lpt)[1-9¹²³])(?:\..*)?$/iu

/** One path component that materializes with the same meaning on macOS, Windows, and Linux. */
export function isPortableWorkspacePathSegment(value) {
  if (
    value.length === 0 ||
    value === '.' ||
    value === '..' ||
    /[<>:"/\\|?*]/u.test(value) ||
    /[. ]$/u.test(value) ||
    reservedWindowsFileNamePattern.test(value)
  ) {
    return false
  }
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (codePoint <= 0x1f || codePoint === 0x7f) return false
  }
  return true
}

/** Stable comparison key for file systems whose ordinary configuration is case-insensitive. */
export function portableWorkspacePathComparisonKey(value) {
  return value
    .normalize('NFD')
    .toLocaleUpperCase('en-US')
    .toLocaleLowerCase('en-US')
    .normalize('NFD')
}
