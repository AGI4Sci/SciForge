import type { UIComponentManifest } from '@sciforge-ui/runtime-contract';
import {
  COMPUTER_USE_CONTROL_PLANE_ARTIFACT_TYPE,
  COMPUTER_USE_CONTROL_PLANE_COMPONENT_ID,
  COMPUTER_USE_CONTROL_PLANE_SCHEMA_VERSION,
} from './contract';

export const manifest: UIComponentManifest = {
  packageName: '@sciforge-ui/computer-use-control-plane',
  moduleId: 'computer-use-control-plane-panel',
  version: '1.0.0',
  title: 'Computer Use control plane',
  description: 'Presentation-only Computer Use session permission, allowlist, risk, data visibility, stop/cancel, and confirmation status surface.',
  componentId: COMPUTER_USE_CONTROL_PLANE_COMPONENT_ID,
  lifecycle: 'published',
  outputArtifactTypes: [COMPUTER_USE_CONTROL_PLANE_ARTIFACT_TYPE],
  acceptsArtifactTypes: [
    COMPUTER_USE_CONTROL_PLANE_ARTIFACT_TYPE,
    'computer-use-user-control-plane',
    'computer-use-session-control',
    'computer-use-replay-control',
  ],
  consumes: [
    {
      kinds: ['table'],
      mediaTypes: [
        'application/json',
        'application/vnd.sciforge.computer-use-control-plane+json',
      ],
      extensions: ['json'],
      previewPolicies: ['inline'],
    },
  ],
  viewParams: [
    'sessionPermissionRef',
    'allowedAppRefs',
    'allowedWindowRefs',
    'forbiddenAppRefs',
    'riskPreviewRef',
    'dataVisibilityRef',
    'stopRef',
    'cancelLeaseRef',
    'approvalMode',
    'status',
  ],
  interactionEvents: [
    'computer-use-terminal-equivalent-text',
    'computer-use-confirmation-result',
  ],
  roleDefaults: ['runtime-operator', 'desktop-operator'],
  fallbackModuleIds: ['generic-artifact-inspector'],
  defaultSection: 'primary',
  priority: 7,
  safety: { sandbox: false, externalResources: 'none', executesCode: false },
  presentation: {
    dedupeScope: 'entity',
    identityFields: ['sessionPermissionRef', 'stopRef', 'cancelLeaseRef', 'approvalRef', 'approvalRequestRef'],
  },
  docs: {
    readmePath: 'packages/presentation/components/computer-use-control-plane/README.md',
    agentSummary: 'Use only for displaying Computer Use user-control-plane refs and status. Buttons emit terminal-equivalent text or a confirmation result; GUI never executes Computer Use, never expands permission, and never accepts provider route, executor lease, scheduler, or desktop bridge params.',
  },
  workbenchDemo: {
    artifactType: COMPUTER_USE_CONTROL_PLANE_ARTIFACT_TYPE,
    schemaVersion: COMPUTER_USE_CONTROL_PLANE_SCHEMA_VERSION,
    artifactData: {
      schemaVersion: COMPUTER_USE_CONTROL_PLANE_SCHEMA_VERSION,
      sessionRef: 'computer-use-session:demo',
      sessionPermissionRef: 'computer-use:permission/demo-session.json',
      allowedAppRefs: ['computer-use:allowlist/apps/presentation.json'],
      allowedWindowRefs: ['computer-use:allowlist/windows/deck-editor.json'],
      forbiddenAppRefs: ['computer-use:allowlist/forbidden/messaging.json'],
      riskPreviewRef: 'computer-use:risk/demo-risk-preview.json',
      dataVisibilityRef: 'computer-use:data-visibility/demo.json',
      stopRef: 'computer-use:stop/demo',
      cancelLeaseRef: 'computer-use:lease/demo',
      approvalMode: 'required',
      status: 'needs-confirmation',
      approvalRef: 'approval:computer-use:demo',
      approvalRequestRef: 'computer-use:approval/demo-request.json',
      riskLevel: 'medium',
    },
  },
};
