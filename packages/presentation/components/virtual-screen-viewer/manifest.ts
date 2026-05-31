import type { UIComponentManifest } from '@sciforge-ui/runtime-contract';

export const VIRTUAL_SCREEN_VIEWER_COMPONENT_ID = 'virtual-screen-viewer';
export const VIRTUAL_SCREEN_VIEWER_ARTIFACT_TYPE = 'computer-use-virtual-screen';
export const VIRTUAL_SCREEN_VIEWER_SCHEMA_VERSION = 'sciforge.computer-use.virtual-screen.v1';

export const manifest: UIComponentManifest = {
  packageName: '@sciforge-ui/virtual-screen-viewer',
  moduleId: 'virtual-screen-panel',
  version: '1.0.0',
  title: 'Virtual screen viewer',
  description: 'Presentation-only Computer Use virtual display/session viewer with actor cursors, refs, isolation flags, and replay status.',
  componentId: VIRTUAL_SCREEN_VIEWER_COMPONENT_ID,
  lifecycle: 'published',
  outputArtifactTypes: [VIRTUAL_SCREEN_VIEWER_ARTIFACT_TYPE],
  acceptsArtifactTypes: [
    VIRTUAL_SCREEN_VIEWER_ARTIFACT_TYPE,
    'virtual-desktop-session',
    'computer-use-screen',
    'computer-use-replay',
  ],
  viewParams: ['sessionRef', 'screenRef', 'frameRef', 'replayRef', 'actorCursors', 'isolation'],
  interactionEvents: ['virtual-screen-terminal-equivalent-text'],
  roleDefaults: ['desktop-operator', 'runtime-operator'],
  fallbackModuleIds: ['computer-use-control-plane', 'generic-artifact-inspector'],
  defaultSection: 'primary',
  priority: 8,
  safety: { sandbox: false, externalResources: 'none', executesCode: false },
  presentation: {
    dedupeScope: 'entity',
    identityFields: ['sessionRef', 'screenRef', 'frameRef', 'replayRef'],
  },
  docs: {
    readmePath: 'packages/presentation/components/virtual-screen-viewer/README.md',
    agentSummary: 'Use only for displaying Computer Use virtual screen/session refs. The GUI never executes input, never owns scheduler leases, and never accepts raw coordinates, desktop bridge params, provider routes, or inline screenshots.',
  },
  workbenchDemo: {
    artifactType: VIRTUAL_SCREEN_VIEWER_ARTIFACT_TYPE,
    schemaVersion: VIRTUAL_SCREEN_VIEWER_SCHEMA_VERSION,
    artifactData: {
      schemaVersion: VIRTUAL_SCREEN_VIEWER_SCHEMA_VERSION,
      sessionRef: 'computer-use:session/demo/virtual-desktop-session-manifest.json',
      displayGroupRef: 'computer-use:session/demo/virtual-display-group.json',
      screenRef: 'computer-use:session/demo/virtual-screens.json#screen-1',
      frameRef: 'computer-use:session/demo/frames/latest.png',
      replayRef: 'computer-use:session/demo/replay-bundle.json',
      status: 'blocked',
      title: 'Virtual Screen',
      screen: { width: 1440, height: 900, label: 'screen-1' },
      actorCursors: [
        { actorId: 'user', cursorId: 'cursor-user', label: 'User', color: '#38bdf8', x: 260, y: 240, state: 'pointing' },
        { actorId: 'agent-1', cursorId: 'cursor-agent', label: 'Agent', color: '#00e5a0', x: 860, y: 460, state: 'proposing' },
      ],
      isolation: {
        sharedSystemInputUsed: false,
        systemPointerMoved: false,
        systemKeyboardEventsSent: false,
        inputExecuted: false,
        diagnosticOnly: true,
      },
      events: [
        { label: 'Session skeleton ready', ref: 'computer-use:session/demo/virtual-desktop-session-manifest.json' },
        { label: 'Waiting for isolated display backend', ref: 'computer-use:session/demo/blocked/backend.json' },
      ],
    },
  },
};
