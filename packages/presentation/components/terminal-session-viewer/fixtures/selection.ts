import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const selectionTerminalSessionViewerFixture: UIComponentRendererProps = {
  slot: {
    componentId: 'terminal-session-viewer',
    props: {
      mode: 'transcript',
      sessionRef: 'terminal:selected-output',
      sessionId: 'selected-output',
      status: 'stopped',
      cwd: '/workspace/SciForge',
      exitCode: 0,
      completedAt: '2026-05-31T09:35:12.000Z',
      selection: { text: 'ok 1 renderTerminalSessionViewer', range: '3:1-3:32' },
      capabilities: { copy: true, download: true, stop: false, focus: true },
    },
  },
  artifact: {
    id: 'terminal-session-selection',
    type: 'terminal-session',
    producerScenario: 'terminal-session-preview',
    schemaVersion: '0.1.0',
    data: {
      sessionRef: 'terminal:selected-output',
      status: 'stopped',
      buffer: ['TAP version 13', '# terminal-session-viewer', 'ok 1 renderTerminalSessionViewer'],
    },
  },
};
