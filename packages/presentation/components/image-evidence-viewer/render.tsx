import React from 'react';
import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';
import {
  IMAGE_EVIDENCE_VIEWER_COMPONENT_ID,
} from './manifest';

export const IMAGE_EVIDENCE_SOURCE_KINDS = [
  'annotation-crop',
  'screenshot',
  'browser-evidence',
  'window-capture',
  'screen-region',
  'artifact',
  'replay',
] as const;

export type ImageEvidenceSourceKind = typeof IMAGE_EVIDENCE_SOURCE_KINDS[number];
export type ImageEvidenceStatus = 'ready' | 'reviewing' | 'missing-ref' | 'redacted' | 'error' | string;

export interface ImageEvidenceBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageEvidencePayload {
  sourceKind: ImageEvidenceSourceKind;
  imageRef?: string;
  ref?: string;
  mime?: string;
  width?: number;
  height?: number;
  sha256?: string;
  createdAt?: string;
  provenanceRef?: string;
  provenanceRefs?: string[];
  annotationRefs?: string[];
  targetRef?: string;
  windowRef?: string;
  browserSessionRef?: string;
  artifactRef?: string;
  redactionRef?: string;
  bounds?: ImageEvidenceBounds;
  cropBounds?: ImageEvidenceBounds;
  status?: ImageEvidenceStatus;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function sourceKindValue(value: unknown): ImageEvidenceSourceKind {
  return IMAGE_EVIDENCE_SOURCE_KINDS.includes(value as ImageEvidenceSourceKind)
    ? value as ImageEvidenceSourceKind
    : 'artifact';
}

function boundsValue(value: unknown): ImageEvidenceBounds | undefined {
  if (!isRecord(value)) return undefined;
  const x = numberValue(value.x);
  const y = numberValue(value.y);
  const width = numberValue(value.width);
  const height = numberValue(value.height);
  if (x === undefined || y === undefined || width === undefined || height === undefined) return undefined;
  return { x, y, width, height };
}

function boundsAttribute(bounds?: ImageEvidenceBounds) {
  return bounds ? `${bounds.x},${bounds.y},${bounds.width},${bounds.height}` : undefined;
}

function previewUrlForRef(ref?: string) {
  return ref ? `/api/sciforge/preview/raw?ref=${encodeURIComponent(ref)}` : undefined;
}

function payloadFromProps(props: UIComponentRendererProps): ImageEvidencePayload {
  const payload = isRecord(props.artifact?.data) ? props.artifact.data : isRecord(props.slot.props) ? props.slot.props : {};
  return {
    sourceKind: sourceKindValue(payload.sourceKind),
    imageRef: stringValue(payload.imageRef),
    ref: stringValue(payload.ref),
    mime: stringValue(payload.mime),
    width: numberValue(payload.width),
    height: numberValue(payload.height),
    sha256: stringValue(payload.sha256),
    createdAt: stringValue(payload.createdAt),
    provenanceRef: stringValue(payload.provenanceRef),
    provenanceRefs: stringList(payload.provenanceRefs),
    annotationRefs: stringList(payload.annotationRefs),
    targetRef: stringValue(payload.targetRef),
    windowRef: stringValue(payload.windowRef),
    browserSessionRef: stringValue(payload.browserSessionRef),
    artifactRef: stringValue(payload.artifactRef),
    redactionRef: stringValue(payload.redactionRef),
    bounds: boundsValue(payload.bounds),
    cropBounds: boundsValue(payload.cropBounds),
    status: stringValue(payload.status) ?? 'ready',
  };
}

function RefChip(props: { label: string; refValue?: string; className?: string; dataName?: string }) {
  if (!props.refValue) return null;
  return (
    <span
      className={props.className ?? 'image-evidence-ref-chip'}
      {...(props.dataName ? { [props.dataName]: props.refValue } : {})}
    >
      <span>{props.label}</span>
      <code>{props.refValue}</code>
    </span>
  );
}

function ControlButton(props: { id: string; label: string; event: string; imageRef?: string; imageUrl?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      className="image-evidence-control"
      data-view-control={props.id}
      data-event={props.event}
      data-control-execution="host-policy"
      data-image-ref={props.imageRef}
      data-image-url={props.imageUrl}
      disabled={props.disabled}
    >
      {props.label}
    </button>
  );
}

function cropOverlayStyle(bounds?: ImageEvidenceBounds, cropBounds?: ImageEvidenceBounds): React.CSSProperties | undefined {
  if (!bounds || !cropBounds || bounds.width <= 0 || bounds.height <= 0) return undefined;
  return {
    left: `${(cropBounds.x / bounds.width) * 100}%`,
    top: `${(cropBounds.y / bounds.height) * 100}%`,
    width: `${(cropBounds.width / bounds.width) * 100}%`,
    height: `${(cropBounds.height / bounds.height) * 100}%`,
  };
}

export function renderImageEvidenceViewer(props: UIComponentRendererProps) {
  const payload = payloadFromProps(props);
  const imageRef = payload.imageRef ?? payload.ref;
  const imageUrl = previewUrlForRef(imageRef);
  const title = props.slot.title ?? 'Image evidence';
  const status = imageRef ? payload.status ?? 'ready' : 'missing-ref';
  const cropStyle = cropOverlayStyle(payload.bounds, payload.cropBounds);

  return (
    <section
      className="image-evidence-viewer"
      data-component-id={IMAGE_EVIDENCE_VIEWER_COMPONENT_ID}
      data-render-boundary="presentation-only"
      data-source-kind={payload.sourceKind}
      data-status={status}
      data-image-ref={imageRef}
      data-mime={payload.mime}
      data-width={payload.width}
      data-height={payload.height}
      data-sha256={payload.sha256}
      data-created-at={payload.createdAt}
      data-provenance-ref={payload.provenanceRef}
      data-target-ref={payload.targetRef}
      data-window-ref={payload.windowRef}
      data-browser-session-ref={payload.browserSessionRef}
      data-artifact-ref={payload.artifactRef}
      data-redact-ref={payload.redactionRef}
      data-bounds={boundsAttribute(payload.bounds)}
      data-crop-bounds={boundsAttribute(payload.cropBounds)}
    >
      <header className="image-evidence-header">
        <div>
          <p className="image-evidence-kicker">{payload.sourceKind}</p>
          <h3>{title}</h3>
        </div>
        <div className="image-evidence-status">{status}</div>
      </header>

      <nav className="image-evidence-toolbar" aria-label="Image evidence controls">
        <ControlButton id="zoom-in" label="Zoom in" event="image-view-control" imageRef={imageRef} disabled={!imageRef} />
        <ControlButton id="zoom-out" label="Zoom out" event="image-view-control" imageRef={imageRef} disabled={!imageRef} />
        <ControlButton id="pan" label="Pan" event="image-view-control" imageRef={imageRef} disabled={!imageRef} />
        <ControlButton id="fit" label="Fit" event="image-view-control" imageRef={imageRef} disabled={!imageRef} />
        <ControlButton id="actual-size" label="Actual size" event="image-view-control" imageRef={imageRef} disabled={!imageRef} />
        <ControlButton id="copy-ref" label="Copy ref" event="copy-ref-request" imageRef={imageRef} disabled={!imageRef} />
        <ControlButton id="open-original" label="Open original" event="open-original-request" imageRef={imageRef} imageUrl={imageUrl} disabled={!imageRef} />
        <ControlButton id="download-image" label="Download image" event="download-image-request" imageRef={imageRef} imageUrl={imageUrl} disabled={!imageRef} />
        <ControlButton id="provenance" label="Provenance" event="show-provenance-request" imageRef={imageRef} disabled={!payload.provenanceRef && !payload.provenanceRefs?.length} />
      </nav>

      <div className="image-evidence-stage">
        {imageUrl ? (
          <figure className="image-evidence-frame">
            <img
              className="image-evidence-image"
              src={imageUrl}
              alt="Image evidence preview"
              width={payload.width}
              height={payload.height}
              data-image-ref={imageRef}
              data-source-kind={payload.sourceKind}
            />
            {payload.annotationRefs?.map((annotationRef) => (
              <span
                key={annotationRef}
                className="image-evidence-annotation-overlay"
                data-annotation-overlay-ref={annotationRef}
              />
            ))}
            {payload.cropBounds ? (
              <span
                className="image-evidence-crop-highlight"
                data-crop-bounds={boundsAttribute(payload.cropBounds)}
                style={cropStyle}
              />
            ) : null}
          </figure>
        ) : (
          <div className="image-evidence-empty">
            <p>No image evidence ref is attached.</p>
          </div>
        )}
      </div>

      <footer className="image-evidence-footer">
        <RefChip label="Image" refValue={imageRef} />
        <RefChip label="Provenance" refValue={payload.provenanceRef} />
        {payload.provenanceRefs?.map((provenanceRef) => (
          provenanceRef === payload.provenanceRef ? null : (
            <RefChip
              key={provenanceRef}
              label="Evidence"
              refValue={provenanceRef}
              dataName="data-provenance-ref"
            />
          )
        ))}
        <RefChip label="Target" refValue={payload.targetRef} />
        <RefChip label="Window" refValue={payload.windowRef} />
        <RefChip label="Browser session" refValue={payload.browserSessionRef} />
        <RefChip label="Artifact" refValue={payload.artifactRef} />
        <RefChip label="Redact mask" refValue={payload.redactionRef} />
        {payload.annotationRefs?.map((annotationRef) => (
          <RefChip
            key={annotationRef}
            label="Annotation"
            refValue={annotationRef}
            dataName="data-annotation-overlay-ref"
          />
        ))}
      </footer>
    </section>
  );
}
