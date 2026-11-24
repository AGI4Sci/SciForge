export type PanelGeometry = { x: number; y: number; width: number; height: number }
export function clampPanelGeometry(value: PanelGeometry, viewport: { width: number; height: number }): PanelGeometry {
  const width = Math.min(viewport.width, Math.max(300, value.width))
  const height = Math.min(viewport.height, Math.max(260, value.height))
  return { x: Math.max(0, Math.min(value.x, viewport.width - width)), y: Math.max(0, Math.min(value.y, viewport.height - height)), width, height }
}
