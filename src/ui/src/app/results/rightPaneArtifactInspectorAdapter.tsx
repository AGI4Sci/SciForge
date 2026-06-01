import type { ScenarioId } from '../../data';
import type { RuntimeArtifact, SciForgeSession } from '../../domain';
import { ArtifactInspectorDrawer } from '../results-renderer-artifact-inspector';

export interface RightPaneArtifactInspectorDrawerProps {
  scenarioId: ScenarioId;
  session: SciForgeSession;
  artifact?: RuntimeArtifact;
  executionFocus: boolean;
  onClose: () => void;
  onArtifactHandoff: (targetScenario: ScenarioId, artifact: RuntimeArtifact) => void;
}

export function RightPaneArtifactInspectorDrawer({
  scenarioId,
  session,
  artifact,
  executionFocus,
  onClose,
  onArtifactHandoff,
}: RightPaneArtifactInspectorDrawerProps) {
  if (executionFocus || !artifact) return null;
  return (
    <ArtifactInspectorDrawer
      scenarioId={scenarioId}
      session={session}
      artifact={artifact}
      onClose={onClose}
      onArtifactHandoff={onArtifactHandoff}
    />
  );
}
