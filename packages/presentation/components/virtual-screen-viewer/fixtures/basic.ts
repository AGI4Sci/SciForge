import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';
import { VIRTUAL_SCREEN_VIEWER_ARTIFACT_TYPE, VIRTUAL_SCREEN_VIEWER_SCHEMA_VERSION } from '../manifest';

export const basicVirtualScreenViewerFixture: UIComponentRendererProps = {
  slot: { componentId: 'virtual-screen-viewer', title: 'Virtual Screen' },
  artifact: {
    id: 'virtual-screen-basic',
    type: VIRTUAL_SCREEN_VIEWER_ARTIFACT_TYPE,
    producerScenario: 'computer-use',
    schemaVersion: VIRTUAL_SCREEN_VIEWER_SCHEMA_VERSION,
    data: {
      title: 'Virtual Screen',
      status: 'blocked',
      sessionRef: 'computer-use:session/basic/virtual-desktop-session-manifest.json',
      displayGroupRef: 'computer-use:session/basic/virtual-display-group.json',
      screenRef: 'computer-use:session/basic/virtual-screens.json#screen-1',
      frameRef: 'computer-use:session/basic/frames/latest.png',
      replayRef: 'computer-use:session/basic/replay-bundle.json',
      permissionRef: 'computer-use:permission/basic.json',
      stopRef: 'computer-use:stop/basic',
      cancelLeaseRef: 'computer-use:lease/basic',
      screen: { width: 1440, height: 900, label: 'screen-1' },
      actorCursors: [
        { actorId: 'user', cursorId: 'cursor-user', label: 'User', color: '#38bdf8', x: 240, y: 180, state: 'pointing' },
        { actorId: 'agent-1', cursorId: 'cursor-agent', label: 'Agent', color: '#00e5a0', x: 820, y: 430, state: 'proposing' },
      ],
      isolation: {
        sharedSystemInputUsed: false,
        systemPointerMoved: false,
        systemKeyboardEventsSent: false,
        inputExecuted: false,
        diagnosticOnly: true,
      },
      events: [
        { label: 'Session skeleton created', ref: 'computer-use:session/basic/virtual-desktop-session-manifest.json' },
        { label: 'Isolated backend missing', ref: 'computer-use:session/basic/blocked/backend.json' },
      ],
    },
  },
};
