import { useState, type ReactNode } from 'react';
import { AlertTriangle, Download, Target } from 'lucide-react';
import { elementRegistry } from '@sciforge/scenario-core/element-registry';
import type { ScenarioId } from '../data';
import { openWorkspaceObject, readWorkspaceFile } from '../api/workspaceClient';
import {
  interactiveArtifactDownloadItems,
  interactiveArtifactJsonDownloadItem,
  interactiveArtifactInspectorTablePolicy,
  interactiveResultSlotSubtitle,
  interactiveUnknownComponentFallbackPolicy,
  interactiveViewComponentLabel,
  interactiveViewPackageRendererForComponent,
  isEvidenceInteractiveViewComponent,
  isExecutionInteractiveViewComponent,
  isNotebookInteractiveViewComponent,
  isUnknownArtifactInspectorComponent,
  type UIComponentRendererProps,
} from '../../../../packages/presentation/interactive-views';
import { artifactDeliveryPreviewNotice } from '../../../../packages/contracts/runtime';
import type { PresentationInput, SciForgeConfig, SciForgeSession, ObjectReference, RuntimeArtifact, UIManifestSlot } from '../domain';
import { exportTextFile } from './exportUtils';
import { ActionButton, Badge, Card, EmptyArtifactState, SectionHeader, cx } from './uiPrimitives';
import { HandoffPreview, HandoffTargetButtons } from './results/HandoffControls';
import { ArtifactCardControls } from './results/ArtifactCardControls';
import type { ResultLocale } from './results/resultLocale';
import { EvidenceMatrix, ExecutionPanel, NotebookTimeline } from './results/ExecutionNotebookPanels';
import { MarkdownBlock } from './results/reportContent';
import {
  artifactSource,
  compactParams,
  executionUnitForArtifact,
  sourceVariant,
  viewCompositionSummary,
} from './results/resultArtifactHelpers';
import { boundedRightPaneText, formatRightPaneStructuredPreviewJson, rightPaneInlineLabel, sanitizeRightPanePreviewValue } from './results/previewSafety';
import type { ResolvedViewPlanItem } from './results-renderer-view-model';
import {
  artifactReferenceKind,
  handoffTargetsForArtifact,
  referenceForResultSlot,
} from './results-renderer-artifact-normalizer';
import {
  findArtifact,
  objectReferenceForArtifactSummary,
  sciForgeReferenceAttribute,
  referenceForArtifact,
} from '../../../../packages/support/object-references';
import { sanitizeUserProjectionText } from './conversation-projection-view-model';

export type RegistryRendererProps = {
  scenarioId: ScenarioId;
  config: SciForgeConfig;
  session: SciForgeSession;
  slot: UIManifestSlot;
  artifact?: RuntimeArtifact;
  input?: PresentationInput;
  onObjectReferenceFocus?: (reference: ObjectReference) => void;
};

type RegistryEntry = {
  label: string;
  render: (props: RegistryRendererProps) => ReactNode;
};

