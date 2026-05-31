import type { UIComponentManifest } from '@sciforge-ui/runtime-contract';

export const manifest: UIComponentManifest = {
  packageName: '@sciforge-ui/terminal-session-viewer',
  moduleId: 'terminal-session-viewer-panel',
  version: '1.0.0',
  title: 'Terminal session viewer',
  description: 'Pure presentation renderer for interactive terminal session buffers and host-declared terminal events.',
  componentId: 'terminal-session-viewer',
  lifecycle: 'published',
  outputArtifactTypes: ['terminal-session'],
  acceptsArtifactTypes: ['terminal-session', 'terminal-buffer', 'runtime-terminal-session'],
  viewParams: ['sessionRef', 'status', 'buffer', 'title', 'capabilities', 'theme', 'metadata'],
  interactionEvents: [
    'data-input',
    'paste-input',
    'resize',
    'copy-request',
    'download-request',
    'stop-request',
    'focus-change',
  ],
  roleDefaults: ['developer', 'runtime-operator'],
  fallbackModuleIds: ['generic-artifact-inspector'],
  defaultSection: 'primary',
  priority: 35,
  safety: { sandbox: false, externalResources: 'none', executesCode: false },
  presentation: {
    dedupeScope: 'entity',
    identityFields: ['sessionRef', 'sessionId', 'terminalSessionId', 'dataRef', 'outputRef'],
  },
  docs: {
    readmePath: 'packages/presentation/components/terminal-session-viewer/README.md',
    agentSummary: 'Use only for displaying an existing interactive terminal session. The renderer never starts processes, providers, sockets, commands, or workspace writes; host code owns all side effects.',
  },
};
