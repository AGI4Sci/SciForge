export const visionSenseSafetyVerifierContract = {
  senseBoundary: 'text-signal-only',
  actionOwner: 'packages/actions/computer-use or packages/actions/computer-use',
  highRiskPolicy: 'reject-unless-explicitly-confirmed-upstream',
  verifierRefs: ['vision-trace', 'before-after-screenshot-refs', 'window-consistency', 'pixel-diff'],
} as const;