function UnknownArtifactInspector({ slot, artifact, session }: RegistryRendererProps) {
  const payload = artifact?.data ?? slot.props ?? {};
  const safePayload = sanitizeRightPanePreviewValue(payload);
  const table = interactiveArtifactInspectorTablePolicy(safePayload);
  const unit = session ? executionUnitForArtifact(session, artifact) : undefined;
  const refs = [
    artifact?.dataRef ? { label: 'dataRef', value: artifact.dataRef } : undefined,
    unit?.codeRef ? { label: 'codeRef', value: unit.codeRef } : undefined,
    unit?.stdoutRef ? { label: 'stdoutRef', value: unit.stdoutRef } : undefined,
    unit?.stderrRef ? { label: 'stderrRef', value: unit.stderrRef } : undefined,
    unit?.outputRef ? { label: 'outputRef', value: unit.outputRef } : undefined,
  ].filter((item): item is { label: string; value: string } => Boolean(item));
  return (
    <div className="stack">
      <ArtifactSourceBar artifact={artifact} session={session} />
      <ArtifactDownloads artifact={artifact} />
      <div className="slot-meta">
        <Badge variant="warning">Details</Badge>
        {artifact ? <code>{rightPaneInlineLabel(artifactTypeLabel(artifact.type))}</code> : null}
        {viewCompositionSummary(slot) ? <code>{rightPaneInlineLabel(viewCompositionSummary(slot))}</code> : null}
      </div>
      {refs.length ? (
        <div className="slot-meta">
          <span className="muted-inline">{refs.length} supporting record{refs.length === 1 ? '' : 's'} saved.</span>
        </div>
      ) : null}
      {table.rows.length ? (
        <div className="artifact-table">
          <div className="artifact-table-head" style={{ gridTemplateColumns: table.gridTemplateColumns }}>
            {table.columns.map((column) => <span key={column}>{rightPaneInlineLabel(column)}</span>)}
          </div>
          {table.rows.slice(0, table.rowLimit).map((row, index) => (
            <div className="artifact-table-row" key={index} style={{ gridTemplateColumns: table.gridTemplateColumns }}>
              {table.columns.map((column) => <span key={column}>{rightPaneInlineLabel(row[column] ?? '-')}</span>)}
            </div>
          ))}
        </div>
      ) : (
        <pre className="inspector-json">{formatRightPaneStructuredPreviewJson(payload)}</pre>
      )}
    </div>
  );
}

function ArtifactDownloads({ artifact }: { artifact?: RuntimeArtifact }) {
  const downloads = interactiveArtifactDownloadItems(artifact);
  if (!downloads.length) return null;
  return (
    <div className="artifact-downloads">
      {downloads.map((item) => (
        <ActionButton
          key={`${item.name}-${item.path ?? item.key ?? ''}`}
          icon={Download}
          variant="secondary"
          onClick={() => exportTextFile(item.name, item.content, item.contentType)}
        >
          {rightPaneInlineLabel(item.name)}{typeof item.rowCount === 'number' ? ` · ${item.rowCount} rows` : ''}
        </ActionButton>
      ))}
    </div>
  );
}

function ComponentEmptyState({
  componentId,
  artifactType,
  title,
  detail,
}: {
  componentId: string;
  artifactType?: string;
  title?: string;
  detail?: string;
}) {
  const component = elementRegistry.components.find((item) => item.componentId === componentId);
  const producerSkillIds = artifactType
    ? elementRegistry.artifacts.find((item) => item.artifactType === artifactType)?.producerSkillIds ?? []
    : [];
  const recoverActions = [
    ...(component?.recoverActions ?? []),
    ...producerSkillIds.slice(0, 2).map((skillId) => `run-skill:${skillId}`),
  ];
  return (
    <EmptyArtifactState
      title={title ?? component?.emptyState.title ?? 'Waiting for results'}
      detail={detail ?? component?.emptyState.detail ?? 'Run a task or import matching data to preview it here.'}
      recoverActions={Array.from(new Set(recoverActions))}
    />
  );
}

function ArtifactSourceBar({ artifact, session }: { artifact?: RuntimeArtifact; session?: SciForgeSession }) {
  const source = artifactSource(artifact);
  const unit = session ? executionUnitForArtifact(session, artifact) : undefined;
  if (!artifact) {
    return (
      <div className="artifact-source-bar">
        <Badge variant="muted">empty</Badge>
        <code>Waiting for results</code>
      </div>
    );
  }
  return (
    <div className="artifact-source-bar" data-sciforge-reference={sciForgeReferenceAttribute(referenceForArtifact(artifact, artifactReferenceKind(artifact)))}>
      <Badge variant={sourceVariant(source)}>{artifactSourceLabel(source)}</Badge>
      <code>{rightPaneInlineLabel(artifact.id)}</code>
      <code>{rightPaneInlineLabel(artifactTypeLabel(artifact.type))}</code>
      <code>v{artifact.schemaVersion}</code>
      {artifact.path || artifact.dataRef ? <code title="Source path saved">Source saved</code> : null}
      {unit ? <code title="Activity matched">{safeSourceBarLabel(`${unit.tool} ${unit.status}`)}</code> : <code>Waiting for activity</code>}
    </div>
  );
}

