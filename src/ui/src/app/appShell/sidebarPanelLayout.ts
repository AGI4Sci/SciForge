export interface SidebarPanelLayout {
  threadsHeight: number;
  toolsHeight: number;
  threadsCollapsed: boolean;
  toolsCollapsed: boolean;
  explorerCollapsed: boolean;
}

const STORAGE_KEY = 'sciforge.sidebar.panelLayout';

export const SIDEBAR_PANEL_COLLAPSED_HEIGHT = 34;
export const SIDEBAR_PANEL_MIN_THREADS = 120;
export const SIDEBAR_PANEL_MIN_TOOLS = 72;
export const SIDEBAR_PANEL_MIN_EXPLORER = 120;
export const SIDEBAR_PANEL_DEFAULT_THREADS = 240;
export const SIDEBAR_PANEL_DEFAULT_TOOLS = 104;
export const SIDEBAR_PANEL_RESIZE_HANDLE = 6;

export function defaultSidebarPanelLayout(): SidebarPanelLayout {
  return {
    threadsHeight: SIDEBAR_PANEL_DEFAULT_THREADS,
    toolsHeight: SIDEBAR_PANEL_DEFAULT_TOOLS,
    threadsCollapsed: false,
    toolsCollapsed: false,
    explorerCollapsed: false,
  };
}

export function loadSidebarPanelLayout(): SidebarPanelLayout {
  if (typeof window === 'undefined') return defaultSidebarPanelLayout();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSidebarPanelLayout();
    const parsed = JSON.parse(raw) as Partial<SidebarPanelLayout>;
    return {
      threadsHeight: clampPanelHeight(parsed.threadsHeight, SIDEBAR_PANEL_MIN_THREADS, 640, SIDEBAR_PANEL_DEFAULT_THREADS),
      toolsHeight: clampPanelHeight(parsed.toolsHeight, SIDEBAR_PANEL_MIN_TOOLS, 240, SIDEBAR_PANEL_DEFAULT_TOOLS),
      threadsCollapsed: parsed.threadsCollapsed === true,
      toolsCollapsed: parsed.toolsCollapsed === true,
      explorerCollapsed: parsed.explorerCollapsed === true,
    };
  } catch {
    return defaultSidebarPanelLayout();
  }
}

export function saveSidebarPanelLayout(layout: SidebarPanelLayout): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
}

export function clampPanelHeight(value: unknown, min: number, max: number, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function clampSidebarPanelHeights(
  layout: SidebarPanelLayout,
  availableHeight: number,
): SidebarPanelLayout {
  const handles = SIDEBAR_PANEL_RESIZE_HANDLE * 2;
  const usable = Math.max(
    availableHeight - handles,
    SIDEBAR_PANEL_MIN_THREADS + SIDEBAR_PANEL_MIN_TOOLS + SIDEBAR_PANEL_MIN_EXPLORER,
  );
  let threadsHeight = layout.threadsHeight;
  let toolsHeight = layout.toolsHeight;
  if (!layout.threadsCollapsed) {
    const maxThreads = usable
      - (layout.toolsCollapsed ? SIDEBAR_PANEL_COLLAPSED_HEIGHT : toolsHeight)
      - (layout.explorerCollapsed ? SIDEBAR_PANEL_COLLAPSED_HEIGHT : SIDEBAR_PANEL_MIN_EXPLORER);
    threadsHeight = clampPanelHeight(threadsHeight, SIDEBAR_PANEL_MIN_THREADS, maxThreads, SIDEBAR_PANEL_DEFAULT_THREADS);
  }
  if (!layout.toolsCollapsed) {
    const maxTools = usable
      - (layout.threadsCollapsed ? SIDEBAR_PANEL_COLLAPSED_HEIGHT : threadsHeight)
      - (layout.explorerCollapsed ? SIDEBAR_PANEL_COLLAPSED_HEIGHT : SIDEBAR_PANEL_MIN_EXPLORER);
    toolsHeight = clampPanelHeight(toolsHeight, SIDEBAR_PANEL_MIN_TOOLS, maxTools, SIDEBAR_PANEL_DEFAULT_TOOLS);
  }
  if (!layout.threadsCollapsed && !layout.toolsCollapsed && !layout.explorerCollapsed) {
    const overflow = threadsHeight + toolsHeight + SIDEBAR_PANEL_MIN_EXPLORER + handles - availableHeight;
    if (overflow > 0) {
      toolsHeight = Math.max(SIDEBAR_PANEL_MIN_TOOLS, toolsHeight - overflow);
      const remaining = threadsHeight + toolsHeight + SIDEBAR_PANEL_MIN_EXPLORER + handles - availableHeight;
      if (remaining > 0) {
        threadsHeight = Math.max(SIDEBAR_PANEL_MIN_THREADS, threadsHeight - remaining);
      }
    }
  }
  if (
    threadsHeight === layout.threadsHeight
    && toolsHeight === layout.toolsHeight
  ) {
    return layout;
  }
  return { ...layout, threadsHeight, toolsHeight };
}

export function sidebarPanelBlockStyle(
  collapsed: boolean,
  height: number,
): { flex: string; minHeight?: number } {
  if (collapsed) return { flex: `0 0 ${SIDEBAR_PANEL_COLLAPSED_HEIGHT}px` };
  return { flex: `0 0 ${height}px`, minHeight: 0 };
}

export function sidebarExplorerPanelStyle(collapsed: boolean): { flex: string; minHeight?: number } {
  if (collapsed) return { flex: `0 0 ${SIDEBAR_PANEL_COLLAPSED_HEIGHT}px` };
  return { flex: '1 1 0', minHeight: 0 };
}
