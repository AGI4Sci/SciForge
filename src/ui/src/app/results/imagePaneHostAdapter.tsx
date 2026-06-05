import {
  renderImageEvidenceViewer,
  type ImageEvidencePayload,
} from '../../../../../packages/presentation/components';
import { CheckCircle2, Copy, Eye, History, PencilLine, X } from 'lucide-react';
import { useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { RuntimeArtifact, SciForgeConfig, SciForgeRun, SciForgeSession } from '../../domain';
import { resultText, type ResultLocale } from './resultLocale';
import { rightPaneImageEvidencePayload } from './imagePaneModel';
import { ImageAnnotationEditor } from './ImageAnnotationEditor';
import {
  createImageAnnotationDocument,
  exportSizeForAnnotationDocument,
  type ImageAnnotationDocument,
  type ImageAnnotationSize,
} from './imageAnnotationModel';
import { rasterizeImageAnnotationToPngBlob } from './imageAnnotationRasterizer';
import { saveImageAnnotationArtifact } from './imageAnnotationSaveAdapter';

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
  sourceImageUrl: string;
  sourceImageRef?: string;
  document: ImageAnnotationDocument;
  editorMode: 'readonly' | 'editing';
  dirty: boolean;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  savedPayload?: ImageEvidencePayload;
  error?: string;
}

