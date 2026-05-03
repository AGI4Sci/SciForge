import type { ScenarioId } from './data';
import {
  nowIso,
  type EvidenceClaim,
  type NotebookRecord,
  type RuntimeArtifact,
  type RuntimeExecutionUnit,
  type SciForgeConfig,
  type SciForgeSession,
  type UIManifestSlot,
} from './domain';
import { getMoleculeWorkbenchDemoArtifactData } from './moleculeWorkbenchDemoStructures';
import { createSession } from './sessionStore';
import type { RuntimeUIModule } from './uiModuleRegistry';

const DEMO_SCENARIO: ScenarioId = 'literature-evidence-review';

function demoArtifact(module: RuntimeUIModule): RuntimeArtifact | undefined {
  if (module.componentId === 'molecule-viewer') {
    return {
      id: `workbench-demo-${module.moduleId}`,
      type: module.workbenchDemo?.artifactType ?? 'structure-summary',
      producerScenario: DEMO_SCENARIO,
      schemaVersion: module.workbenchDemo?.schemaVersion ?? '1',
      metadata: {
        title: 'Crambin · PDB 1CRN',
        pdbId: '1CRN',
      },
      data: getMoleculeWorkbenchDemoArtifactData(),
    };
  }
  const demo = module.workbenchDemo;
  if (!demo?.artifactData) return undefined;
  return {
    id: `workbench-demo-${module.moduleId}`,
    type: demo.artifactType ?? module.acceptsArtifactTypes[0] ?? 'runtime-artifact',
    producerScenario: DEMO_SCENARIO,
    schemaVersion: demo.schemaVersion ?? '1',
    data: demo.artifactData,
  };
}

function mergeSessionForComponent(module: RuntimeUIModule, base: SciForgeSession): SciForgeSession {
  const cid = module.componentId;
  const now = nowIso();

  if (cid === 'evidence-matrix') {
    const claims: EvidenceClaim[] = [{
      id: 'demo-claim-1',
      text: '示例主张：处理后目标通路活性显著变化（工作台 Demo）。',
      type: 'hypothesis',
      confidence: 0.72,
      evidenceLevel: 'experimental',
      supportingRefs: ['artifact:demo-evidence'],
      opposingRefs: ['run:demo-opposing'],
      dependencyRefs: ['belief:demo-dep'],
      updateReason: 'workbench demo',
      updatedAt: now,
    }, {
      id: 'demo-claim-2',
      text: '对照主张：批次效应需要额外校正（示例）。',
      type: 'inference',
      confidence: 0.55,
      evidenceLevel: 'review',
      supportingRefs: [],
      opposingRefs: [],
      updatedAt: now,
    }];
    const demoFigureUpload: RuntimeArtifact = {
      id: 'workbench-demo-upload-fig',
      type: 'uploaded-figure',
      producerScenario: DEMO_SCENARIO,
      schemaVersion: '1',
      metadata: {
        source: 'user-upload',
        title: 'Demo 上传示意图',
        mimeType: 'image/png',
        size: 95,
      },
      data: {
        previewKind: 'image',
        dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z/C/HcDFwMDAwMDEAABSOwXWZIq0pAAAAABJRU5ErkJggg==',
      },
    };
    return { ...base, claims, artifacts: [demoFigureUpload] };
  }

  if (cid === 'execution-unit-table') {
    const executionUnits: RuntimeExecutionUnit[] = [{
      id: 'demo-eu-1',
      tool: 'demo-analysis',
      params: '{"mode":"smoke","seed":42}',
      status: 'done',
      hash: 'demo-hash-0001',
      language: 'python',
      code: 'print("workbench demo execution unit")',
      environment: 'local-demo',
      stdoutRef: '.sciforge/logs/demo-eu-1.stdout.txt',
    }, {
      id: 'demo-eu-2',
      tool: 'demo-qc',
      params: '{"qc":"fast"}',
      status: 'record-only',
      hash: 'demo-hash-0002',
      language: 'r',
      codeRef: '.sciforge/code/qc.R',
      stderrRef: '.sciforge/logs/demo-eu-2.stderr.txt',
      environment: 'local-demo',
    }];
    return { ...base, executionUnits };
  }

  if (cid === 'notebook-timeline') {
    const notebook: NotebookRecord[] = [{
      id: 'demo-note-1',
      time: new Date().toLocaleString('zh-CN', { hour12: false }),
      scenario: DEMO_SCENARIO,
      title: '示例研究记录',
      desc: '内置 notebook 条目，用于在工作台一键确认时间线组件可用。',
      claimType: 'fact',
      confidence: 0.88,
      artifactRefs: ['workbench-demo-note-ref'],
      updateReason: 'workbench demo',
    }];
    return { ...base, notebook };
  }

  const artifact = demoArtifact(module);
  if (!artifact) return base;
  return { ...base, artifacts: [artifact] };
}

export function moduleHasWorkbenchDemo(module: RuntimeUIModule): boolean {
  const cid = module.componentId;
  if (cid === 'evidence-matrix' || cid === 'execution-unit-table' || cid === 'notebook-timeline') return true;
  return Boolean(module.workbenchDemo?.artifactData);
}

export function buildWorkbenchDemoRenderProps(module: RuntimeUIModule, config: SciForgeConfig): {
  scenarioId: ScenarioId;
  config: SciForgeConfig;
  session: SciForgeSession;
  slot: UIManifestSlot;
  artifact?: RuntimeArtifact;
} {
  const baseSession = createSession(DEMO_SCENARIO, '组件工作台 Demo', {});
  const session = mergeSessionForComponent(module, baseSession);
  const artifact = demoArtifact(module);
  const slot: UIManifestSlot = {
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
  };
}
