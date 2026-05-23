import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const emptyTerminalSessionViewerFixture: UIComponentRendererProps = {
  slot: { componentId: 'terminal-session-viewer', props: { status: 'idle', buffer: '' } },
  artifact: {
    id: 'terminal-session-empty',
    type: 'terminal-session',
    producerScenario: 'terminal-session-preview',
    schemaVersion: '0.1.0',
    data: {
      status: 'idle',
      buffer: '',
      capabilities: { input: false, paste: false, resize: true, copy: false, download: false, stop: false, focus: true },
    },
  },
};
