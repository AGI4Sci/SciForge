/** Explicit overlay protocol: mounted host/domain overlays opt into native
 * surface occlusion with data-native-view-occluder="true". Closed overlays
 * remove the marker, unmount, or declare hidden/data-state="closed".
 * Consumers observe this attribute alongside layout and visibility changes.
 */
export function measureNativeViewViewport(element: HTMLElement, active: boolean): Readonly<{
  x: number; y: number; width: number; height: number; visible: boolean
}> {
  const document = element.ownerDocument
  const window = document.defaultView!
  const styleOf = window.getComputedStyle.bind(window)
  const rect = element.getBoundingClientRect()
  let left = Math.max(0, rect.left), top = Math.max(0, rect.top)
  let right = Math.min(window.innerWidth, rect.right), bottom = Math.min(window.innerHeight, rect.bottom)
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = styleOf(parent), bounds = parent.getBoundingClientRect()
    if (/(hidden|clip|auto|scroll)/u.test(style.overflowX)) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right) }
    if (/(hidden|clip|auto|scroll)/u.test(style.overflowY)) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom) }
  }
  const occluded = Array.from(document.querySelectorAll<HTMLElement>('[data-native-view-occluder="true"]')).some(overlay => {
    if (overlay.contains(element) || element.contains(overlay) || overlay.hidden || overlay.dataset.state === 'closed') return false
    if (!overlay.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false
    const bounds = overlay.getBoundingClientRect()
    return bounds.width > 0 && bounds.height > 0 && bounds.right > left && bounds.left < right && bounds.bottom > top && bounds.top < bottom
  })
  return { x: Math.min(32768, Math.max(0, left)), y: Math.min(32768, Math.max(0, top)),
    width: Math.min(8192, Math.max(0, right - left)), height: Math.min(8192, Math.max(0, bottom - top)),
    visible: active && !document.hidden && !occluded && right > left && bottom > top && element.checkVisibility({ opacityProperty: true, visibilityProperty: true }) }
}
