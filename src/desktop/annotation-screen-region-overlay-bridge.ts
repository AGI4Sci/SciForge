export const DESKTOP_ANNOTATION_SCREEN_REGION_OVERLAY_BRIDGE_SCHEMA =
  'sciforge.desktop.annotation-screen-region-overlay-bridge.v1' as const;

export const DESKTOP_ANNOTATION_OVERLAY_INTERNAL_EVENT_SCHEMA =
  'sciforge.desktop.annotation-overlay.internal-event.v1' as const;

export const DESKTOP_ANNOTATION_OVERLAY_INTERNAL_EVENT_CHANNEL =
  'desktop:annotation-overlay:internal-event' as const;

export type DesktopAnnotationScreenRegionOverlayBridge = {
  trusted: true;
};

export function createTrustedDesktopAnnotationScreenRegionOverlayBridge(): DesktopAnnotationScreenRegionOverlayBridge {
  return { trusted: true };
}