function safeSourceBarLabel(value: string) {
  const safe = sanitizeUserProjectionText(value)
    ?? value
      .replace(/\bExecutionUnit\b/gi, '过程步骤')
      .replace(/\bEU-[\w:-]+/g, '过程步骤')
      .replace(/\bstdout|stderr|provider|runtime|debug|raw|tool\b/gi, '过程')
      .replace(/\brun[-:]?[\w:-]+/gi, 'current run')
      .replace(/过程步骤/g, 'activity step')
      .replace(/过程/g, 'activity');
  return compactParams(safe.trim() || 'Activity matched');
}

function artifactSourceLabel(source: string) {
  if (source === 'runtime-artifact') return 'Result';
  if (source === 'project-tool') return 'Result';
  if (source === 'user-upload') return 'Upload';
  if (source === 'external') return 'External';
  if (source === 'empty') return 'Waiting';
  return source.replace(/runtime|artifact/gi, 'result');
}

function artifactTypeLabel(type: string) {
  if (type === 'runtime-artifact') return 'Result';
  return type.replace(/runtime-artifact/gi, 'Result');
}

function packageRendererProps(props: RegistryRendererProps): UIComponentRendererProps {
  const markdownObjectReferences = mergeMarkdownObjectReferences(props.session, props.artifact);
  return {
    slot: props.slot,
    artifact: props.artifact,
    input: props.input,
    session: props.session,
    config: props.config,
    helpers: {
      ArtifactSourceBar: ({ artifact, session }) => <ArtifactSourceBar artifact={artifact as RuntimeArtifact | undefined} session={session as SciForgeSession | undefined} />,
      ArtifactDownloads: ({ artifact }) => <ArtifactDownloads artifact={artifact as RuntimeArtifact | undefined} />,
      ComponentEmptyState,
      MarkdownBlock: (markdownProps) => (
        <MarkdownBlock
          {...markdownProps}
          objectReferences={markdownObjectReferences}
          onObjectReferenceFocus={props.onObjectReferenceFocus}
        />
      ),
      readWorkspaceFile: (ref: string) => readWorkspaceFile(ref, props.config),
    },
  };
}

function mergeMarkdownObjectReferences(session: SciForgeSession, artifact: RuntimeArtifact | undefined): ObjectReference[] {
  const artifactRefs = session.artifacts.map((item) => objectReferenceForArtifactSummary(item, String(item.metadata?.runId ?? '')));
  const structuredRefs = [
    ...(artifact ? [objectReferenceForArtifactSummary(artifact, String(artifact.metadata?.runId ?? ''))] : []),
    ...session.messages.flatMap((message) => message.objectReferences ?? []),
    ...session.runs.flatMap((run) => run.objectReferences ?? []),
    ...artifactRefs,
  ];
  return Array.from(new Map(structuredRefs.map((reference) => [reference.ref, reference])).values()).slice(0, 80);
}

function registryEntryForComponent(componentId: string): RegistryEntry | undefined {
  const packageEntry = interactiveViewPackageRendererForComponent(componentId);
  if (packageEntry) {
    return {
      label: packageEntry.label,
      render: (props) => <>{packageEntry.render(packageRendererProps(props))}</>,
    };
  }
  if (isEvidenceInteractiveViewComponent(componentId)) {
    return {
      label: interactiveViewComponentLabel(componentId),
      render: ({ session }) => <EvidenceMatrix claims={session.claims} artifacts={session.artifacts} />,
    };
  }
  if (isExecutionInteractiveViewComponent(componentId)) {
    return {
      label: interactiveViewComponentLabel(componentId),
      render: ({ session }) => <ExecutionPanel session={session} executionUnits={session.executionUnits} embedded />,
    };
  }
  if (isNotebookInteractiveViewComponent(componentId)) {
    return {
      label: interactiveViewComponentLabel(componentId),
      render: ({ scenarioId, session }) => <NotebookTimeline scenarioId={scenarioId} notebook={session.notebook} />,
    };
  }
  if (isUnknownArtifactInspectorComponent(componentId)) {
    return {
      label: interactiveViewComponentLabel(componentId),
      render: (props) => <UnknownArtifactInspector {...props} />,
    };
  }
  return undefined;
}

export type WorkbenchSlotRenderProps = RegistryRendererProps;

