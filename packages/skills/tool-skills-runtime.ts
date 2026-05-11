import { toolPackageManifests } from './tool_skills';
import type { ToolPackageManifest } from './tool_skills/types';

export function selectedToolContractForRuntime(toolId: string): Record<string, unknown> {
  const manifest = (toolPackageManifests as readonly ToolPackageManifest[]).find((tool) => tool.id === toolId);
  if (!manifest) return { id: toolId, selected: true };
  if (!manifest.sensePlugin) return { id: manifest.id, selected: true };
  return {
    id: manifest.id,
    selected: true,
    kind: manifest.toolType,
    modality: manifest.sensePlugin.modality,
    packageRoot: manifest.packageRoot,
    readmePath: manifest.docs.readmePath,
    skillTemplate: 'packages/skills/installed/local/vision-gui-task/SKILL.md',
    inputContract: { ...manifest.sensePlugin.inputContract },
    outputContract: {
      ...manifest.sensePlugin.outputContract,
      actions: ['click', 'type_text', 'press_key', 'scroll', 'wait'],
    },
    executionBoundary: manifest.sensePlugin.executionBoundary,
    missingRuntimeBridgePolicy: {
      behavior: 'diagnose-or-fail-closed',
      reason: `${manifest.id} only emits auditable text signals and trace refs; a browser/desktop executor bridge plus screenshot source must execute real GUI actions.`,
      noFallbackRepoScan: true,
      expectedFailureUnit: 'Return failed-with-reason when no GUI executor/screenshot bridge is configured for this run.',
    },
    computerUsePolicy: {
      executorOwnedBy: 'upstream Computer Use provider or browser/desktop adapter',
      noDomOrAccessibilityReads: true,
      highRiskPolicy: 'reject unless explicitly confirmed upstream',
      tracePolicy: 'preserve screenshot refs, planned action, grounding summary, execution status, pixel diff, and failureReason; never inline screenshot base64 into chat context',
    },
  };
}
