import { useState, type ReactNode } from 'react';
import { AlertTriangle, Download, Target } from 'lucide-react';
import { elementRegistry } from '@sciforge/scenario-core/element-registry';
import type { ScenarioId } from '../data';
import { readWorkspaceFile } from '../api/workspaceClient';
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
import type { SciForgeConfig, SciForgeSession, ObjectReference, RuntimeArtifact, UIManifestSlot } from '../domain';
import { exportTextFile } from './exportUtils';
import { ActionButton, Badge, Card, EmptyArtifactState, SectionHeader, cx } from './uiPrimitives';
import { HandoffPreview, HandoffTargetButtons } from './results/HandoffControls';
import { ArtifactCardControls } from './results/ArtifactCardControls';
import { EvidenceMatrix, ExecutionPanel, NotebookTimeline } from './results/ExecutionNotebookPanels';
import { MarkdownBlock } from './results/reportContent';
import {
  artifactSource,
  compactParams,
  executionUnitForArtifact,
  sourceVariant,
  viewCompositionSummary,
} from './results/resultArtifactHelpers';
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

export type RegistryRendererProps = {
  scenarioId: ScenarioId;
  config: SciForgeConfig;
  session: SciForgeSession;
  slot: UIManifestSlot;
  artifact?: RuntimeArtifact;
  onObjectReferenceFocus?: (reference: ObjectReference) => void;
};

type RegistryEntry = {
  label: string;
  render: (props: RegistryRendererProps) => ReactNode;
};

function UnknownArtifactInspector({ slot, artifact, session }: RegistryRendererProps) {
  const payload = artifact?.data ?? slot.props ?? {};
  const table = interactiveArtifactInspectorTablePolicy(payload);
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
        <Badge variant="warning">inspector</Badge>
        {artifact ? <code>{artifact.type}</code> : null}
        {viewCompositionSummary(slot) ? <code>{viewCompositionSummary(slot)}</code> : null}
      </div>
      {refs.length ? (
        <div className="slot-meta">
          {refs.map((ref) => (
            <code key={`${ref.label}-${ref.value}`}>{ref.label}: {ref.value}</code>
          ))}
        </div>
      ) : null}
      {table.rows.length ? (
        <div className="artifact-table">
          <div className="artifact-table-head" style={{ gridTemplateColumns: table.gridTemplateColumns }}>
            {table.columns.map((column) => <span key={column}>{column}</span>)}
          </div>
          {table.rows.slice(0, table.rowLimit).map((row, index) => (
            <div className="artifact-table-row" key={index} style={{ gridTemplateColumns: table.gridTemplateColumns }}>
              {table.columns.map((column) => <span key={column}>{String(row[column] ?? '-')}</span>)}
            </div>
          ))}
        </div>
      ) : (
        <pre className="inspector-json">{JSON.stringify(payload, null, 2)}</pre>
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
          {item.name}{typeof item.rowCount === 'number' ? ` · ${item.rowCount} rows` : ''}
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
      title={title ?? component?.emptyState.title ?? '等待 runtime artifact'}
      detail={detail ?? component?.emptyState.detail ?? '当前组件没有可展示 artifact；请运行场景或导入匹配数据。'}
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
        <code>no runtime artifact</code>
      </div>
    );
  }
  return (
    <div className="artifact-source-bar" data-sciforge-reference={sciForgeReferenceAttribute(referenceForArtifact(artifact, artifactReferenceKind(artifact)))}>
      <Badge variant={sourceVariant(source)}>{source}</Badge>
      <code>{artifact.id}</code>
      <code>{artifact.type}</code>
      <code>schema={artifact.schemaVersion}</code>
      {artifact.path ? <code title={artifact.path}>path={compactParams(artifact.path)}</code> : null}
      {artifact.dataRef ? <code title={artifact.dataRef}>dataRef={compactParams(artifact.dataRef)}</code> : null}
      {unit ? <code title={unit.params}>tool={unit.tool} · {unit.status}</code> : <code>audit warning: no ExecutionUnit</code>}
    </div>
  );
}

function packageRendererProps(props: RegistryRendererProps): UIComponentRendererProps {
  return {
    slot: props.slot,
    artifact: props.artifact,
    session: props.session,
    config: props.config,
    helpers: {
      ArtifactSourceBar: ({ artifact, session }) => <ArtifactSourceBar artifact={artifact as RuntimeArtifact | undefined} session={session as SciForgeSession | undefined} />,
      ArtifactDownloads: ({ artifact }) => <ArtifactDownloads artifact={artifact as RuntimeArtifact | undefined} />,
      ComponentEmptyState,
      MarkdownBlock: (markdownProps) => <MarkdownBlock {...markdownProps} onObjectReferenceFocus={props.onObjectReferenceFocus} />,
      readWorkspaceFile: (ref: string) => readWorkspaceFile(ref, props.config),
    },
  };
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
        detail={`componentId: ${props.slot.componentId}`}
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
  onArtifactHandoff,
  onInspectArtifact,
  onObjectReferenceFocus,
  onDismissResultSlotPresentation,
}: {
  scenarioId: ScenarioId;
  config: SciForgeConfig;
  session: SciForgeSession;
  item: ResolvedViewPlanItem;
  onArtifactHandoff: (targetScenario: ScenarioId, artifact: RuntimeArtifact) => void;
  onInspectArtifact: (artifact: RuntimeArtifact) => void;
  onObjectReferenceFocus?: (reference: ObjectReference) => void;
  onDismissResultSlotPresentation?: (resolvedSlotPresentationId: string) => void;
}) {
  const [handoffPreviewTarget, setHandoffPreviewTarget] = useState<ScenarioId | undefined>();
  const { slot } = item;
  const artifact = item.artifact ?? findArtifact(session, slot.artifactRef);
  const entry = registryEntryForComponent(slot.componentId);
  const handoffTargets = artifact ? handoffTargetsForArtifact(artifact, scenarioId) : [];
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
        <p className="empty-state">{fallback.detail}</p>
        {fallback.missingArtifactDetail ? <p className="empty-state">{fallback.missingArtifactDetail}</p> : null}
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
      {entry.render({ scenarioId, config, session, slot, artifact, onObjectReferenceFocus })}
    </Card>
  );
}

function exportArtifactJson(artifact: RuntimeArtifact) {
  const item = interactiveArtifactJsonDownloadItem(artifact);
  if (item) exportTextFile(item.name, item.content, item.contentType);
}

function artifactCanExportJson(artifact?: RuntimeArtifact) {
  return Boolean(interactiveArtifactJsonDownloadItem(artifact));
}
