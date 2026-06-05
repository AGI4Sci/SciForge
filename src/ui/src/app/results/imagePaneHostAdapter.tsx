import {
  renderImageEvidenceViewer,
  type ImageEvidencePayload,
} from '../../../../../packages/presentation/components';
import { X } from 'lucide-react';
import { useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from 'react';
import type { RuntimeArtifact, SciForgeConfig, SciForgeRun, SciForgeSession } from '../../domain';
import { resultText, type ResultLocale } from './resultLocale';
import { rightPaneImageEvidencePayload } from './imagePaneModel';

export interface RightPaneImageEvidenceSlot {
  componentId: 'image-evidence-viewer';
  title: string;
  props: Record<string, unknown>;
}

export function rightPaneImageEvidenceSlot({
  payload,
  locale,
}: {
  payload?: ImageEvidencePayload;
  locale?: ResultLocale;
}): RightPaneImageEvidenceSlot {
  return {
    componentId: 'image-evidence-viewer',
    title: resultText(locale, { 'zh-CN': '图片', 'en-US': 'Image' }),
    props: { ...(payload ?? {
      sourceKind: 'artifact',
      imageRef: '',
      ref: '',
      status: 'empty',
    }) },
  };
}

export function rightPaneImageEvidenceArtifact(payload?: ImageEvidencePayload): RuntimeArtifact {
  return {
    id: 'right-pane-image-evidence',
    type: 'image-evidence',
    producerScenario: 'computer-use',
    schemaVersion: 'sciforge.image-evidence.payload.v1',
    data: payload ?? {},
  };
}

type ImageEvidenceViewMode = 'fit' | 'zoom' | 'pan' | 'actual-size';

interface ImageEvidenceViewState {
  mode: ImageEvidenceViewMode;
  scale: number;
  panX: number;
  panY: number;
}

interface ImageEvidenceDragState {
  pointerId: number;
  startX: number;
  startY: number;
  panX: number;
  panY: number;
  moved: boolean;
}

interface OriginalImagePreviewState {
  imageUrl: string;
  imageRef?: string;
}

const IMAGE_EVIDENCE_FIT_VIEW_STATE: ImageEvidenceViewState = {
  mode: 'fit',
  scale: 1,
  panX: 0,
  panY: 0,
};

const IMAGE_EVIDENCE_MIN_SCALE = 1;
const IMAGE_EVIDENCE_MAX_SCALE = 8;
const IMAGE_EVIDENCE_SCALE_STEP = 1.25;

export function RightPaneImageEvidenceTool({
  config,
  session,
  activeRun,
  payload: providedPayload,
  locale,
}: {
  config: SciForgeConfig;
  session: SciForgeSession;
  activeRun?: SciForgeRun;
  payload?: ImageEvidencePayload;
  locale?: ResultLocale;
}) {
  const payload = providedPayload ?? rightPaneImageEvidencePayload(session, activeRun);
  const [imageViewState, setImageViewState] = useState<ImageEvidenceViewState>(IMAGE_EVIDENCE_FIT_VIEW_STATE);
  const [imageDragging, setImageDragging] = useState(false);
  const [imageProvenanceOpen, setImageProvenanceOpen] = useState(false);
  const [originalImagePreview, setOriginalImagePreview] = useState<OriginalImagePreviewState>();
  const dragRef = useRef<ImageEvidenceDragState | null>(null);
  const suppressPreviewOpenRef = useRef(false);
  const imageViewStyle = useMemo(() => imageEvidenceViewStyle(imageViewState), [imageViewState]);

  function handleImageEvidenceControlClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target instanceof Element ? event.target : undefined;
    const controlElement = target?.closest<HTMLElement>('[data-view-control]');
    if (!controlElement) return;
    if (controlElement instanceof HTMLButtonElement && controlElement.disabled) return;
    const control = controlElement.dataset.viewControl;
    const imageRef = controlElement.dataset.imageRef;
    const imageUrl = controlElement.dataset.imageUrl;
    if (isImageEvidenceViewControl(control)) {
      event.preventDefault();
      event.stopPropagation();
      setImageViewState((state) => nextImageEvidenceViewState(state, control));
      return;
    }
    if (control === 'copy-ref' && imageRef) {
      event.preventDefault();
      event.stopPropagation();
      if (typeof navigator !== 'undefined') void navigator.clipboard?.writeText(imageRef);
      return;
    }
    if (control === 'open-original' && imageUrl) {
      event.preventDefault();
      event.stopPropagation();
      const previewClick = controlElement.classList.contains('image-evidence-preview-button');
      if (previewClick && (suppressPreviewOpenRef.current || imageViewState.mode === 'pan' || imageViewState.mode === 'actual-size')) {
        suppressPreviewOpenRef.current = false;
        return;
      }
      void openImageEvidenceUrl(imageUrl).then((openedExternally) => {
        if (!openedExternally) setOriginalImagePreview({ imageUrl, imageRef });
      });
      return;
    }
    if (control === 'download-image' && imageUrl) {
      event.preventDefault();
      event.stopPropagation();
      downloadImageEvidenceUrl(imageUrl, imageRef);
      return;
    }
    if (control === 'provenance') {
      event.preventDefault();
      event.stopPropagation();
      const surface = event.currentTarget;
      setImageProvenanceOpen((open) => {
        const nextOpen = !open;
        if (nextOpen) requestImageProvenanceScroll(surface);
        return nextOpen;
      });
    }
  }

  function handleOriginalImagePreviewBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) setOriginalImagePreview(undefined);
  }

  function handleImageEvidencePointerDown(event: PointerEvent<HTMLDivElement>) {
    const target = event.target instanceof Element ? event.target : undefined;
    if (!target?.closest('.image-evidence-preview-button')) return;
    if (!canDragImageEvidenceView(imageViewState)) return;
    event.preventDefault();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panX: imageViewState.panX,
      panY: imageViewState.panY,
      moved: false,
    };
    setImageDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleImageEvidencePointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) drag.moved = true;
    suppressPreviewOpenRef.current = drag.moved;
    setImageViewState((state) => ({
      ...state,
      panX: drag.panX + deltaX,
      panY: drag.panY + deltaY,
    }));
  }

  function handleImageEvidencePointerUp(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    suppressPreviewOpenRef.current = drag.moved;
    dragRef.current = null;
    setImageDragging(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return (
    <div
      className="right-pane-package-surface right-pane-image-evidence-surface"
      data-testid="right-pane-image-evidence-tool"
      data-host-presentation-boundary="image-evidence-ref-only"
      data-host-image-control-boundary="workspace-preview"
      data-host-presentation-ready={payload?.imageRef ? 'true' : 'false'}
      data-image-view-mode={imageViewState.mode}
      data-image-dragging={imageDragging ? 'true' : undefined}
      data-image-provenance-expanded={imageProvenanceOpen ? 'true' : undefined}
      style={imageViewStyle}
      onClick={handleImageEvidenceControlClick}
      onPointerDown={handleImageEvidencePointerDown}
      onPointerMove={handleImageEvidencePointerMove}
      onPointerUp={handleImageEvidencePointerUp}
      onPointerCancel={handleImageEvidencePointerUp}
    >
      {renderImageEvidenceViewer({
        slot: rightPaneImageEvidenceSlot({ payload, locale }),
        artifact: rightPaneImageEvidenceArtifact(payload),
        config,
        session,
      })}
      {originalImagePreview ? (
        <div
          className="image-evidence-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Image preview"
          onClick={handleOriginalImagePreviewBackdropClick}
        >
          <div className="image-evidence-modal-shell">
            <header className="image-evidence-modal-header">
              <div>
                <p className="image-evidence-kicker">Original</p>
                <strong>{imageEvidenceFileName(originalImagePreview.imageRef)}</strong>
              </div>
              <button
                type="button"
                className="image-evidence-modal-close"
                aria-label="Close image preview"
                onClick={() => setOriginalImagePreview(undefined)}
              >
                <X size={15} aria-hidden />
              </button>
            </header>
            <div className="image-evidence-modal-stage">
              <img
                className="image-evidence-modal-image"
                src={originalImagePreview.imageUrl}
                alt="Original image preview"
              />
            </div>
            {originalImagePreview.imageRef ? (
              <code className="image-evidence-modal-ref">{originalImagePreview.imageRef}</code>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function imageEvidenceViewStyle(state: ImageEvidenceViewState): CSSProperties {
  return {
    '--image-evidence-scale': state.scale,
    '--image-evidence-pan-x': `${Math.round(state.panX)}px`,
    '--image-evidence-pan-y': `${Math.round(state.panY)}px`,
  } as CSSProperties;
}

function isImageEvidenceViewControl(control: string | undefined): control is 'zoom-in' | 'zoom-out' | 'fit' | 'actual-size' | 'pan' {
  return control === 'zoom-in'
    || control === 'zoom-out'
    || control === 'fit'
    || control === 'actual-size'
    || control === 'pan';
}

function nextImageEvidenceViewState(state: ImageEvidenceViewState, control: 'zoom-in' | 'zoom-out' | 'fit' | 'actual-size' | 'pan'): ImageEvidenceViewState {
  switch (control) {
    case 'zoom-in': {
      return {
        ...state,
        mode: 'zoom',
        scale: imageEvidenceScale(state.scale * IMAGE_EVIDENCE_SCALE_STEP),
      };
    }
    case 'zoom-out': {
      const scale = imageEvidenceScale(state.scale / IMAGE_EVIDENCE_SCALE_STEP);
      return scale <= IMAGE_EVIDENCE_MIN_SCALE
        ? IMAGE_EVIDENCE_FIT_VIEW_STATE
        : { ...state, mode: 'zoom', scale };
    }
    case 'fit':
      return IMAGE_EVIDENCE_FIT_VIEW_STATE;
    case 'actual-size':
      return { mode: 'actual-size', scale: 1, panX: 0, panY: 0 };
    case 'pan':
      return state.mode === 'pan'
        ? { ...state, mode: state.scale <= 1 ? 'fit' : 'zoom' }
        : {
          ...state,
          mode: 'pan',
          scale: state.mode === 'fit' ? IMAGE_EVIDENCE_SCALE_STEP : state.scale,
        };
  }
}

function imageEvidenceScale(scale: number) {
  return Math.min(IMAGE_EVIDENCE_MAX_SCALE, Math.max(IMAGE_EVIDENCE_MIN_SCALE, Number(scale.toFixed(3))));
}

function canDragImageEvidenceView(state: ImageEvidenceViewState) {
  return state.mode === 'pan' || state.mode === 'actual-size';
}

function requestImageProvenanceScroll(surface: HTMLElement) {
  const provenancePanel = surface.querySelector<HTMLElement>('[data-image-provenance-panel]');
  if (!provenancePanel) return;
  const scroll = () => provenancePanel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(scroll);
    return;
  }
  scroll();
}

async function openImageEvidenceUrl(imageUrl: string): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const openExternal = window.sciforgeDesktop?.openExternal;
  if (typeof openExternal === 'function') {
    try {
      await openExternal(imageUrl);
      return true;
    } catch {
      // Browser-only previews fall back to the in-app image dialog.
    }
  }
  return false;
}

function downloadImageEvidenceUrl(imageUrl: string, imageRef?: string) {
  if (typeof document === 'undefined') {
    void openImageEvidenceUrl(imageUrl);
    return;
  }
  const anchor = document.createElement('a');
  anchor.href = imageUrl;
  anchor.download = imageEvidenceFileName(imageRef);
  anchor.rel = 'noopener noreferrer';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function imageEvidenceFileName(imageRef?: string) {
  const trimmed = imageRef?.trim();
  if (!trimmed) return 'image';
  const path = trimmed.split(/[?#]/)[0] ?? trimmed;
  return path.split('/').filter(Boolean).pop()?.replace(/[\\:*?"<>|]+/g, '-') || 'image';
}