interface SavedImageEditRecord {
  id: string;
  payload: ImageEvidencePayload;
  document: ImageAnnotationDocument;
  imageUrl: string;
  sourceImageUrl: string;
  sourceImageRef?: string;
  savedAt: string;
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
  const basePayload = providedPayload ?? rightPaneImageEvidencePayload(session, activeRun);
  const [focusedImagePayload, setFocusedImagePayload] = useState<ImageEvidencePayload>();
  const payload = focusedImagePayload ?? basePayload;
  const [imageViewState, setImageViewState] = useState<ImageEvidenceViewState>(IMAGE_EVIDENCE_FIT_VIEW_STATE);
  const [imageDragging, setImageDragging] = useState(false);
  const [imageProvenanceOpen, setImageProvenanceOpen] = useState(false);
  const [originalImagePreview, setOriginalImagePreview] = useState<OriginalImagePreviewState>();
  const [savedImageEdits, setSavedImageEdits] = useState<SavedImageEditRecord[]>([]);
  const dragRef = useRef<ImageEvidenceDragState | null>(null);
  const suppressPreviewOpenRef = useRef(false);
  const imageViewStyle = useMemo(() => imageEvidenceViewStyle(imageViewState), [imageViewState]);
  const originalImagePreviewModal = originalImagePreview ? (
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
            onClick={() => { void closeOriginalImagePreview({ closeModal: true }); }}
          >
            <X size={15} aria-hidden />
          </button>
        </header>
        <div className="image-evidence-modal-stage">
          <ImageAnnotationEditor
            imageUrl={originalImagePreview.imageUrl}
            imageRef={originalImagePreview.imageRef ?? ''}
            document={originalImagePreview.document}
            mode={originalImagePreview.editorMode}
            saveState={originalImagePreview.saveState}
            dirty={originalImagePreview.dirty}
            error={originalImagePreview.error}
            onChange={handleOriginalImageEditorChange}
            onNaturalSizeChange={handleOriginalImageNaturalSizeChange}
            onEdit={() => setOriginalImagePreview((state) => state ? { ...state, editorMode: 'editing' } : state)}
            onCancel={() => { void closeOriginalImagePreview({ closeModal: originalImagePreview.editorMode !== 'editing' }); }}
            onSave={() => { void handleOriginalImageEditorSave(); }}
            onOpenOriginal={() => { void openImageEvidenceUrl(originalImagePreview.sourceImageUrl); }}
          />
        </div>
        {originalImagePreview.savedPayload ? (
          <ImageEditSavedNotice
            payload={originalImagePreview.savedPayload}
            onView={() => handleViewSavedImagePayload(originalImagePreview.savedPayload)}
            onCopy={() => handleCopySavedImageRef(originalImagePreview.savedPayload)}
          />
        ) : null}
        {originalImagePreview.imageRef ? (
          <code className="image-evidence-modal-ref">{originalImagePreview.imageRef}</code>
        ) : null}
      </div>
    </div>
  ) : null;

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
        if (!openedExternally) setOriginalImagePreview(originalImagePreviewState({ imageUrl, imageRef, payload }));
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
    if (event.target === event.currentTarget) void closeOriginalImagePreview({ closeModal: true });
  }

  function handleOriginalImageEditorChange(nextDocument: ImageAnnotationDocument) {
    setOriginalImagePreview((state) => state ? {
      ...state,
      document: nextDocument,
      dirty: true,
      saveState: state.saveState === 'saved' ? 'idle' : state.saveState,
      error: undefined,
    } : state);
  }

  function handleOriginalImageNaturalSizeChange(size: ImageAnnotationSize) {
    setOriginalImagePreview((state) => {
      if (!state) return state;
      const sameSize = state.document.sourceNaturalSize.width === size.width
        && state.document.sourceNaturalSize.height === size.height;
      if (sameSize) return state;
      const nextDocument = {
        ...state.document,
        sourceNaturalSize: size,
        export: { format: 'png' as const, ...exportSizeForAnnotationDocument({ sourceNaturalSize: size, crop: state.document.crop }) },
      };
      return { ...state, document: nextDocument };
    });
  }

  async function handleOriginalImageEditorSave() {
    const state = originalImagePreview;
    if (!state) return;
    await saveOriginalImageEditorState(state);
  }

  async function closeOriginalImagePreview({ closeModal }: { closeModal: boolean }) {
    const state = originalImagePreview;
    if (!state || state.saveState === 'saving') return;
    if (state.editorMode === 'editing' && state.dirty) {
      const savedPayload = await saveOriginalImageEditorState(state);
      if (!savedPayload) return;
    }
    setOriginalImagePreview((current) => {
      if (!current) return current;
      return closeModal
        ? undefined
        : { ...current, editorMode: 'readonly', dirty: false, error: undefined };
    });
  }

  async function saveOriginalImageEditorState(state: OriginalImagePreviewState): Promise<ImageEvidencePayload | undefined> {
    const sourceRef = state.sourceImageRef ?? state.imageRef ?? state.document.sourceRef;
    if (!sourceRef) return undefined;
    setOriginalImagePreview((current) => current ? { ...current, saveState: 'saving', error: undefined } : current);
    try {
      const pngBlob = await rasterizeImageAnnotationToPngBlob(state.sourceImageUrl, state.document);
      const savedPayload = await saveImageAnnotationArtifact({
        sessionId: session.sessionId,
        sourceRef: state.sourceImageRef ?? state.imageRef ?? state.document.sourceRef,
        sourceNaturalSize: state.document.sourceNaturalSize,
        crop: state.document.crop ?? null,
        annotations: state.document.annotations,
        exportSize: state.document.export,
        pngBase64: await blobToBase64(pngBlob),
        workspaceConfig: config,
      });
      // Workspace-backed image editor save: focus the generated image in the Image pane only.
      setFocusedImagePayload(savedPayload);
      setImageViewState(IMAGE_EVIDENCE_FIT_VIEW_STATE);
      rememberSavedImageEdit({
        id: imageEditRecordId(savedPayload),
        payload: savedPayload,
        document: cloneImageAnnotationDocument(state.document),
        imageUrl: state.sourceImageUrl,
        sourceImageUrl: state.sourceImageUrl,
        sourceImageRef: sourceRef,
        savedAt: savedPayload.createdAt ?? new Date().toISOString(),
      });
      setOriginalImagePreview((current) => current ? {
        ...current,
        savedPayload,
        saveState: 'saved',
        dirty: false,
        error: undefined,
      } : current);
      return savedPayload;
    } catch (error) {
      setOriginalImagePreview((current) => current ? {
        ...current,
        saveState: 'error',
        error: error instanceof Error ? error.message : String(error),
      } : current);
      return undefined;
    }
  }

  function rememberSavedImageEdit(record: SavedImageEditRecord) {
    setSavedImageEdits((records) => [
      record,
      ...records.filter((item) => item.id !== record.id),
    ].slice(0, 12));
  }

  function handleViewSavedImagePayload(savedPayload?: ImageEvidencePayload) {
    if (!savedPayload) return;
    setFocusedImagePayload(savedPayload);
    setImageViewState(IMAGE_EVIDENCE_FIT_VIEW_STATE);
  }

  function handleViewSavedImageEdit(record: SavedImageEditRecord) {
    setFocusedImagePayload(record.payload);
    setImageViewState(IMAGE_EVIDENCE_FIT_VIEW_STATE);
  }

  function handleReEditSavedImageEdit(record: SavedImageEditRecord) {
    setFocusedImagePayload(record.payload);
    setImageViewState(IMAGE_EVIDENCE_FIT_VIEW_STATE);
    setOriginalImagePreview({
      imageUrl: record.sourceImageUrl,
      imageRef: record.sourceImageRef,
      sourceImageUrl: record.sourceImageUrl,
      sourceImageRef: record.sourceImageRef,
      document: cloneImageAnnotationDocument(record.document),
      editorMode: 'editing',
      dirty: false,
      saveState: 'idle',
      savedPayload: record.payload,
    });
  }

  function handleCopySavedImageRef(savedPayload?: ImageEvidencePayload) {
    const imageRef = savedPayload?.imageRef;
    if (imageRef && typeof navigator !== 'undefined') void navigator.clipboard?.writeText(imageRef);
  }

  function handleCopySavedImageEdit(record: SavedImageEditRecord) {
    handleCopySavedImageRef(record.payload);
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
      data-image-editor-state={originalImagePreview?.editorMode}
      data-image-dragging={imageDragging ? 'true' : undefined}
      data-image-provenance-expanded={imageProvenanceOpen ? 'true' : undefined}
      style={imageViewStyle}
      onClick={handleImageEvidenceControlClick}
      onPointerDown={handleImageEvidencePointerDown}
      onPointerMove={handleImageEvidencePointerMove}
      onPointerUp={handleImageEvidencePointerUp}
      onPointerCancel={handleImageEvidencePointerUp}
    >
      <ImageEditHistory
        records={savedImageEdits}
        onView={handleViewSavedImageEdit}
        onReEdit={handleReEditSavedImageEdit}
        onCopy={handleCopySavedImageEdit}
      />
      {renderImageEvidenceViewer({
        slot: rightPaneImageEvidenceSlot({ payload, locale }),
        artifact: rightPaneImageEvidenceArtifact(payload),
        config,
        session,
      })}
      {portalImageEvidenceModal(originalImagePreviewModal)}
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

function portalImageEvidenceModal(modal: ReactNode) {
  if (!modal) return null;
  if (typeof document === 'undefined') return modal;
  return createPortal(modal, document.body);
}

function originalImagePreviewState({
  imageUrl,
  imageRef,
  payload,
}: {
  imageUrl: string;
  imageRef?: string;
  payload?: ImageEvidencePayload;
}): OriginalImagePreviewState {
  const width = positiveImageDimension(payload?.width);
  const height = positiveImageDimension(payload?.height);
  return {
    imageUrl,
    imageRef,
    sourceImageUrl: imageUrl,
    sourceImageRef: imageRef ?? payload?.imageRef ?? payload?.ref,
    document: createImageAnnotationDocument({
      sourceRef: imageRef ?? payload?.imageRef ?? payload?.ref ?? '',
      sourceNaturalSize: { width, height },
      crop: payload?.cropBounds,
    }),
    editorMode: 'readonly',
    dirty: false,
    saveState: 'idle',
  };
}

function ImageEditHistory({
  records,
  onView,
  onReEdit,
  onCopy,
}: {
  records: SavedImageEditRecord[];
  onView: (record: SavedImageEditRecord) => void;
  onReEdit: (record: SavedImageEditRecord) => void;
  onCopy: (record: SavedImageEditRecord) => void;
}) {
  if (!records.length) return null;
  return (
    <section className="image-edit-history" data-image-edit-history="true" aria-label="Saved image edits">
      <header className="image-edit-history-header">
        <History size={14} aria-hidden />
        <div>
          <p className="image-evidence-kicker">Saved edits</p>
          <strong>{records.length} image{records.length === 1 ? '' : 's'}</strong>
        </div>
      </header>
      <div className="image-edit-history-list">
        {records.map((record, index) => (
          <article
            key={record.id}
            className="image-edit-history-item"
            data-image-edit-history-item="true"
            data-image-edit-record-id={record.id}
          >
            <div className="image-edit-history-meta">
              <CheckCircle2 size={14} aria-hidden />
              <div>
                <strong>Edit {records.length - index}</strong>
                <span>{formatImageEditTimestamp(record.savedAt)}</span>
                <code>{record.payload.imageRef}</code>
              </div>
            </div>
            <div className="image-edit-history-actions">
              <button type="button" data-image-edit-action="view-saved" onClick={(event) => { event.stopPropagation(); onView(record); }}>
                <Eye size={13} aria-hidden />
                <span>View</span>
              </button>
              <button type="button" data-image-edit-action="re-edit" onClick={(event) => { event.stopPropagation(); onReEdit(record); }}>
                <PencilLine size={13} aria-hidden />
                <span>Re-edit</span>
              </button>
              <button type="button" data-image-edit-action="copy-saved-ref" onClick={(event) => { event.stopPropagation(); onCopy(record); }}>
                <Copy size={13} aria-hidden />
                <span>Copy ref</span>
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ImageEditSavedNotice({
  payload,
  onView,
  onCopy,
}: {
  payload: ImageEvidencePayload;
  onView: () => void;
  onCopy: () => void;
}) {
  return (
    <section className="image-edit-saved-notice" data-image-edit-saved-notice="true">
      <div>
        <p className="image-evidence-kicker">Saved edit</p>
        <code>{payload.imageRef}</code>
      </div>
      <div className="image-edit-history-actions">
        <button type="button" data-image-edit-action="view-saved" onClick={onView}>
          <Eye size={13} aria-hidden />
          <span>View</span>
        </button>
        <button type="button" data-image-edit-action="copy-saved-ref" onClick={onCopy}>
          <Copy size={13} aria-hidden />
          <span>Copy ref</span>
        </button>
      </div>
    </section>
  );
}

function positiveImageDimension(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 1;
}

function imageEditRecordId(payload: ImageEvidencePayload) {
  return payload.artifactRef ?? payload.imageRef ?? payload.ref ?? payload.createdAt ?? 'image-edit';
}

function cloneImageAnnotationDocument(document: ImageAnnotationDocument): ImageAnnotationDocument {
  if (typeof structuredClone === 'function') return structuredClone(document);
  return JSON.parse(JSON.stringify(document)) as ImageAnnotationDocument;
}

function formatImageEditTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
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

async function blobToBase64(blob: Blob): Promise<string> {
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read generated image.'));
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        resolve(result.includes(',') ? result.split(',').pop() ?? '' : result);
      };
      reader.readAsDataURL(blob);
    });
  }
  const buffer = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
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
