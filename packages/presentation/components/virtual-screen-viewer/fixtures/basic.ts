import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';
import { VIRTUAL_SCREEN_VIEWER_ARTIFACT_TYPE, VIRTUAL_SCREEN_VIEWER_SCHEMA_VERSION } from '../manifest';

export const basicVirtualScreenViewerFixture: UIComponentRendererProps = {
  slot: { componentId: 'virtual-screen-viewer', title: 'VirtualAppScreen' },
  artifact: {
    id: 'virtual-app-screen-basic',
    type: VIRTUAL_SCREEN_VIEWER_ARTIFACT_TYPE,
    producerScenario: 'computer-use',
    schemaVersion: VIRTUAL_SCREEN_VIEWER_SCHEMA_VERSION,
    data: {
      title: 'VirtualAppScreen',
      status: 'blocked',
      attachState: 'blocked',
      targetAppRef: 'app:native-research-app',
      targetWindowRef: 'window:native-research-app/main',
      sessionRef: 'computer-use:session/basic/app-screen-session.json',
      displayGroupRef: 'computer-use:session/basic/platform-display-group.json',
      screenRef: 'virtual-app-screen:basic/screen-1',
      liveSurfaceRef: 'computer-use:session/basic/live-surface.json',
      surfaceTransport: 'native-frame-stream',
      platformDriverRef: 'computer-use:session/basic/platform-driver.json',
      platformDriverStatus: 'missing',
      frameStreamRef: 'computer-use:session/basic/frame-stream.json',
      currentFrameRef: 'computer-use:session/basic/frames/latest.png',
      beforeFrameRef: 'computer-use:session/basic/frames/before.png',
      afterFrameRef: 'computer-use:session/basic/frames/after.png',
      beforeEvidenceRef: 'computer-use:session/basic/evidence/before.json',
      afterEvidenceRef: 'computer-use:session/basic/evidence/after.json',
      beforeAfterFrameRefs: [
        'computer-use:session/basic/before-after/observe.json',
      ],
      actorCursorRefs: [
        'computer-use:session/basic/cursors/user.json',
        'computer-use:session/basic/cursors/agent-1.json',
      ],
      annotationOverlayRefs: [
        'computer-use:session/basic/overlays/user-highlight.json',
        'computer-use:session/basic/overlays/agent-target.json',
      ],
      annotationProposalRefs: [
        'computer-use:session/basic/proposals/agent-click.json',
      ],
      inputIntentRefs: [
        'computer-use:session/basic/input-intents/click-observe.json',
      ],
      executorEventRefs: [
        'computer-use:session/basic/executor-events/click-observe.json',
      ],
      inputLeaseRef: 'computer-use:session/basic/input-leases/screen-1-active.json',
      actionAdapterRef: 'computer-use:session/basic/action-adapters/native-app-window.json',
      adapterReadinessRef: 'computer-use:session/basic/adapter-readiness/native-app-window.json',
      replayRef: 'computer-use:session/basic/replay-bundle.json',
      evidenceLedgerRef: 'computer-use:session/basic/evidence-ledger.json',
      artifactRefs: [
        'artifact:research-note.md',
      ],
      verificationRefs: [
        'computer-use:session/basic/verification/final-artifact.json',
      ],
      guiPresentRefs: [
        'gui:present/basic-screen-pane',
      ],
      blockedRef: 'computer-use:session/basic/blocked/backend.json',
      blockedReason: 'Platform virtual display driver missing',
      permissionRef: 'computer-use:session/basic/permissions/platform-capture.json',
      permissionStatus: 'denied',
      permissionRequired: true,
      permissionGranted: false,
      sharedInputAllowed: false,
      stopRef: 'computer-use:session/basic/stop.json',
      isolationFlags: {
        affectsPhysicalDisplay: false,
        requiresFocusSteal: false,
        sharedSystemInputUsed: false,
        systemPointerMoved: false,
        systemKeyboardEventsSent: false,
        backgroundRenderable: false,
        singleInteractiveTruth: true,
        secondInteractiveSurfacePresent: false,
        diagnosticOnly: true,
      },
    },
  },
};
