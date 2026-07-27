const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const SSH_ALIAS_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export function requireIdentifier(value: string, label: string): string {
  const normalized = value.trim()
  if (
    !normalized ||
    normalized.length > 128 ||
    normalized === '.' ||
    normalized === '..' ||
    !IDENTIFIER_PATTERN.test(normalized)
  ) {
    throw new Error(`${label} may only contain letters, numbers, dots, underscores, and hyphens.`)
  }
  return normalized
}

/**
 * Only OpenSSH Host aliases are accepted at the process boundary. In particular,
 * destinations such as user@host and command-line option prefixes are rejected so
 * stored data cannot change the meaning of the argv assembled by the service.
 */
export function requireSshAlias(value: string, label = 'SSH alias'): string {
  const normalized = value.trim()
  if (
    !normalized ||
    normalized.length > 253 ||
    normalized === '.' ||
    normalized === '..' ||
    !SSH_ALIAS_PATTERN.test(normalized)
  ) {
    throw new Error(`${label} must be a plain OpenSSH Host alias containing only letters, numbers, dots, underscores, and hyphens.`)
  }
  return normalized
}

export function requireDisplayName(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > 160 || /[\0\r\n]/.test(normalized)) {
    throw new Error(`${label} is invalid.`)
  }
  return normalized
}

export function requirePositiveLimit(value: number, label: string, maximum = 128): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${label} must be an integer between 1 and ${maximum}.`)
  }
  return value
}

export function requireWorkspaceId(value: string): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > 4_096 || normalized.includes('\0')) {
    throw new Error('Workspace scope is required.')
  }
  return normalized
}

export function requireRemotePath(value: string): string {
  const normalized = value.trim()
  if (
    !normalized ||
    normalized.length > 4_096 ||
    /[\0\r\n]/.test(normalized) ||
    normalized.startsWith('-')
  ) {
    throw new Error('Remote path is invalid.')
  }
  return normalized
}

export function quoteSftpPath(value: string): string {
  if (!value || /[\0\r\n]/.test(value)) throw new Error('SFTP path contains a control separator.')
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

export function requireTimeout(value: number | undefined, fallback: number): number {
  const timeout = value ?? fallback
  if (!Number.isSafeInteger(timeout) || timeout < 1_000 || timeout > 24 * 60 * 60_000) {
    throw new Error('Timeout must be between 1 second and 24 hours.')
  }
  return timeout
}

export function requireScript(value: string): string {
  if (!value.trim()) throw new Error('Remote script is required.')
  if (Buffer.byteLength(value, 'utf8') > 1024 * 1024) {
    throw new Error('Remote script exceeds the 1 MiB limit.')
  }
  if (value.includes('\0')) throw new Error('Remote script contains a null byte.')
  return value
}

export function redactProcessOutput(value: string): string {
  return value
    .replace(
      /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-\r\n]*PRIVATE KEY-----|$)/g,
      '[REDACTED PRIVATE KEY]'
    )
    .replace(/\b(Authorization\s*:\s*Bearer\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(
      /\b([A-Z0-9_]*(?:TOKEN|PASSWORD|PASSWD|SECRET|API_KEY|ACCESS_KEY)[A-Z0-9_]*\s*=\s*)([^\s\r\n]+)/gi,
      '$1[REDACTED]'
    )
}
