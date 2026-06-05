import {
  ArrowUpRight,
  Crop,
  Edit3,
  Eraser,
  Highlighter,
  MousePointer2,
  Pin,
  Redo2,
  Save,
  Square,
  Trash2,
  Type,
  Undo2,
  X,
  Zap,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import {
  createImageAnnotation,
  exportSizeForAnnotationDocument,
  moveImageAnnotation,
  updateImageAnnotationLabel,
  type ImageAnnotation,
  type ImageAnnotationDocument,
  type ImageAnnotationPoint,
  type ImageAnnotationRect,
  type ImageAnnotationSize,
  type RectImageAnnotation,
} from './imageAnnotationModel';

type ImageAnnotationTool = 'select' | 'crop' | 'pen' | 'arrow' | 'rect' | 'text' | 'pin' | 'highlight' | 'blur' | 'redact';
type ImageAnnotationEditorMode = 'readonly' | 'editing';
type ImageAnnotationSaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface ImageAnnotationEditorProps {
  imageUrl: string;
  imageRef: string;
  document: ImageAnnotationDocument;
  mode: ImageAnnotationEditorMode;
  saveState: ImageAnnotationSaveState;
  dirty?: boolean;
  error?: string;
  onChange: (nextDocument: ImageAnnotationDocument) => void;
  onCancel: () => void;
  onEdit?: () => void;
  onNaturalSizeChange?: (size: ImageAnnotationSize) => void;
  onSave: () => void;
  onOpenOriginal: () => void;
}

interface DraftState {
  tool: ImageAnnotationTool;
  start: ImageAnnotationPoint;
  annotation: ImageAnnotation;
}

interface DragState {
  pointerId: number;
  annotationId: string;
  start: ImageAnnotationPoint;
  origin: ImageAnnotation;
  current: ImageAnnotation;
  moved: boolean;
}

const TOOLS: Array<{ id: ImageAnnotationTool; label: string; icon: typeof MousePointer2 }> = [
  { id: 'select', label: 'Select', icon: MousePointer2 },
  { id: 'crop', label: 'Crop', icon: Crop },
  { id: 'pen', label: 'Pen', icon: Edit3 },
  { id: 'arrow', label: 'Arrow', icon: ArrowUpRight },
  { id: 'rect', label: 'Rectangle', icon: Square },
  { id: 'text', label: 'Text', icon: Type },
  { id: 'pin', label: 'Pin', icon: Pin },
  { id: 'highlight', label: 'Highlight', icon: Highlighter },
  { id: 'blur', label: 'Blur', icon: Zap },
  { id: 'redact', label: 'Redact', icon: Eraser },
];

const DEFAULT_TOOL_COLORS: Record<ImageAnnotationTool, string> = {
  select: '#facc15',
  crop: '#00e5a0',
  pen: '#facc15',
  arrow: '#38bdf8',
  rect: '#facc15',
  text: '#f8fafc',
  pin: '#00e5a0',
  highlight: '#facc15',
  blur: '#7dd3fc',
  redact: '#020617',
};

const COLOR_SWATCHES = ['#facc15', '#38bdf8', '#00e5a0', '#f97316', '#f8fafc', '#020617'];

export function ImageAnnotationEditor({
  imageUrl,
  imageRef,
  document,
  mode,
  saveState,
  dirty,
  error,
  onChange,
  onCancel,
  onEdit,
  onNaturalSizeChange,
  onSave,
  onOpenOriginal,
}: ImageAnnotationEditorProps) {
  const [selectedTool, setSelectedTool] = useState<ImageAnnotationTool>(mode === 'editing' ? 'pen' : 'select');
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string>();
  const [textValue, setTextValue] = useState('Label');
  const [toolColors, setToolColors] = useState<Record<ImageAnnotationTool, string>>(DEFAULT_TOOL_COLORS);
  const [undoStack, setUndoStack] = useState<ImageAnnotationDocument[]>([]);
  const [redoStack, setRedoStack] = useState<ImageAnnotationDocument[]>([]);
  const [draft, setDraft] = useState<DraftState>();
  const [drag, setDrag] = useState<DragState>();
  const overlayRef = useRef<SVGSVGElement | null>(null);
  const textInputRef = useRef<HTMLInputElement | null>(null);
  const sourceSize = safeImageSize(document.sourceNaturalSize);
  const viewBox = `0 0 ${sourceSize.width} ${sourceSize.height}`;
  const canEdit = mode === 'editing';
  const hasChanges = dirty ?? false;
  const saveDisabled = !canEdit || saveState === 'saving' || !hasChanges;
  const selectedAnnotation = useMemo(
    () => document.annotations.find((annotation) => annotation.id === selectedAnnotationId),
    [document.annotations, selectedAnnotationId],
  );
  const selectedCanEditLabel = canEdit && (selectedAnnotation?.type === 'text' || selectedAnnotation?.type === 'pin');
  const activeColor = colorForAnnotation(selectedAnnotation) ?? toolColors[selectedTool] ?? DEFAULT_TOOL_COLORS.pen;
  const visibleAnnotations = useMemo(() => {
    const withDraft = draft ? replaceOrAppendAnnotation(document.annotations, draft.annotation) : document.annotations;
    return drag ? replaceOrAppendAnnotation(withDraft, drag.current) : withDraft;
  }, [document.annotations, draft, drag]);

  useEffect(() => {
    if (!canEdit) setSelectedTool('select');
  }, [canEdit]);

  useEffect(() => {
    if (!selectedAnnotation) return;
    if (selectedAnnotation.type === 'text') setTextValue(selectedAnnotation.text || 'Label');
    if (selectedAnnotation.type === 'pin') setTextValue(selectedAnnotation.label || '1');
  }, [selectedAnnotation?.id, selectedAnnotation?.type, selectedAnnotationLabel(selectedAnnotation)]);

  function commitDocument(nextDocument: ImageAnnotationDocument) {
    setUndoStack((stack) => [...stack.slice(-19), document]);
    setRedoStack([]);
    onChange(nextDocument);
  }

  function applyUndo() {
    if (!canEdit) return;
    const previous = undoStack.at(-1);
    if (!previous) return;
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [...stack.slice(-19), document]);
    onChange(previous);
    if (selectedAnnotationId && !previous.annotations.some((annotation) => annotation.id === selectedAnnotationId)) {
      setSelectedAnnotationId(undefined);
    }
  }

  function applyRedo() {
    if (!canEdit) return;
    const next = redoStack.at(-1);
    if (!next) return;
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack.slice(-19), document]);
    onChange(next);
    if (selectedAnnotationId && !next.annotations.some((annotation) => annotation.id === selectedAnnotationId)) {
      setSelectedAnnotationId(undefined);
    }
  }

  function deleteSelectedAnnotation() {
    if (!canEdit || !selectedAnnotationId) return;
    commitDocument({
      ...document,
      annotations: document.annotations.filter((annotation) => annotation.id !== selectedAnnotationId),
    });
    setSelectedAnnotationId(undefined);
  }

  function handleColorChange(value: string) {
    const color = normalizeHexColor(value, activeColor);
    setToolColors((colors) => ({ ...colors, [selectedTool]: color }));
    if (!canEdit || !selectedAnnotation) return;
    const nextAnnotation = recolorImageAnnotation(selectedAnnotation, color);
    if (nextAnnotation === selectedAnnotation) return;
    commitDocument({
      ...document,
      annotations: replaceOrAppendAnnotation(document.annotations, nextAnnotation),
    });
  }

  function handleEditorKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      setDraft(undefined);
      setSelectedAnnotationId(undefined);
      if (!canEdit) onCancel();
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && selectedAnnotationId && canEdit) {
      event.preventDefault();
      deleteSelectedAnnotation();
      return;
    }
    if (canEdit && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) applyRedo();
      else applyUndo();
      return;
    }
    if (canEdit && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      applyRedo();
    }
  }

  function handleOverlayPointerDown(event: PointerEvent<SVGSVGElement>) {
    if (!canEdit) return;
    const point = pointFromPointer(event, overlayRef.current, sourceSize);
    if (!point) return;
    setSelectedAnnotationId(undefined);
    if (selectedTool === 'select') return;
    event.preventDefault();
    const nextAnnotation = annotationForTool(selectedTool, point, document.annotations.length + 1, textValue, toolColors[selectedTool]);
    if (!nextAnnotation) return;
    if (selectedTool === 'text' || selectedTool === 'pin') {
      commitDocument({ ...document, annotations: [...document.annotations, nextAnnotation] });
      setSelectedAnnotationId(nextAnnotation.id);
      focusEditableTextInput();
      return;
    }
    setDraft({ tool: selectedTool, start: point, annotation: nextAnnotation });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleOverlayPointerMove(event: PointerEvent<SVGSVGElement>) {
    if (!draft || !canEdit) return;
    const point = pointFromPointer(event, overlayRef.current, sourceSize);
    if (!point) return;
    event.preventDefault();
    setDraft({
      ...draft,
      annotation: updateDraftAnnotation(draft.annotation, draft.start, point),
    });
  }

  function handleOverlayPointerUp(event: PointerEvent<SVGSVGElement>) {
    if (!draft || !canEdit) return;
    event.preventDefault();
    const nextAnnotation = draft.annotation;
    setDraft(undefined);
    const nextCrop = draft.tool === 'crop' && nextAnnotation.type === 'rect'
      ? normalizedRect(nextAnnotation.rect)
      : document.crop;
    commitDocument({
      ...document,
      crop: nextCrop,
      export: { format: 'png', ...exportSizeForAnnotationDocument({ sourceNaturalSize: document.sourceNaturalSize, crop: nextCrop }) },
      annotations: draft.tool === 'crop'
        ? document.annotations
        : replaceOrAppendAnnotation(document.annotations, nextAnnotation),
    });
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handleAnnotationSelect(annotation: ImageAnnotation) {
    setSelectedAnnotationId(annotation.id);
    if (annotation.type === 'text') setTextValue(annotation.text || 'Label');
    if (annotation.type === 'pin') setTextValue(annotation.label || '1');
    if (annotation.type === 'text' || annotation.type === 'pin') focusEditableTextInput();
  }

  function focusEditableTextInput() {
    const focus = () => {
      textInputRef.current?.focus();
      textInputRef.current?.select();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(focus);
    else setTimeout(focus, 0);
  }

  function handleAnnotationPointerDown(event: PointerEvent<SVGElement>, annotation: ImageAnnotation) {
    event.preventDefault();
    event.stopPropagation();
    handleAnnotationSelect(annotation);
    if (!canEdit) return;
    const point = pointFromPointer(event, overlayRef.current, sourceSize);
    if (!point) return;
    setSelectedTool('select');
    setDraft(undefined);
    setDrag({
      pointerId: event.pointerId,
      annotationId: annotation.id,
      start: point,
      origin: annotation,
      current: annotation,
      moved: false,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleAnnotationPointerMove(event: PointerEvent<SVGElement>) {
    if (!drag || event.pointerId !== drag.pointerId || !canEdit) return;
    event.preventDefault();
    event.stopPropagation();
    const point = pointFromPointer(event, overlayRef.current, sourceSize);
    if (!point) return;
    const delta = { x: point.x - drag.start.x, y: point.y - drag.start.y };
    setDrag({
      ...drag,
      current: moveImageAnnotation(drag.origin, delta),
      moved: drag.moved || pointerMoved(delta),
    });
  }

  function handleAnnotationPointerUp(event: PointerEvent<SVGElement>) {
    if (!drag || event.pointerId !== drag.pointerId || !canEdit) return;
    event.preventDefault();
    event.stopPropagation();
    const point = pointFromPointer(event, overlayRef.current, sourceSize);
    const delta = point ? { x: point.x - drag.start.x, y: point.y - drag.start.y } : { x: 0, y: 0 };
    const moved = drag.moved || pointerMoved(delta);
    const finalAnnotation = moved ? moveImageAnnotation(drag.origin, delta) : drag.current;
    setDrag(undefined);
    if (moved) {
      commitDocument({
        ...document,
        annotations: replaceOrAppendAnnotation(document.annotations, finalAnnotation),
      });
    }
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handleAnnotationPointerCancel(event: PointerEvent<SVGElement>) {
    if (drag?.pointerId === event.pointerId) setDrag(undefined);
  }

  function handleTextValueChange(value: string) {
    setTextValue(value);
    if (!canEdit || !selectedAnnotationId) return;
    const selectedAnnotation = document.annotations.find((annotation) => annotation.id === selectedAnnotationId);
    if (!selectedAnnotation || (selectedAnnotation.type !== 'text' && selectedAnnotation.type !== 'pin')) return;
    const nextAnnotation = updateImageAnnotationLabel(selectedAnnotation, value);
    if (nextAnnotation === selectedAnnotation) return;
    commitDocument({
      ...document,
      annotations: replaceOrAppendAnnotation(document.annotations, nextAnnotation),
    });
  }

  return (
    <section
      className="image-annotation-editor"
      data-editor-mode={mode}
      data-source-image-ref={imageRef}
      data-save-state={saveState}
      data-editor-selection-id={selectedAnnotationId}
      data-editor-can-move-selected={selectedAnnotation ? 'true' : undefined}
      tabIndex={0}
      onKeyDown={handleEditorKeyDown}
    >
      <nav className="image-annotation-editor-toolbar" aria-label="Image annotation tools">
        {canEdit ? TOOLS.map((tool) => {
          const Icon = tool.icon;
          return (
            <button
              key={tool.id}
              type="button"
              className="image-annotation-tool"
              data-editor-tool={tool.id}
              data-active={selectedTool === tool.id ? 'true' : undefined}
              aria-pressed={selectedTool === tool.id}
              title={tool.label}
              onClick={() => setSelectedTool(tool.id)}
            >
              <Icon size={14} aria-hidden />
              <span>{tool.label}</span>
            </button>
          );
        }) : (
          <button
            type="button"
            className="image-annotation-tool"
            data-editor-action="edit"
            onClick={onEdit}
          >
            <Edit3 size={14} aria-hidden />
            <span>Edit</span>
          </button>
        )}
        {canEdit ? (
          <div className="image-annotation-color-controls" data-editor-color-control="true" aria-label="Annotation color">
            {COLOR_SWATCHES.map((color) => (
              <button
                key={color}
                type="button"
                className="image-annotation-color-swatch"
                data-editor-color-swatch={color}
                data-active={activeColor.toLowerCase() === color ? 'true' : undefined}
                aria-label={`Use ${color}`}
                title={`Use ${color}`}
                style={{ backgroundColor: color }}
                onClick={() => handleColorChange(color)}
              />
            ))}
            <input
              type="color"
              value={activeColor}
              data-editor-color-picker="true"
              aria-label="Annotation color"
              onChange={(event) => handleColorChange(event.currentTarget.value)}
            />
          </div>
        ) : null}
        <span className="image-annotation-editor-spacer" />
        <button type="button" className="image-annotation-action" data-editor-action="open-original" onClick={onOpenOriginal}>
          <ArrowUpRight size={14} aria-hidden />
          <span>Open original</span>
        </button>
        {canEdit ? (
          <>
            <button type="button" className="image-annotation-action" data-editor-action="undo" disabled={!undoStack.length} onClick={applyUndo}>
              <Undo2 size={14} aria-hidden />
              <span>Undo</span>
            </button>
            <button type="button" className="image-annotation-action" data-editor-action="redo" disabled={!redoStack.length} onClick={applyRedo}>
              <Redo2 size={14} aria-hidden />
              <span>Redo</span>
            </button>
            <button type="button" className="image-annotation-action" data-editor-action="delete" disabled={!selectedAnnotationId} onClick={deleteSelectedAnnotation}>
              <Trash2 size={14} aria-hidden />
              <span>Delete</span>
            </button>
          </>
        ) : null}
        <button type="button" className="image-annotation-action" data-editor-action="cancel" onClick={onCancel}>
          <X size={14} aria-hidden />
          {canEdit ? <span>Done</span> : <span>Close</span>}
        </button>
        <button
          type="button"
          className="image-annotation-action image-annotation-save"
          data-editor-action="save"
          disabled={saveDisabled}
          onClick={onSave}
        >
          <Save size={14} aria-hidden />
          <span>{saveState === 'saving' ? 'Saving' : 'Save'}</span>
        </button>
      </nav>
      <div
        className="image-annotation-editor-stage"
        data-readonly-image-open={!canEdit ? 'true' : undefined}
        data-editor-pointer-role={!canEdit ? 'open-original' : selectedTool === 'select' ? 'select' : 'draw'}
        onClick={!canEdit ? onOpenOriginal : undefined}
      >
        <div
          className="image-annotation-editor-frame"
          data-image-annotation-frame="source-pixel"
          style={{ aspectRatio: `${sourceSize.width} / ${sourceSize.height}` }}
        >
          <img
            className="image-annotation-editor-image"
            src={imageUrl}
            alt="Editable source"
            data-image-ref={imageRef}
            width={sourceSize.width}
            height={sourceSize.height}
            onLoad={(event) => {
              const image = event.currentTarget;
              if (image.naturalWidth > 1 && image.naturalHeight > 1) {
                onNaturalSizeChange?.({ width: image.naturalWidth, height: image.naturalHeight });
              }
            }}
          />
          <svg
            ref={overlayRef}
            className="image-annotation-editor-overlay"
            viewBox={viewBox}
            role="img"
            aria-label="Image annotation overlay"
            data-image-annotation-overlay="true"
            data-selected-tool={selectedTool}
            onPointerDown={handleOverlayPointerDown}
            onPointerMove={handleOverlayPointerMove}
            onPointerUp={handleOverlayPointerUp}
            onPointerCancel={() => setDraft(undefined)}
          >
            <defs>
              <marker id="image-annotation-arrow-head" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" markerUnits="strokeWidth">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#38bdf8" />
              </marker>
              <filter id="image-annotation-blur-filter" x="-12%" y="-12%" width="124%" height="124%">
                <feGaussianBlur stdDeviation="12" />
              </filter>
            </defs>
            {document.crop ? (
              <rect
                className="image-annotation-crop-box"
                data-annotation-type="crop"
                x={document.crop.x}
                y={document.crop.y}
                width={document.crop.width}
                height={document.crop.height}
              />
            ) : null}
            {visibleAnnotations.map((annotation) => (
              <AnnotationShape
                key={annotation.id}
                annotation={annotation}
                imageUrl={imageUrl}
                sourceSize={sourceSize}
                selected={selectedAnnotationId === annotation.id}
                onPointerDown={handleAnnotationPointerDown}
                onPointerMove={handleAnnotationPointerMove}
                onPointerUp={handleAnnotationPointerUp}
                onPointerCancel={handleAnnotationPointerCancel}
              />
            ))}
          </svg>
        </div>
      </div>
      <label className="image-annotation-text-input" data-label-disabled={!selectedCanEditLabel ? 'true' : undefined}>
        <span>{selectedAnnotation?.type === 'pin' ? 'Pin label' : 'Text label'}</span>
        <input
          type="text"
          ref={textInputRef}
          value={textValue}
          disabled={!selectedCanEditLabel}
          onChange={(event) => handleTextValueChange(event.currentTarget.value)}
          data-editor-inline-text="true"
          data-editor-label-target={selectedAnnotation?.type}
          aria-label="Text annotation label"
        />
      </label>
      {error ? <p className="image-annotation-error">{error}</p> : null}
    </section>
  );
}

function AnnotationShape({
  annotation,
  imageUrl,
  sourceSize,
  selected,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  annotation: ImageAnnotation;
  imageUrl: string;
  sourceSize: ImageAnnotationSize;
  selected: boolean;
  onPointerDown: (event: PointerEvent<SVGElement>, annotation: ImageAnnotation) => void;
  onPointerMove: (event: PointerEvent<SVGElement>) => void;
  onPointerUp: (event: PointerEvent<SVGElement>) => void;
  onPointerCancel: (event: PointerEvent<SVGElement>) => void;
}) {
  const common = {
    'data-annotation-id': annotation.id,
    'data-annotation-type': annotation.type,
    'data-selected': selected ? 'true' : undefined,
    onPointerDown: (event: PointerEvent<SVGElement>) => {
      onPointerDown(event, annotation);
    },
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  };
  if (annotation.type === 'freehand') {
    return (
      <polyline
        {...common}
        className="image-annotation-shape image-annotation-freehand"
        points={annotation.points.map((point) => `${point.x},${point.y}`).join(' ')}
        fill="none"
        stroke={annotation.stroke ?? '#facc15'}
        strokeWidth={annotation.strokeWidth ?? 5}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={annotation.opacity}
      />
    );
  }
  if (annotation.type === 'arrow') {
    return (
      <line
        {...common}
        className="image-annotation-shape image-annotation-arrow"
        x1={annotation.start.x}
        y1={annotation.start.y}
        x2={annotation.end.x}
        y2={annotation.end.y}
        stroke={annotation.stroke ?? '#38bdf8'}
        strokeWidth={annotation.strokeWidth ?? 5}
        strokeLinecap="round"
        markerEnd="url(#image-annotation-arrow-head)"
        opacity={annotation.opacity}
      />
    );
  }
  if (annotation.type === 'text') {
    return (
      <text
        {...common}
        className="image-annotation-shape image-annotation-text"
        x={annotation.position.x}
        y={annotation.position.y}
        fill={annotation.color ?? '#f8fafc'}
        fontSize={annotation.fontSize ?? 32}
        opacity={annotation.opacity}
      >
        {annotation.text}
      </text>
    );
  }
  if (annotation.type === 'pin') {
    return (
      <g {...common} className="image-annotation-shape image-annotation-pin">
        <circle cx={annotation.position.x} cy={annotation.position.y} r={annotation.radius ?? 20} fill={annotation.background ?? '#00e5a0'} opacity={annotation.opacity} />
        <text x={annotation.position.x} y={annotation.position.y + 7} textAnchor="middle" fontSize="20" fill={annotation.color ?? '#02111f'} fontWeight="900" opacity={annotation.opacity}>{annotation.label ?? '1'}</text>
      </g>
    );
  }
  if (annotation.type === 'blur') {
    const clipId = `image-annotation-clip-${safeSvgId(annotation.id)}`;
    return (
      <g className="image-annotation-blur">
        <clipPath id={clipId}>
          <rect x={annotation.rect.x} y={annotation.rect.y} width={annotation.rect.width} height={annotation.rect.height} />
        </clipPath>
        <image
          href={imageUrl}
          x={0}
          y={0}
          width={sourceSize.width}
          height={sourceSize.height}
          preserveAspectRatio="none"
          clipPath={`url(#${clipId})`}
          filter="url(#image-annotation-blur-filter)"
          opacity={0.98}
          pointerEvents="none"
          data-annotation-effect="blur-source"
        />
        <rect
          {...common}
          className="image-annotation-shape image-annotation-blur-outline"
          x={annotation.rect.x}
          y={annotation.rect.y}
          width={annotation.rect.width}
          height={annotation.rect.height}
          fill="rgba(125, 211, 252, 0.14)"
          stroke="#7dd3fc"
          strokeWidth={4}
          strokeDasharray="14 8"
          opacity={annotation.opacity}
        />
      </g>
    );
  }
  return (
    <rect
      {...common}
      className={`image-annotation-shape image-annotation-${annotation.type}`}
      x={annotation.rect.x}
      y={annotation.rect.y}
      width={annotation.rect.width}
      height={annotation.rect.height}
      fill={rectFill(annotation)}
      stroke={'stroke' in annotation ? annotation.stroke : annotation.type === 'redact' ? '#111827' : '#facc15'}
      strokeWidth={'strokeWidth' in annotation ? annotation.strokeWidth : 4}
      opacity={annotation.opacity}
    />
  );
}

function annotationForTool(tool: ImageAnnotationTool, point: ImageAnnotationPoint, index: number, text = 'Label', color = '#facc15'): ImageAnnotation | undefined {
  const id = `ann-${tool}-${Date.now().toString(36)}-${index}`;
  if (tool === 'pen') return createImageAnnotation({ id, type: 'freehand', points: [point], stroke: color, strokeWidth: 5 });
  if (tool === 'arrow') return createImageAnnotation({ id, type: 'arrow', start: point, end: point, stroke: color, strokeWidth: 5 });
  if (tool === 'rect') return createImageAnnotation({ id, type: 'rect', rect: { x: point.x, y: point.y, width: 1, height: 1 }, stroke: color, strokeWidth: 4 });
  if (tool === 'highlight') return createImageAnnotation({ id, type: 'highlight', rect: { x: point.x, y: point.y, width: 1, height: 1 }, fill: color, opacity: 0.32 });
  if (tool === 'blur') return createImageAnnotation({ id, type: 'blur', rect: { x: point.x, y: point.y, width: 1, height: 1 }, radius: 22 });
  if (tool === 'redact') return createImageAnnotation({ id, type: 'redact', rect: { x: point.x, y: point.y, width: 1, height: 1 }, fill: color, opacity: 1 });
  if (tool === 'crop') return createImageAnnotation({ id, type: 'rect', rect: { x: point.x, y: point.y, width: 1, height: 1 }, stroke: '#00e5a0', strokeWidth: 3 });
  if (tool === 'text') return createImageAnnotation({ id, type: 'text', position: point, text, color, fontSize: 32 });
  if (tool === 'pin') return createImageAnnotation({ id, type: 'pin', position: point, label: String(index), color: readableTextColor(color), background: color, radius: 20 });
  return undefined;
}

function updateDraftAnnotation(annotation: ImageAnnotation, start: ImageAnnotationPoint, point: ImageAnnotationPoint): ImageAnnotation {
  if (annotation.type === 'freehand') return { ...annotation, points: [...annotation.points, point] };
  if (annotation.type === 'arrow') return { ...annotation, end: point };
  if (annotation.type === 'rect' || annotation.type === 'highlight' || annotation.type === 'blur' || annotation.type === 'redact') {
    return { ...annotation, rect: normalizedRect({ x: start.x, y: start.y, width: point.x - start.x, height: point.y - start.y }) } as ImageAnnotation;
  }
  return annotation;
}

function normalizedRect(rect: Pick<ImageAnnotationRect, 'x' | 'y' | 'width' | 'height'>) {
  const x = rect.width < 0 ? rect.x + rect.width : rect.x;
  const y = rect.height < 0 ? rect.y + rect.height : rect.y;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(1, Math.round(Math.abs(rect.width))),
    height: Math.max(1, Math.round(Math.abs(rect.height))),
  };
}

function replaceOrAppendAnnotation(annotations: ImageAnnotation[], annotation: ImageAnnotation) {
  const index = annotations.findIndex((item) => item.id === annotation.id);
  if (index < 0) return [...annotations, annotation];
  return [...annotations.slice(0, index), annotation, ...annotations.slice(index + 1)];
}

function pointFromPointer(event: PointerEvent<Element>, svg: SVGSVGElement | null, naturalSize: ImageAnnotationSize): ImageAnnotationPoint | undefined {
  if (!svg) return undefined;
  const rect = svg.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return undefined;
  return {
    x: clamp(Math.round(((event.clientX - rect.left) / rect.width) * naturalSize.width), 0, naturalSize.width),
    y: clamp(Math.round(((event.clientY - rect.top) / rect.height) * naturalSize.height), 0, naturalSize.height),
  };
}

function pointerMoved(delta: ImageAnnotationPoint) {
  return Math.abs(delta.x) >= 1 || Math.abs(delta.y) >= 1;
}

function selectedAnnotationLabel(annotation?: ImageAnnotation) {
  if (annotation?.type === 'text') return annotation.text;
  if (annotation?.type === 'pin') return annotation.label;
  return undefined;
}

function colorForAnnotation(annotation?: ImageAnnotation): string | undefined {
  if (!annotation) return undefined;
  if (annotation.type === 'freehand' || annotation.type === 'arrow' || annotation.type === 'rect') return annotation.stroke;
  if (annotation.type === 'text') return annotation.color;
  if (annotation.type === 'pin') return annotation.background;
  if (annotation.type === 'highlight' || annotation.type === 'redact') return annotation.fill;
  return undefined;
}

function recolorImageAnnotation(annotation: ImageAnnotation, color: string): ImageAnnotation {
  if (annotation.type === 'freehand' || annotation.type === 'arrow' || annotation.type === 'rect') {
    return { ...annotation, stroke: color };
  }
  if (annotation.type === 'text') {
    return { ...annotation, color };
  }
  if (annotation.type === 'pin') {
    return { ...annotation, background: color, color: readableTextColor(color) };
  }
  if (annotation.type === 'highlight') {
    return { ...annotation, fill: color };
  }
  if (annotation.type === 'redact') {
    return { ...annotation, fill: color, opacity: 1 };
  }
  return annotation;
}

function normalizeHexColor(value: string, fallback: string) {
  return /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
}

function readableTextColor(background: string) {
  const hex = normalizeHexColor(background, '#00e5a0').slice(1);
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  return luminance > 0.58 ? '#02111f' : '#f8fafc';
}

function safeSvgId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function safeImageSize(size: ImageAnnotationSize): ImageAnnotationSize {
  return {
    width: Math.max(1, Math.round(size.width || 1)),
    height: Math.max(1, Math.round(size.height || 1)),
  };
}

function rectFill(annotation: RectImageAnnotation | Extract<ImageAnnotation, { type: 'highlight' | 'blur' | 'redact' }>) {
  if ('fill' in annotation && annotation.fill) return annotation.fill;
  if (annotation.type === 'highlight') return 'rgba(250, 204, 21, 0.26)';
  if (annotation.type === 'blur') return 'rgba(125, 211, 252, 0.24)';
  if (annotation.type === 'redact') return 'rgba(15, 23, 42, 0.92)';
  return 'rgba(0, 0, 0, 0)';
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
