import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const basicTerminalSessionViewerFixture: UIComponentRendererProps = {
  slot: {
    componentId: 'terminal-session-viewer',
    title: 'Runtime terminal',
    props: {
      sessionRef: 'terminal:run-rt-03',
      status: 'running',
      title: 'RT-03 package test',
      rows: 20,
      cols: 100,
      capabilities: {
        input: true,
        paste: true,
        resize: true,
        copy: true,
        download: true,
        stop: true,
        focus: true,
      },
      theme: 'dark',
      metadata: {
        cwd: '/workspace/SciForge',
        shell: 'zsh',
      },
    },
  },
  artifact: {
    id: 'terminal-session-basic',
    type: 'terminal-session',
    producerScenario: 'terminal-session-preview',
    schemaVersion: '0.1.0',
    data: {
      sessionRef: 'terminal:run-rt-03',
      status: 'running',
      buffer: '$ npm test\n> node --import tsx --test\nok 1 renderTerminalSessionViewer',
    },
  },
};
