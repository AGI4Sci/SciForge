export const SIDEBAR_THREAD_MAIN_SELECTOR = '[data-sidebar-thread-main="true"]';

export function sidebarThreadKeyboardTargetIndex({
  key,
  currentIndex,
  total,
}: {
  key: string;
  currentIndex: number;
  total: number;
}): number | undefined {
  if (!Number.isInteger(currentIndex) || !Number.isInteger(total) || total <= 0) return undefined;
  if (currentIndex < 0 || currentIndex >= total) return undefined;
  if (key === 'ArrowDown') return Math.min(total - 1, currentIndex + 1);
  if (key === 'ArrowUp') return Math.max(0, currentIndex - 1);
  if (key === 'Home') return 0;
  if (key === 'End') return total - 1;
  return undefined;
}
