import type { ScenarioPackageRef } from './app';

export type ExecutionUnitStatus =
  | 'planned'
  | 'running'
  | 'done'
  | 'failed'
  | 'record-only'
  | 'repair-needed'
  | 'self-healed'
  | 'failed-with-reason'
  | 'needs-human';

export interface RuntimeExecutionUnit {
  id: string;
  tool: string;
  params: string;
  status: ExecutionUnitStatus;
  hash: string;
  runId?: string;
  sourceRunId?: string;
  producerRunId?: string;
  agentServerRunId?: string;
  code?: string;
  language?: string;
  codeRef?: string;
  entrypoint?: string;
  stdoutRef?: string;
  stderrRef?: string;
  outputRef?: string;
  attempt?: number;
  parentAttempt?: number;
  selfHealReason?: string;
  patchSummary?: string;
  diffRef?: string;
  failureReason?: string;
  seed?: number;
  time?: string;
  environment?: string;
  inputData?: string[];
  dataFingerprint?: string;
  databaseVersions?: string[];
  artifacts?: string[];
  outputArtifacts?: string[];
  scenarioPackageRef?: ScenarioPackageRef;
  skillPlanRef?: string;
  uiPlanRef?: string;
  runtimeProfileId?: string;
  routeDecision?: {
    selectedSkill?: string;
    selectedRuntime?: string;
    fallbackReason?: string;
    selectedAt: string;
  };
  requiredInputs?: string[];
  recoverActions?: string[];
  nextStep?: string;
  verificationRef?: string;
  verificationVerdict?: 'pass' | 'fail' | 'uncertain' | 'needs-human' | 'unverified';
}
