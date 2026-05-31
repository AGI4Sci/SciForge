import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';
import {
  COMPUTER_USE_CONTROL_PLANE_ARTIFACT_TYPE,
  COMPUTER_USE_CONTROL_PLANE_COMPONENT_ID,
  COMPUTER_USE_CONTROL_PLANE_SCHEMA_VERSION,
} from '../contract';

export const basicComputerUseControlPlaneFixture: UIComponentRendererProps = {
  slot: {
    componentId: COMPUTER_USE_CONTROL_PLANE_COMPONENT_ID,
    title: 'Computer Use controls',
  },
  artifact: {
    id: 'computer-use-control-plane-basic',
    type: COMPUTER_USE_CONTROL_PLANE_ARTIFACT_TYPE,
    producerScenario: 'computer-use',
    schemaVersion: COMPUTER_USE_CONTROL_PLANE_SCHEMA_VERSION,
    data: {
      schemaVersion: COMPUTER_USE_CONTROL_PLANE_SCHEMA_VERSION,
      sessionRef: 'computer-use-session:basic',
      sessionPermissionRef: 'computer-use:permission/basic-session.json',
      allowedAppRefs: ['computer-use:allowlist/apps/presentation.json'],
      allowedWindowRefs: ['computer-use:allowlist/windows/keynote.json'],
      forbiddenAppRefs: ['computer-use:allowlist/forbidden/messages.json'],
      riskPreviewRef: 'computer-use:risk/basic-preview.json',
      dataVisibilityRef: 'computer-use:data-visibility/basic.json',
      stopRef: 'computer-use:stop/basic',
      cancelLeaseRef: 'computer-use:lease/basic',
      approvalMode: 'required',
      status: 'needs-confirmation',
      approvalRef: 'approval:computer-use:basic',
      approvalRequestRef: 'computer-use:approval/basic-request.json',
      riskLevel: 'high',
      message: 'Guarded desktop action is waiting for user confirmation.',
    },
  },
};
