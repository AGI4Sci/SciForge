import type { ScenarioId } from './data';
import {
  type RuntimeArtifact,
  type SciForgeConfig,
  type SciForgeSession,
  type UIManifestSlot,
} from './domain';
import { createSession } from './sessionStore';
import type { RuntimeUIModule } from './uiModuleRegistry';
import {
  defaultWorkbenchDemoContext,
  normalizeWorkbenchFixtureArtifact,
  shouldBuildWorkbenchFigureQA,
  workbenchComponentFixtures,
  workbenchComponentRecommendationBoost,
  workbenchDemoVariants,
  workbenchModuleDisplayLabels as packageWorkbenchModuleDisplayLabels,
  type WorkbenchDemoVariant,
} from '@sciforge-ui/components';

const DEMO_SCENARIO = defaultWorkbenchDemoContext.scenarioId as ScenarioId;

export type { WorkbenchDemoVariant };

export interface WorkbenchComponentRecommendation {
  componentId: string;
  moduleId: string;
  title: string;
  score: number;
  reasons: string[];
  fallbackModuleIds: string[];
  alternateModuleLabels: string[];
}

export interface WorkbenchArtifactShapeExample {
  artifactType: string;
  schemaVersion: string;
  requiredFields: string[];
  requiredAnyFields: string[][];
  exampleData: unknown;
}