export function renderRegisteredWorkbenchSlot(props: RegistryRendererProps): ReactNode {
  const entry = registryEntryForComponent(props.slot.componentId);
  if (!entry) {
    return (
      <EmptyArtifactState
        title={interactiveUnknownComponentFallbackPolicy({ componentId: props.slot.componentId }).title}
        detail={`组件：${props.slot.componentId}`}
      />
    );
  }
  return entry.render(props);
}

export function RegistrySlot({
  scenarioId,
  config,
  session,
  item,
  locale: _locale,
  onArtifactHandoff,
  onInspectArtifact,
  onObjectReferenceFocus,
  onDismissResultSlotPresentation,
}: {
  scenarioId: ScenarioId;
  config: SciForgeConfig;
  session: SciForgeSession;
  item: ResolvedViewPlanItem;
  locale?: ResultLocale;
  onArtifactHandoff: (targetScenario: ScenarioId, artifact: RuntimeArtifact) => void;
  onInspectArtifact: (artifact: RuntimeArtifact) => void;
  onObjectReferenceFocus?: (reference: ObjectReference) => void;
  onDismissResultSlotPresentation?: (resolvedSlotPresentationId: string) => void;
}) {
  const [handoffPreviewTarget, setHandoffPreviewTarget] = useState<ScenarioId | undefined>();
  const [deliveryOpenError, setDeliveryOpenError] = useState('');
  const { slot } = item;
  const artifact = item.artifact ?? findArtifact(session, slot.artifactRef);
  const entry = registryEntryForComponent(slot.componentId);
  const handoffTargets = artifact ? handoffTargetsForArtifact(artifact, scenarioId) : [];
  const deliveryNotice = artifactDeliveryPreview(artifact);
  const deliveryOpenRef = deliveryNotice?.openRef;
  if (artifact && deliveryNotice) {
    return (
      <Card
        className={cx('registry-slot', item.section === 'primary' && 'primary-slot')}
        data-sciforge-reference={sciForgeReferenceAttribute(referenceForArtifact(artifact, artifactReferenceKind(artifact, slot.componentId)))}
      >
        <SectionHeader icon={Target} title={artifactDeliveryTitle(slot, artifact)} subtitle={deliveryNotice.subtitle} />
        <ArtifactCardControls
          artifact={artifact}
          presentationId={item.id}
          onExportArtifact={artifactCanExportJson(artifact) ? exportArtifactJson : undefined}
          onFocusArtifact={onObjectReferenceFocus ? (target) => onObjectReferenceFocus(objectReferenceForArtifactSummary(target)) : undefined}
          onInspectArtifact={onInspectArtifact}
          onDismissResultSlotPresentation={onDismissResultSlotPresentation}
        />
        <div className="empty-artifact-state">
          <p>{deliveryNotice.detail}</p>
          <div className="artifact-card-actions">
            {deliveryOpenRef ? (
              <button
                type="button"
                onClick={() => {
                  setDeliveryOpenError('');
                  void openWorkspaceObject(config, 'open-external', deliveryOpenRef)
                    .catch((error) => setDeliveryOpenError(error instanceof Error ? error.message : String(error)));
                }}
              >
                Open externally
              </button>
            ) : null}
            {artifact.delivery?.rawRef ? <span className="muted-inline">Source material saved for review</span> : null}
          </div>
          {deliveryOpenError ? <p className="object-action-error">{boundedRightPaneText(deliveryOpenError, 800)}</p> : null}
        </div>
      </Card>
    );
  }
  if (!entry) {
    const fallback = interactiveUnknownComponentFallbackPolicy({
      componentId: slot.componentId,
      artifactRef: slot.artifactRef,
      artifactFound: Boolean(artifact),
      slotTitle: slot.title,
    });
    return (
      <Card
        className="registry-slot"
        data-sciforge-reference={sciForgeReferenceAttribute(artifact ? referenceForArtifact(artifact, artifactReferenceKind(artifact)) : referenceForResultSlot(item))}
      >
        <SectionHeader icon={AlertTriangle} title={fallback.title} subtitle={fallback.subtitle} />
        <p className="empty-state">{safeFallbackText(fallback.detail)}</p>
        {fallback.missingArtifactDetail ? <p className="empty-state">{safeFallbackText(fallback.missingArtifactDetail)}</p> : null}
        <ArtifactCardControls
          artifact={artifact}
          presentationId={item.id}
          onExportArtifact={artifactCanExportJson(artifact) ? exportArtifactJson : undefined}
          onFocusArtifact={onObjectReferenceFocus ? (target) => onObjectReferenceFocus(objectReferenceForArtifactSummary(target)) : undefined}
          onInspectArtifact={onInspectArtifact}
          onDismissResultSlotPresentation={onDismissResultSlotPresentation}
        />
        <UnknownArtifactInspector scenarioId={scenarioId} config={config} session={session} slot={slot} artifact={artifact} />
      </Card>
    );
  }
  return (
    <Card
      className={cx('registry-slot', item.section === 'primary' && 'primary-slot')}
      data-sciforge-reference={sciForgeReferenceAttribute(artifact ? referenceForArtifact(artifact, artifactReferenceKind(artifact, slot.componentId)) : referenceForResultSlot(item))}
    >
      <SectionHeader icon={Target} title={slot.title ?? entry.label} subtitle={interactiveResultSlotSubtitle(item, artifact)} />
      <ArtifactCardControls
        artifact={artifact}
        presentationId={item.id}
        onExportArtifact={artifactCanExportJson(artifact) ? exportArtifactJson : undefined}
        onFocusArtifact={onObjectReferenceFocus ? (target) => onObjectReferenceFocus(objectReferenceForArtifactSummary(target)) : undefined}
        onInspectArtifact={onInspectArtifact}
        onDismissResultSlotPresentation={onDismissResultSlotPresentation}
      />
      {artifact && handoffTargets.length ? (
        <HandoffTargetButtons targets={handoffTargets} onPreview={setHandoffPreviewTarget} />
      ) : null}
      {artifact && handoffPreviewTarget ? (
        <HandoffPreview
          sourceScenarioId={scenarioId}
          targetScenarioId={handoffPreviewTarget}
          artifact={artifact}
          onCancel={() => setHandoffPreviewTarget(undefined)}
          onConfirm={() => onArtifactHandoff(handoffPreviewTarget, artifact)}
        />
      ) : null}
      {entry.render({ scenarioId, config, session, slot, artifact, input: item.input, onObjectReferenceFocus })}
    </Card>
  );
}

