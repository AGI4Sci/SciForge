export type ContentZoomDirection = 'in' | 'out'

type ContentZoomWheelEvent = Pick<WheelEvent, 'ctrlKey' | 'deltaY'>

export function resolveContentZoomWheel(event: ContentZoomWheelEvent): ContentZoomDirection | null {
  if (!event.ctrlKey || event.deltaY === 0) return null
  return event.deltaY < 0 ? 'in' : 'out'
}

export function clampContentScale(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(value, min), max)
}

export function stepContentScale(
  value: number,
  direction: 1 | -1,
  options: { min: number; max: number; step: number }
): number {
  return clampContentScale(Number((value + direction * options.step).toFixed(2)), options.min, options.max)
}
