import React from 'react';
import { Copy, Download, ExternalLink, Info, Maximize2, Move, Scan, ZoomIn, ZoomOut, type LucideIcon } from 'lucide-react';
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

export interface ImageEvidenceDomTarget {
  selector?: string;
  stableSelector?: string;
  domPath?: string;
  role?: string;
  label?: string;
  textSnippet?: string;
  rect?: ImageEvidenceBounds;
}

export type ImageEvidenceWindowBindingStatus = 'auto-bound' | 'manual-bound' | 'unbound' | 'blocked' | string;

export interface ImageEvidenceWindowBindingCandidate {
  windowRef?: string;
  appName?: string;
  bundleId?: string;
  pid?: number;
  title?: string;
  confidence?: number;
  reason?: string;
  windowBounds?: ImageEvidenceBounds;
  windowLocalBounds?: ImageEvidenceBounds;
}

export interface ImageEvidenceWindowBinding extends ImageEvidenceWindowBindingCandidate {
  status: ImageEvidenceWindowBindingStatus;
  candidates?: ImageEvidenceWindowBindingCandidate[];
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
  domTarget?: ImageEvidenceDomTarget;
  selector?: string;
  domPath?: string;
  selectedText?: string;
  screenBounds?: ImageEvidenceBounds;
  windowBounds?: ImageEvidenceBounds;
  windowLocalBounds?: ImageEvidenceBounds;
  displayId?: string | number;
  scale?: number;
  windowBinding?: ImageEvidenceWindowBinding;
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

function scalarValue(value: unknown) {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return undefined;
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

function domTargetValue(value: unknown): ImageEvidenceDomTarget | undefined {
  if (!isRecord(value)) return undefined;
  const target: ImageEvidenceDomTarget = {
    selector: stringValue(value.selector),
    stableSelector: stringValue(value.stableSelector),
    domPath: stringValue(value.domPath),
    role: stringValue(value.role),
    label: stringValue(value.label),
    textSnippet: stringValue(value.textSnippet),
    rect: boundsValue(value.rect),
  };
  return Object.values(target).some((entry) => entry !== undefined) ? target : undefined;
}

function windowBindingCandidateValue(value: unknown): ImageEvidenceWindowBindingCandidate | undefined {
  if (!isRecord(value)) return undefined;
  return {
    windowRef: stringValue(value.windowRef),
    appName: stringValue(value.appName),
    bundleId: stringValue(value.bundleId),
    pid: numberValue(value.pid),
    title: stringValue(value.title),
    confidence: numberValue(value.confidence),
    reason: stringValue(value.reason),
    windowBounds: boundsValue(value.windowBounds),
    windowLocalBounds: boundsValue(value.windowLocalBounds),
  };
}

function windowBindingValue(value: unknown): ImageEvidenceWindowBinding | undefined {
  if (!isRecord(value)) return undefined;
  const status = stringValue(value.status);
  if (!status) return undefined;
  const candidate = windowBindingCandidateValue(value) ?? {};
  return {
    ...candidate,
    status,
    candidates: Array.isArray(value.candidates)
      ? value.candidates
        .map(windowBindingCandidateValue)
        .filter((item): item is ImageEvidenceWindowBindingCandidate => Boolean(item))
        .slice(0, 3)
      : undefined,
  };
}

function boundsAttribute(bounds?: ImageEvidenceBounds) {
  return bounds ? `${bounds.x},${bounds.y},${bounds.width},${bounds.height}` : undefined;
}

function isBoundWindowBinding(
  binding?: ImageEvidenceWindowBinding,
): binding is ImageEvidenceWindowBinding & { status: 'auto-bound' | 'manual-bound' } {
  return binding?.status === 'auto-bound' || binding?.status === 'manual-bound';
}

function previewUrlForRef(ref?: string, config?: unknown) {
  if (!ref) return undefined;
  const params = new URLSearchParams();
  params.set('ref', ref);
  const previewConfig = isRecord(config) ? config : {};
  const workspacePath = stringValue(previewConfig.workspacePath)?.trim();
  if (workspacePath) params.set('workspacePath', workspacePath);
  const workspaceWriterBaseUrl = stringValue(previewConfig.workspaceWriterBaseUrl)?.trim().replace(/\/+$/, '');
  const path = `/api/sciforge/preview/raw?${params.toString()}`;
  return workspaceWriterBaseUrl ? `${workspaceWriterBaseUrl}${path}` : path;
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
    domTarget: domTargetValue(payload.domTarget),
    selector: stringValue(payload.selector),
    domPath: stringValue(payload.domPath),
    selectedText: stringValue(payload.selectedText),
    screenBounds: boundsValue(payload.screenBounds),
    windowBounds: boundsValue(payload.windowBounds),
    windowLocalBounds: boundsValue(payload.windowLocalBounds),
    displayId: scalarValue(payload.displayId),
    scale: numberValue(payload.scale),
    windowBinding: windowBindingValue(payload.windowBinding),
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

function ControlButton(props: { id: string; label: string; event: string; icon: LucideIcon; imageRef?: string; imageUrl?: string; disabled?: boolean }) {
  const Icon = props.icon;
  return (
    <button
      type="button"
      className="image-evidence-control"
      title={props.label}
      aria-label={props.label}
      data-view-control={props.id}
      data-event={props.event}
      data-control-execution="host-policy"
      data-control-style="icon-button"
      data-image-ref={props.imageRef}
      data-image-url={props.imageUrl}
      disabled={props.disabled}
    >
      <Icon size={14} aria-hidden />
      <span>{props.label}</span>
    </button>
  );
}

function MetadataRow(props: { label: string; value?: string | number; dataName?: string }) {
  if (props.value === undefined || props.value === '') return null;
  return (
    <span
      className="image-evidence-metadata-row"
      {...(props.dataName ? { [props.dataName]: props.value } : {})}
    >
      <span>{props.label}</span>
      <code>{props.value}</code>
    </span>
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
  const imageUrl = previewUrlForRef(imageRef, props.config);
  const imageFit = 'contain';
  const title = props.slot.title ?? 'Image evidence';
  const status = imageRef ? payload.status ?? 'ready' : 'missing-ref';
  const cropStyle = cropOverlayStyle(payload.bounds, payload.cropBounds);
  const windowBinding = payload.windowBinding;
  const boundWindowRef = isBoundWindowBinding(windowBinding)
    ? windowBinding.windowRef ?? payload.windowRef
    : windowBinding
      ? undefined
      : payload.windowRef;
  const windowBounds = windowBinding?.windowBounds ?? payload.windowBounds;
  const windowLocalBounds = windowBinding?.windowLocalBounds ?? payload.windowLocalBounds;
  const windowBindingCandidateCount = windowBinding?.candidates?.length;

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
      data-window-ref={boundWindowRef}
      data-browser-session-ref={payload.browserSessionRef}
      data-artifact-ref={payload.artifactRef}
      data-redact-ref={payload.redactionRef}
      data-bounds={boundsAttribute(payload.bounds)}
      data-crop-bounds={boundsAttribute(payload.cropBounds)}
      data-dom-target={payload.domTarget?.selector}
      data-selector={payload.selector}
      data-dom-path={payload.domPath}
      data-selected-text={payload.selectedText}
      data-screen-bounds={boundsAttribute(payload.screenBounds)}
      data-window-bounds={boundsAttribute(windowBounds)}
      data-window-local-bounds={boundsAttribute(windowLocalBounds)}
      data-display-id={payload.displayId}
      data-scale={payload.scale}
      data-window-binding-status={windowBinding?.status}
      data-window-binding-confidence={windowBinding?.confidence}
      data-window-binding-ref={isBoundWindowBinding(windowBinding) ? windowBinding.windowRef : undefined}
      data-window-binding-candidate-count={windowBindingCandidateCount}
      data-dom-target-selector={payload.domTarget?.selector}
      data-dom-target-stable-selector={payload.domTarget?.stableSelector}
      data-dom-target-path={payload.domTarget?.domPath}
      data-dom-target-role={payload.domTarget?.role}
      data-dom-target-label={payload.domTarget?.label}
      data-dom-target-text={payload.domTarget?.textSnippet}
      data-dom-target-rect={boundsAttribute(payload.domTarget?.rect)}
    >
      <header className="image-evidence-header">
        <div>
          <p className="image-evidence-kicker">{payload.sourceKind}</p>
          <h3>{title}</h3>
        </div>
        <div className="image-evidence-status">{status}</div>
      </header>

      <nav className="image-evidence-toolbar" aria-label="Image evidence controls">
        <ControlButton id="zoom-in" label="Zoom in" event="image-view-control" icon={ZoomIn} imageRef={imageRef} disabled={!imageRef} />
        <ControlButton id="zoom-out" label="Zoom out" event="image-view-control" icon={ZoomOut} imageRef={imageRef} disabled={!imageRef} />
        <ControlButton id="pan" label="Pan" event="image-view-control" icon={Move} imageRef={imageRef} disabled={!imageRef} />
        <ControlButton id="fit" label="Fit" event="image-view-control" icon={Scan} imageRef={imageRef} disabled={!imageRef} />
        <ControlButton id="actual-size" label="Actual size" event="image-view-control" icon={Maximize2} imageRef={imageRef} disabled={!imageRef} />
        <ControlButton id="copy-ref" label="Copy ref" event="copy-ref-request" icon={Copy} imageRef={imageRef} disabled={!imageRef} />
        <ControlButton id="open-original" label="Open original" event="open-original-request" icon={ExternalLink} imageRef={imageRef} imageUrl={imageUrl} disabled={!imageRef} />
        <ControlButton id="download-image" label="Download image" event="download-image-request" icon={Download} imageRef={imageRef} imageUrl={imageUrl} disabled={!imageRef} />
        <ControlButton id="provenance" label="Provenance" event="show-provenance-request" icon={Info} imageRef={imageRef} disabled={!payload.provenanceRef && !payload.provenanceRefs?.length} />
      </nav>

      <div className="image-evidence-stage" data-image-fit={imageFit}>
        {imageUrl ? (
          <figure className="image-evidence-frame" data-image-fit={imageFit}>
            <button
              type="button"
              className="image-evidence-preview-button"
              data-view-control="open-original"
              data-event="open-original-request"
              data-control-execution="host-policy"
              data-image-ref={imageRef}
              data-image-url={imageUrl}
              aria-label="Open original image"
            >
              <img
                className="image-evidence-image"
                src={imageUrl}
                alt="Image evidence preview"
                width={payload.width}
                height={payload.height}
                data-image-ref={imageRef}
                data-source-kind={payload.sourceKind}
                data-image-fit={imageFit}
              />
            </button>
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

      <footer className="image-evidence-footer" data-image-provenance-panel>
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
        <RefChip label="Window" refValue={boundWindowRef} />
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
        <MetadataRow label="DOM target" value={payload.domTarget?.selector} dataName="data-dom-target-selector" />
        <MetadataRow label="DOM stable selector" value={payload.domTarget?.stableSelector} dataName="data-dom-target-stable-selector" />
        <MetadataRow label="DOM target path" value={payload.domTarget?.domPath} dataName="data-dom-target-path" />
        <MetadataRow label="DOM target role" value={payload.domTarget?.role} dataName="data-dom-target-role" />
        <MetadataRow label="DOM target label" value={payload.domTarget?.label} dataName="data-dom-target-label" />
        <MetadataRow label="DOM target text" value={payload.domTarget?.textSnippet} dataName="data-dom-target-text" />
        <MetadataRow label="DOM target rect" value={boundsAttribute(payload.domTarget?.rect)} dataName="data-dom-target-rect" />
        <MetadataRow label="Selector" value={payload.selector} dataName="data-selector" />
        <MetadataRow label="DOM path" value={payload.domPath} dataName="data-dom-path" />
        <MetadataRow label="Selected text" value={payload.selectedText} dataName="data-selected-text" />
        <MetadataRow label="Screen bounds" value={boundsAttribute(payload.screenBounds)} dataName="data-screen-bounds" />
        <MetadataRow label="Window bounds" value={boundsAttribute(windowBounds)} dataName="data-window-bounds" />
        <MetadataRow label="Window-local bounds" value={boundsAttribute(windowLocalBounds)} dataName="data-window-local-bounds" />
        <MetadataRow label="Display" value={payload.displayId} dataName="data-display-id" />
        <MetadataRow label="Scale" value={payload.scale} dataName="data-scale" />
        <MetadataRow label="Window binding" value={payload.windowBinding?.status} dataName="data-window-binding-status" />
        <MetadataRow label="Binding confidence" value={payload.windowBinding?.confidence} dataName="data-window-binding-confidence" />
        <MetadataRow label="Binding reason" value={payload.windowBinding?.reason} />
        <MetadataRow label="App" value={payload.windowBinding?.appName} />
        <MetadataRow label="Bundle" value={payload.windowBinding?.bundleId} />
        <MetadataRow label="PID" value={payload.windowBinding?.pid} />
        <MetadataRow label="Title" value={payload.windowBinding?.title} />
        {isBoundWindowBinding(payload.windowBinding) ? (
          <RefChip
            label="Binding window"
            refValue={payload.windowBinding?.windowRef}
            dataName="data-window-binding-ref"
          />
        ) : null}
        {payload.windowBinding?.candidates?.map((candidate, index) => (
          <span
            key={`${candidate.windowRef ?? candidate.title ?? 'candidate'}-${index}`}
            className="image-evidence-ref-chip image-evidence-candidate-chip"
            data-window-binding-candidate-ref={candidate.windowRef}
            data-window-binding-candidate-confidence={candidate.confidence}
          >
            <span>Candidate</span>
            <code>
              {[
                candidate.appName,
                candidate.title,
                candidate.confidence === undefined ? undefined : `confidence ${candidate.confidence}`,
                candidate.reason,
                candidate.windowBounds ? `window ${boundsAttribute(candidate.windowBounds)}` : undefined,
                candidate.windowLocalBounds ? `local ${boundsAttribute(candidate.windowLocalBounds)}` : undefined,
              ].filter(Boolean).join(' | ')}
            </code>
          </span>
        ))}
      </footer>
    </section>
  );
}