function safeFallbackText(value: string) {
  return boundedRightPaneText(value
    .replace(/componentId/gi, 'component')
    .replace(/\bScenario\b/g, 'chat mode')
    .replace(/\bartifactRef\b/gi, 'result reference')
    .replace(/\bartifact\b/gi, 'result')
    .replace(/\bmanifest\b/gi, 'view settings')
    .replace(/\binspector\b/gi, 'preview')
    .replace(/日志引用/g, 'supporting record')
    .replace(/返回了未知 component/g, 'returned an unknown component')
    .replace(/当前使用通用 preview 展示/g, 'using a generic preview for')
    .replace(/未找到/g, 'not found')
    .replace(/：/g, ': ')
    .replace(/。/g, '.')
    .replace(/、/g, ', ')
    .replace(/\s+和\s+/g, ' and '), 800);
}

function artifactDeliveryPreview(artifact?: RuntimeArtifact): { subtitle: string; detail: string; openRef?: string } | undefined {
  return artifactDeliveryPreviewNotice(artifact);
}

function artifactDeliveryTitle(slot: UIManifestSlot, artifact: RuntimeArtifact) {
  const metadata = artifact.metadata;
  return slot.title
    ?? (typeof metadata?.title === 'string' ? metadata.title : undefined)
    ?? (typeof metadata?.name === 'string' ? metadata.name : undefined)
    ?? artifact.id;
}

function exportArtifactJson(artifact: RuntimeArtifact) {
  const item = interactiveArtifactJsonDownloadItem(artifact);
  if (item) exportTextFile(item.name, item.content, item.contentType);
}

function artifactCanExportJson(artifact?: RuntimeArtifact) {
  return Boolean(interactiveArtifactJsonDownloadItem(artifact));
}
