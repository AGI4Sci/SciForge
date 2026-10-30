export type ThemePreference = 'system' | 'light' | 'dark'
export type UiFontScale = 'small' | 'medium' | 'large'

let removeSystemListener: (() => void) | null = null

function resolvedMode(pref: ThemePreference): 'light' | 'dark' {
  if (pref === 'dark') return 'dark'
  if (pref === 'light') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * Applies `data-theme` on `<html>` for Tailwind `dark:` variants and CSS variables.
 */
export function applyTheme(pref: ThemePreference): void {
  removeSystemListener?.()
  removeSystemListener = null

  const root = document.documentElement
  const apply = (): void => {
    const mode = resolvedMode(pref)
    root.setAttribute('data-theme', mode)
  }

  if (pref === 'system') {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => {
      apply()
    }
    mq.addEventListener('change', onChange)
    removeSystemListener = (): void => {
      mq.removeEventListener('change', onChange)
    }
  }

  apply()
}

export function applyUiFontScale(scale: UiFontScale): void {
  const root = document.documentElement
  const factor =
    scale === 'small'
      ? 0.82
      : scale === 'large'
        ? 1
        : 0.88
  const setNativeZoom = typeof window !== 'undefined'
    ? window.sciforge?.setUiZoomFactor
    : undefined

  if (setNativeZoom) {
    // Browser-level zoom keeps client coordinates, layout sizes, canvas buffers,
    // and device pixels in one coordinate system. CSS zoom does not, which
    // causes proportional picking offsets in WebGL viewers such as Mol*.
    root.style.setProperty('--ds-ui-scale', '1')
    setNativeZoom(factor)
    return
  }

  // Browser-only development and tests do not have Electron's webFrame bridge.
  root.style.setProperty('--ds-ui-scale', String(factor))
}

/**
 * Mirrors the active i18n locale onto `<html lang>` so screen readers,
 * browser spellcheck, and CSS `:lang()` selectors match the visible UI.
 */
export function applyDocumentLocale(locale: 'en' | 'zh'): void {
  const lang = locale === 'zh' ? 'zh-CN' : 'en'
  if (document.documentElement.getAttribute('lang') !== lang) {
    document.documentElement.setAttribute('lang', lang)
  }
}
