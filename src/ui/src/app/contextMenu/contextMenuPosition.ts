export function fitContextMenuPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  viewport: { width: number; height: number } = {
    width: typeof window === 'undefined' ? 1280 : window.innerWidth,
    height: typeof window === 'undefined' ? 800 : window.innerHeight,
  },
) {
  const margin = 8;
  let nextX = x;
  let nextY = y;
  if (nextX + width > viewport.width - margin) {
    nextX = Math.max(margin, viewport.width - width - margin);
  }
  if (nextY + height > viewport.height - margin) {
    nextY = Math.max(margin, y - height);
  }
  if (nextY < margin) nextY = margin;
  return { x: nextX, y: nextY };
}

export function clampContextMenuPosition(x: number, y: number, width = 220, height = 320) {
  return fitContextMenuPosition(x, y, width, height);
}
