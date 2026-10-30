import type { BrowserPresentationInput } from '../contract'

/** DOM hit-testing also catches host routes and custom overlays without ARIA roles. */
export function measureNativeBrowserViewport(element: HTMLElement, active: boolean): BrowserPresentationInput {
  const rect = element.getBoundingClientRect()
  let left = Math.max(0, rect.left)
  let top = Math.max(0, rect.top)
  let right = Math.min(window.innerWidth, rect.right)
  let bottom = Math.min(window.innerHeight, rect.bottom)
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent)
    const bounds = parent.getBoundingClientRect()
    if (/(hidden|clip|auto|scroll)/u.test(style.overflowX)) {
      left = Math.max(left, bounds.left); right = Math.min(right, bounds.right)
    }
    if (/(hidden|clip|auto|scroll)/u.test(style.overflowY)) {
      top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom)
    }
  }
  const overlayIntersects = [...document.querySelectorAll(
    '[role="dialog"], [role="alertdialog"], [role="menu"], [role="tooltip"], dialog[open], [data-radix-popper-content-wrapper]'
  )].some(overlay => {
    if (overlay.contains(element) || element.contains(overlay)) return false
    const bounds = overlay.getBoundingClientRect()
    const style = getComputedStyle(overlay)
    return style.visibility !== 'hidden' && style.display !== 'none' && bounds.width > 0 && bounds.height > 0
      && bounds.right > left && bounds.left < right && bounds.bottom > top && bounds.top < bottom
  })
  const covered = [
    [left + 1, top + 1], [right - 1, top + 1],
    [left + 1, bottom - 1], [right - 1, bottom - 1],
    [(left + right) / 2, (top + bottom) / 2]
  ].some(([x, y]) => !element.contains(document.elementFromPoint(x, y)))
  const visible = active && !document.hidden && !overlayIntersects && !covered
    && element.checkVisibility({ opacityProperty: true, visibilityProperty: true })
    && right > left && bottom > top
  return {
    x: Math.min(32768, Math.max(0, left)), y: Math.min(32768, Math.max(0, top)),
    width: Math.min(8192, Math.max(0, right - left)),
    height: Math.min(8192, Math.max(0, bottom - top)), visible
  }
}
