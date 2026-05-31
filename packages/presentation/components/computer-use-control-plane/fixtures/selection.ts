import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';
import {
  COMPUTER_USE_CONTROL_PLANE_ARTIFACT_TYPE,
  COMPUTER_USE_CONTROL_PLANE_COMPONENT_ID,
  COMPUTER_USE_CONTROL_PLANE_SCHEMA_VERSION,
} from '../contract';

export const selectionComputerUseControlPlaneFixture: UIComponentRendererProps = {
  slot: {
    componentId: COMPUTER_USE_CONTROL_PLANE_COMPONENT_ID,
    props: {
      status: 'running',
      approvalMode: 'not-required',
      stopRef: 'computer-use:stop/selection',
      cancelLeaseRef: 'computer-use:lease/selection',
    },
  },
  artifact: {
    id: 'computer-use-control-plane-selection',
    type: COMPUTER_USE_CONTROL_PLANE_ARTIFACT_TYPE,
    producerScenario: 'computer-use',
    schemaVersion: COMPUTER_USE_CONTROL_PLANE_SCHEMA_VERSION,
    data: {
      schemaVersion: COMPUTER_USE_CONTROL_PLANE_SCHEMA_VERSION,
      sessionRef: 'computer-use-session:selection',
      sessionPermissionRef: 'computer-use:permission/selection.json',
      allowedAppRefs: ['computer-use:allowlist/apps/browser.json'],
      allowedWindowRefs: ['computer-use:allowlist/windows/current.json'],
      riskPreviewRef: 'computer-use:risk/selection.json',
      dataVisibilityRef: 'computer-use:data-visibility/selection.json',
    },
  },
};