export interface WorkbenchFigureQA {
  size: string;
  dpi: string;
  font: string;
  palette: string;
  colorblindSafety: string;
  panelLabels: string;
  vectorRasterStatus: string;
  dataSource: string;
  statisticalMethod: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function fieldsFromSchema(schema: unknown): string[] {
  if (!isRecord(schema)) return [];
  const directRequired = Array.isArray(schema.required) ? schema.required.filter((field): field is string => typeof field === 'string') : [];
  const properties = isRecord(schema.properties) ? Object.keys(schema.properties) : [];
  const data = isRecord(schema.data) ? fieldsFromSchema(schema.data) : [];
  return Array.from(new Set([...directRequired, ...properties, ...data]));
}

function dataFieldsFromArtifactData(data: unknown): string[] {
  return isRecord(data) ? Object.keys(data) : [];
}

function fieldMatches(required: string, fields: string[]) {
  return fields.includes(required);
}

function requiredAnyMatches(requiredAny: string[][] | undefined, fields: string[]) {
  if (!requiredAny?.length) return false;
  return requiredAny.some((group) => group.some((field) => fieldMatches(field, fields)));
}

function requiredAllMatch(required: string[] | undefined, fields: string[]) {
  if (!required?.length) return false;
  return required.every((field) => fieldMatches(field, fields));
}

function cloneArtifact(artifact: RuntimeArtifact): RuntimeArtifact {
  return {
    ...artifact,
    metadata: artifact.metadata ? { ...artifact.metadata } : undefined,
    data: artifact.data,
  };
}

function fixtureForVariant(module: RuntimeUIModule, variant: WorkbenchDemoVariant) {
  return workbenchComponentFixtures[module.componentId]?.[variant];
}

function fixtureArtifact(module: RuntimeUIModule, variant: WorkbenchDemoVariant): RuntimeArtifact | undefined {
  const fixture = fixtureForVariant(module, variant);
  const artifact = fixture?.artifact as RuntimeArtifact | undefined;
  return artifact ? normalizeWorkbenchFixtureArtifact(module.componentId, cloneArtifact(artifact)) as RuntimeArtifact : undefined;
}

function fixtureSlot(module: RuntimeUIModule, variant: WorkbenchDemoVariant): UIManifestSlot | undefined {
  const fixture = fixtureForVariant(module, variant);
  if (!fixture?.slot) return undefined;
  return {
    ...(fixture.slot as UIManifestSlot),
    title: module.title,
    componentId: module.componentId,
  };
}

function demoArtifact(module: RuntimeUIModule): RuntimeArtifact | undefined {
  const demo = module.workbenchDemo;
  if (!demo?.artifactData) return undefined;
  return {
    id: `workbench-demo-${module.moduleId}`,
    type: demo.artifactType ?? module.acceptsArtifactTypes[0] ?? defaultWorkbenchDemoContext.fallbackArtifactType,
    producerScenario: DEMO_SCENARIO,
    schemaVersion: demo.schemaVersion ?? '1',
    data: demo.artifactData,
  };
}

function artifactForShape(module: RuntimeUIModule, variant: WorkbenchDemoVariant) {
  return fixtureArtifact(module, variant) ?? fixtureArtifact(module, 'basic') ?? demoArtifact(module);
}

function artifactDataForFigureQA(artifact?: RuntimeArtifact) {
  const data = artifact?.data;
  if (!isRecord(data)) return undefined;
  const nested = data.plotSpec ?? data.figure ?? data.figureSpec;
  return isRecord(nested) ? nested : data;
}

function tracePalette(spec: Record<string, unknown>) {
  const traces = Array.isArray(spec.data) ? spec.data : [];
  const colors = traces.flatMap((trace) => {
    if (!isRecord(trace)) return [];
    const markerColor = isRecord(trace.marker) ? trace.marker.color : undefined;
    const lineColor = isRecord(trace.line) ? trace.line.color : undefined;
    return [markerColor, lineColor].flatMap((value) => Array.isArray(value) ? value : [value]).filter((value): value is string => typeof value === 'string');
  });
  return Array.from(new Set(colors)).slice(0, 8);
}

function vectorRasterStatus(format: string | undefined) {
  if (!format) return 'not declared';
  const normalized = format.toLowerCase();
  if (['svg', 'pdf', 'eps'].includes(normalized)) return `vector (${normalized})`;
  if (['png', 'tif', 'tiff', 'jpg', 'jpeg'].includes(normalized)) return `raster (${normalized})`;
  return format;
}

function figurePanelLabels(spec: Record<string, unknown>) {
  const panels = Array.isArray(spec.panels) ? spec.panels : undefined;
  if (panels) {
    const labels = panels.flatMap((panel) => isRecord(panel) && typeof panel.label === 'string' ? [panel.label] : []);
    if (labels.length) return labels.join(', ');
  }
  const layout = isRecord(spec.layout) ? spec.layout : undefined;
  const annotations = Array.isArray(layout?.annotations) ? layout.annotations : [];
  const labels = annotations.flatMap((annotation) => {
    if (!isRecord(annotation) || typeof annotation.text !== 'string') return [];
    return /^[A-Z]$/.test(annotation.text.trim()) ? [annotation.text.trim()] : [];
  });
  return labels.length ? labels.join(', ') : 'not declared';
}

function figureSize(spec: Record<string, unknown>, exportProfile?: Record<string, unknown>) {
  const layout = isRecord(spec.layout) ? spec.layout : undefined;
  const width = typeof exportProfile?.width === 'number' ? exportProfile.width : typeof layout?.width === 'number' ? layout.width : undefined;
  const height = typeof exportProfile?.height === 'number' ? exportProfile.height : typeof layout?.height === 'number' ? layout.height : undefined;
  return width && height ? `${width} x ${height}px` : 'not declared';
}

function figureFont(spec: Record<string, unknown>) {
  const layout = isRecord(spec.layout) ? spec.layout : undefined;
  const font = isRecord(layout?.font) ? layout.font : undefined;
  const family = asString(font?.family);
  const size = typeof font?.size === 'number' ? `${font.size}px` : undefined;
  return [family, size].filter(Boolean).join(', ') || 'not declared';
}

function figureDpi(exportProfile?: Record<string, unknown>) {
  if (typeof exportProfile?.dpi === 'number') return `${exportProfile.dpi} DPI`;
  if (typeof exportProfile?.scale === 'number') return `${exportProfile.scale}x export scale`;
  return 'not declared';
}

function figureDataSource(spec: Record<string, unknown>, artifact?: RuntimeArtifact) {
  return asString(artifact?.metadata?.source)
    ?? asString(spec.dataSource)
    ?? asString(spec.sourceDataRef)
    ?? asString(spec.dataRef)
    ?? 'not declared';
}

function figureStatisticalMethod(spec: Record<string, unknown>) {
  if (typeof spec.statisticalMethod === 'string') return spec.statisticalMethod;
  const statistics = isRecord(spec.statistics) ? spec.statistics : undefined;
  return asString(statistics?.method) ?? 'not declared';
}

function fixtureSession(module: RuntimeUIModule, variant: WorkbenchDemoVariant): Partial<SciForgeSession> | undefined {
  const session = fixtureForVariant(module, variant)?.session;
  return session && typeof session === 'object' ? session as Partial<SciForgeSession> : undefined;
}

function mergeSessionForComponent(base: SciForgeSession, module: RuntimeUIModule, variant: WorkbenchDemoVariant, artifact?: RuntimeArtifact): SciForgeSession {
  const session = { ...base, ...fixtureSession(module, variant) };
  if (!artifact) return session;
  return { ...session, artifacts: [artifact] };
}

export function availableWorkbenchDemoVariants(module: RuntimeUIModule): WorkbenchDemoVariant[] {
  const fixtureVariants = workbenchComponentFixtures[module.componentId] ?? {};
  const variants = workbenchDemoVariants.filter((variant) => Boolean(fixtureVariants[variant]));
  if (!variants.length && module.workbenchDemo?.artifactData) variants.push('basic');
  return variants;
}

export function moduleHasWorkbenchDemo(module: RuntimeUIModule): boolean {
  return availableWorkbenchDemoVariants(module).length > 0;
}

export function buildWorkbenchArtifactShapeExample(module: RuntimeUIModule, variant: WorkbenchDemoVariant = 'basic'): WorkbenchArtifactShapeExample {
  const artifact = artifactForShape(module, variant);
  return {
    artifactType: artifact?.type ?? module.acceptsArtifactTypes[0] ?? defaultWorkbenchDemoContext.fallbackArtifactType,
    schemaVersion: artifact?.schemaVersion ?? module.workbenchDemo?.schemaVersion ?? '1',
    requiredFields: module.requiredFields ?? [],
    requiredAnyFields: module.requiredAnyFields ?? [],
    exampleData: artifact?.data ?? module.workbenchDemo?.artifactData ?? {},
  };
}

export const workbenchModuleDisplayLabels = packageWorkbenchModuleDisplayLabels;

export function recommendWorkbenchComponents(
  modules: RuntimeUIModule[],
  input: { artifactType?: string; artifactSchema?: unknown; artifactData?: unknown },
): WorkbenchComponentRecommendation[] {
  const artifactType = input.artifactType?.trim();
  const fields = Array.from(new Set([...fieldsFromSchema(input.artifactSchema), ...dataFieldsFromArtifactData(input.artifactData)]));
  return modules
    .map((module) => {
      const reasons: string[] = [];
      let score = 0;
      if (artifactType && module.acceptsArtifactTypes.includes(artifactType)) {
        score += 10;
        reasons.push(`accepts ${artifactType}`);
      }
      if (artifactType && module.outputArtifactTypes?.includes(artifactType)) {
        score += 2;
        reasons.push(`outputs ${artifactType}`);
      }
      if (fields.length && requiredAllMatch(module.requiredFields, fields)) {
        score += 5;
        reasons.push(`required fields matched: ${module.requiredFields?.join(', ')}`);
      }
      if (fields.length && requiredAnyMatches(module.requiredAnyFields, fields)) {
        score += 4;
        reasons.push('required-any fields matched');
      }
      const boost = workbenchComponentRecommendationBoost({ componentId: module.componentId, artifactType, fields });
      score += boost.score;
      reasons.push(...boost.reasons);
      if (!artifactType && !fields.length && module.lifecycle === 'published') {
        score += 1;
        reasons.push('published component');
      }
      return {
        componentId: module.componentId,
        moduleId: module.moduleId,
        title: module.title,
        score,
        reasons,
        fallbackModuleIds: module.fallbackModuleIds ?? [],
        alternateModuleLabels: workbenchModuleDisplayLabels(modules, module.fallbackModuleIds),
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.componentId.localeCompare(b.componentId));
}

export function buildWorkbenchInteractionEventLog(module: RuntimeUIModule, variant: WorkbenchDemoVariant = 'selection'): string[] {
  const fixture = fixtureForVariant(module, variant) ?? fixtureForVariant(module, 'selection') ?? fixtureForVariant(module, 'basic');
  const props = isRecord(fixture?.slot?.props) ? fixture.slot.props : {};
  const expected = Array.isArray(props.expectedEvents) ? props.expectedEvents : [];
  const eventLog = expected.map((event) => isRecord(event) ? JSON.stringify(event) : String(event));
  if (eventLog.length) return eventLog;
  const artifact = fixture?.artifact as RuntimeArtifact | undefined;
  const spec = artifactDataForFigureQA(artifact);
  const selection = isRecord(spec?.selection) ? spec.selection : undefined;
  if (selection) {
    const source = asString(selection.eventSource) ?? 'selection';
    const points = Array.isArray(selection.pointIndices) ? `${selection.pointIndices.length} point(s)` : 'selected region';
    return [`${source}: ${points}`];
  }
  return (module.interactionEvents ?? []).map((event) => `${event}: no fixture event payload declared`);
}

export function buildWorkbenchFigureQA(module: RuntimeUIModule, variant: WorkbenchDemoVariant = 'basic', artifactOverride?: RuntimeArtifact): WorkbenchFigureQA | undefined {
  if (!shouldBuildWorkbenchFigureQA(module.componentId)) return undefined;
  const artifact = artifactOverride ?? artifactForShape(module, variant);
  const spec = artifactDataForFigureQA(artifact);
  if (!spec) return undefined;
  const exportProfile = isRecord(spec.exportProfile) ? spec.exportProfile : undefined;
  const palette = tracePalette(spec);
  return {
    size: figureSize(spec, exportProfile),
    dpi: figureDpi(exportProfile),
    font: figureFont(spec),
    palette: palette.length ? palette.join(', ') : 'not declared',
    colorblindSafety: typeof exportProfile?.colorblindSafe === 'boolean' ? (exportProfile.colorblindSafe ? 'declared safe' : 'declared unsafe') : asString(spec.colorblindSafety) ?? 'not declared',
    panelLabels: figurePanelLabels(spec),
    vectorRasterStatus: vectorRasterStatus(asString(exportProfile?.format)),
    dataSource: figureDataSource(spec, artifact),
    statisticalMethod: figureStatisticalMethod(spec),
  };
}

export function buildWorkbenchDemoRenderProps(module: RuntimeUIModule, config: SciForgeConfig, variant: WorkbenchDemoVariant = 'basic'): {
  scenarioId: ScenarioId;
  config: SciForgeConfig;
  session: SciForgeSession;
  slot: UIManifestSlot;
  artifact?: RuntimeArtifact;
  variant: WorkbenchDemoVariant;
} {
  const baseSession = createSession(DEMO_SCENARIO, '组件工作台 Demo', {});
  const fixtureVariant = fixtureForVariant(module, variant) ? variant : 'basic';
  const artifact = fixtureArtifact(module, fixtureVariant) ?? demoArtifact(module);
  const session = mergeSessionForComponent(baseSession, module, fixtureVariant, artifact);
  const slot: UIManifestSlot = fixtureSlot(module, fixtureVariant) ?? {
    componentId: module.componentId,
    title: module.title,
    artifactRef: artifact?.id,
  };
  return {
    scenarioId: DEMO_SCENARIO,
    config,
    session,
    slot,
    artifact,
    variant,
  };
}
