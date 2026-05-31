import type { UIComponentManifest } from '@sciforge-ui/runtime-contract';

export const manifest: UIComponentManifest = {
  packageName: '@sciforge-ui/browser-workbench',
  moduleId: 'browser-workbench-panel',
  version: '1.0.0',
  title: 'Browser workbench',
  description: 'Presentation-only right-pane browser session state machine, tab, snapshot, refs, and terminal-equivalent command surface for browser_runtime projections.',
  componentId: 'browser-workbench',
  lifecycle: 'published',
  outputArtifactTypes: ['browser-workbench'],
  acceptsArtifactTypes: [
    'browser-runtime-projection',
    'browser-session',
    'browser-snapshot',
    'browser-feedback-bundle',
  ],
  consumes: [
    {
      kinds: ['html', 'text'],
      mediaTypes: ['text/html', 'text/plain', 'application/json'],
      previewPolicies: ['inline'],
    },
  ],
  viewParams: ['session', 'activeTab', 'snapshot', 'traceRefs', 'commands', 'state', 'embedPolicy', 'capabilities', 'previewUrl'],
  interactionEvents: [
    'browser-command-request',
    'open-url-request',
    'back-request',
    'forward-request',
    'reload-request',
    'stop-loading-request',
    'snapshot-request',
    'state-request',
    'takeover-request',
    'copy-url-request',
    'open-external-request',
    'focus-tab',
    'copy-ref-request',
  ],
  roleDefaults: ['software-engineer', 'runtime-operator'],
  fallbackModuleIds: ['generic-artifact-inspector'],
  defaultSection: 'primary',
  priority: 8,
  safety: { sandbox: true, externalResources: 'declared-only', executesCode: false },
  presentation: {
    dedupeScope: 'entity',
    identityFields: ['session.id', 'sessionId', 'activeTab.id', 'url', 'previewUrl'],
  },
  docs: {
    readmePath: 'packages/presentation/components/browser-workbench/README.md',
    agentSummary: 'Use for displaying an existing browser_runtime projection in the right pane. It renders idle/loading/ready/blocked/error/offline as typed browser states, emits terminal-equivalent browser command events, and keeps TUI/runtime responsible for provider routing, page actions, snapshots, logs, downloads, external opening, and approvals.',
  },
  workbenchDemo: {
    artifactType: 'browser-runtime-projection',
    artifactData: {
      session: {
        id: 'browser-session-demo',
        mode: 'agent-headless',
        providerId: 'sciforge.observe.browser-runtime',
        activeTabId: 'tab-1',
        tabs: [
          { id: 'tab-1', url: 'http://localhost:5173/', title: 'SciForge', status: 'ready' },
        ],
      },
      snapshot: {
        schemaVersion: 'sciforge.browser-runtime.snapshot.v1',
        url: 'http://localhost:5173/',
        title: 'SciForge',
        screenshotRef: 'blob://browser/demo-screenshot.png',
        domSnapshotRef: 'blob://browser/demo-dom.json',
      },
      traceRefs: [
        { kind: 'screenshot', ref: 'blob://browser/demo-screenshot.png' },
        { kind: 'dom-snapshot', ref: 'blob://browser/demo-dom.json' },
      ],
    },
  },
};
