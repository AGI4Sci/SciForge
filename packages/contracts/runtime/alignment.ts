export const ALIGNMENT_CONTRACT_ARTIFACT_TYPE = 'alignment-contract' as const;
export const ALIGNMENT_CONTRACT_VERSION_ARTIFACT_TYPE = 'alignment-contract-version' as const;
export const ALIGNMENT_CONTRACT_SCHEMA_VERSION = '1' as const;

export type AlignmentContractArtifactType = typeof ALIGNMENT_CONTRACT_ARTIFACT_TYPE;
export type AlignmentContractVersionArtifactType = typeof ALIGNMENT_CONTRACT_VERSION_ARTIFACT_TYPE;
export type AlignmentContractSchemaVersion = typeof ALIGNMENT_CONTRACT_SCHEMA_VERSION;
export type AlignmentContractConfirmationStatus = 'draft' | 'user-confirmed' | 'needs-data';

export interface AlignmentContractData {
  dataReality: string;
  aiAssessment: string;
  bioReality: string;
  feasibilityMatrix: string;
  researchGoal: string;
  technicalRoute: string;
  successCriteria: string;
  knownRisks: string;
  recalibrationRecord: string;
  dataAssetsChecklist: string;
  sampleSizeChecklist: string;
  labelQualityChecklist: string;
  batchEffectChecklist: string;
  experimentalConstraints: string;
  feasibilitySourceNotes: string;
}

export interface AlignmentContractRecord {
  id: string;
  type: AlignmentContractArtifactType;
  schemaVersion: AlignmentContractSchemaVersion;
  title: string;
  createdAt: string;
  updatedAt: string;
  reason: string;
  checksum: string;
  sourceRefs: string[];
  assumptionRefs: string[];
  decisionAuthority: string;
  confirmationStatus: AlignmentContractConfirmationStatus;
  confirmedBy?: string;
  confirmedAt?: string;
  sourceContractVersion?: string;
  data: AlignmentContractData;
}

export interface AlignmentContractVersionRecord {
  id: string;
  type: AlignmentContractVersionArtifactType;
  createdAt?: string;
  reason?: string;
  checksum?: string;
  artifactId?: string;
}
