const SENSITIVE_SETTING_KEY = /(?:authorization|api[-_]?key|cookie|token|secret|password|credential)/i

/** Collects current credential values generically without provider-specific branches. */
export function traceSensitiveValuesFromSettings(settings: unknown): string[] {
  const values = new Set<string>()
  const visit = (value: unknown, key = ''): void => {
    if (typeof value === 'string') {
      const normalized = value.trim()
      if (normalized && SENSITIVE_SETTING_KEY.test(key)) values.add(normalized)
      return
    }
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, key)
      return
    }
    if (!value || typeof value !== 'object') return
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      visit(childValue, childKey)
    }
  }
  visit(settings)
  return [...values]
}

export class CurrentTraceSensitiveSettings {
  private current: unknown

  constructor(initial: unknown) {
    this.current = initial
  }

  update(settings: unknown): void {
    this.current = settings
  }

  readonly values = (): string[] => traceSensitiveValuesFromSettings(this.current)
}
