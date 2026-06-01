import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';
import { VIRTUAL_SCREEN_VIEWER_ARTIFACT_TYPE, VIRTUAL_SCREEN_VIEWER_SCHEMA_VERSION } from '../manifest';

export const visualRegressionVirtualScreenViewerFixture: UIComponentRendererProps = {
  slot: { componentId: 'virtual-screen-viewer', title: 'VirtualAppScreen Visual Guard' },
  artifact: {
    id: 'virtual-app-screen-visual-regression',
    type: VIRTUAL_SCREEN_VIEWER_ARTIFACT_TYPE,
    producerScenario: 'computer-use',
    schemaVersion: VIRTUAL_SCREEN_VIEWER_SCHEMA_VERSION,
    data: {
      title: 'VirtualAppScreen Visual Guard',
      status: 'running',
      attachState: 'attached',
      targetAppRef: 'app:native-research-app',
      targetWindowRef: 'window:native-research-app/main',
      sessionRef: 'computer-use:session/visual-regression/app-screen-session.json',
      displayGroupRef: 'computer-use:session/visual-regression/platform-display-group.json',
      screenRef: 'virtual-app-screen:visual-regression/screen-1',
      liveSurfaceRef: 'computer-use:session/visual-regression/live-surface.json',
      surfaceTransport: 'native-frame-stream',
      platformDriverRef: 'computer-use:session/visual-regression/platform-driver.json',
      platformDriverStatus: 'ready',
      frameStreamRef: 'computer-use:session/visual-regression/frame-stream.json',
      currentFrameRef: 'computer-use:session/visual-regression/frames/active.png',
      beforeFrameRef: 'computer-use:session/visual-regression/frames/before.png',
      afterFrameRef: 'computer-use:session/visual-regression/frames/after.png',
      beforeEvidenceRef: 'computer-use:session/visual-regression/evidence/before.json',
      afterEvidenceRef: 'computer-use:session/visual-regression/evidence/after.json',
      beforeAfterFrameRefs: [
        'computer-use:session/visual-regression/before-after/click-confirm.json',
      ],
      actorCursorRefs: [
        'computer-use:session/visual-regression/cursors/observer.json',
        'computer-use:session/visual-regression/cursors/agent.json',
      ],
      annotationOverlayRefs: [
        'computer-use:session/visual-regression/overlays/cursors-active.json',
        'computer-use:session/visual-regression/overlays/highlight-target.json',
      ],
      annotationProposalRefs: [
        'computer-use:session/visual-regression/proposals/click-confirm.json',
      ],
      inputIntentRefs: [
        'computer-use:session/visual-regression/input-intents/click-confirm.json',
      ],
      executorEventRefs: [
        'computer-use:session/visual-regression/executor-events/click-confirm.json',
      ],
      inputLeaseRef: 'computer-use:session/visual-regression/input-leases/main-held.json',
      actionAdapterRef: 'computer-use:session/visual-regression/action-adapters/native-app-window.json',
      adapterReadinessRef: 'computer-use:session/visual-regression/adapter-readiness/native-app-window.json',
      replayRef: 'computer-use:session/visual-regression/replay.json',
      evidenceLedgerRef: 'computer-use:session/visual-regression/evidence-ledger.json',
      permissionRef: 'computer-use:session/visual-regression/permissions/platform-capture.json',
      permissionStatus: 'granted',
      permissionRequired: true,
      permissionGranted: true,
      sharedInputAllowed: false,
      artifactRefs: [
        'artifact:visual-regression-research-note.md',
      ],
      verificationRefs: [
        'computer-use:session/visual-regression/verification/artifact.json',
      ],
      guiPresentRefs: [
        'gui:present/visual-regression-screen-pane',
      ],
      stopRef: 'computer-use:session/visual-regression/stop.json',
      isolationFlags: {
        affectsPhysicalDisplay: false,
        requiresFocusSteal: false,
        sharedSystemInputUsed: false,
        systemPointerMoved: false,
        systemKeyboardEventsSent: false,
        backgroundRenderable: true,
        singleInteractiveTruth: true,
        secondInteractiveSurfacePresent: false,
        diagnosticOnly: false,
      },
    },
  },
};
