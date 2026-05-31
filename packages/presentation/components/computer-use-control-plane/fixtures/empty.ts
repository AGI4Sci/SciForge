import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';
import {
  COMPUTER_USE_CONTROL_PLANE_ARTIFACT_TYPE,
  COMPUTER_USE_CONTROL_PLANE_COMPONENT_ID,
  COMPUTER_USE_CONTROL_PLANE_SCHEMA_VERSION,
} from '../contract';

export const emptyComputerUseControlPlaneFixture: UIComponentRendererProps = {
  slot: {
    componentId: COMPUTER_USE_CONTROL_PLANE_COMPONENT_ID,
    title: 'Computer Use controls',
  },
  artifact: {
    id: 'computer-use-control-plane-empty',
    type: COMPUTER_USE_CONTROL_PLANE_ARTIFACT_TYPE,
    producerScenario: 'computer-use',
    schemaVersion: COMPUTER_USE_CONTROL_PLANE_SCHEMA_VERSION,
    data: {},
  },
};
