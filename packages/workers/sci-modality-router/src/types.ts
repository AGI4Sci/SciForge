// Stable ServiceResult result envelope (see this worker's README "API" section).
// The service returns structured evidence only — never a user-level final answer.

export interface Provenance {
  serviceId: string;
  operation: string;
  requestId: string;
  startedAt?: string;
  completedAt?: string;
  inputHash?: string;
}

export type ServiceErrorCode =
  | 'INVALID_ARGUMENT'
  | 'UNAUTHENTICATED'
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'UNAVAILABLE'
  | 'INTERNAL_ERROR';

export interface ServiceError {
  code: ServiceErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export type ServiceResult<T = unknown> =
  | { ok: true; summary?: string; data: T; provenance?: Provenance; warnings?: string[] }
  | { ok: false; error: ServiceError; provenance?: Provenance; warnings?: string[] };

// --- modality_translate operation -------------------------------------------

/**
 * The scientific modalities this router translates. Each maps to one expert that is a real
 * domain model whose **native output is text** (no general-LLM interpreters). The main agent
 * (DeepSeek V4) is text-only, so these non-text inputs must be turned into natural-language
 * evidence before the agent can "see" them. Model names reflect what is actually deployed
 * (see provider/server.py and provider/experts/*).
 */
export type Modality =
  | 'protein' // amino-acid sequence (FASTA) -> Esm2Text-Base (ESM-2 + GPT, sequence-only)
  | 'protein_structure' // protein 3D structure (PDB/mmCIF) -> Prot2Text-Large (ESM-2 + RGCN + GPT-2)
  | 'molecule' // SMILES / small molecule -> BioT5+ (T5 SELFIES->caption)
  | 'single_cell'; // scRNA-seq expression / marker genes -> C2S-Scale (Cell2Sentence, Gemma-2)

export const MODALITIES: readonly Modality[] = ['protein', 'protein_structure', 'molecule', 'single_cell'] as const;

export interface ModalityTranslateRequest {
  /** The raw scientific payload as text (FASTA, SMILES, expression matrix, peak list, …). */
  payload: string;
  /**
   * Which expert to use. Omit to let the service auto-detect from the payload.
   * Detection is best-effort; an explicit modality always wins.
   */
  modality?: Modality;
  /** Optional user context so the translator knows what matters. NOT a task to solve. */
  instruction?: string;
  /** Opaque id echoed back into provenance/descriptor (e.g. the upload object id). */
  objectId?: string;
  requestId?: string;
}

/** The natural-language translation of one scientific input. */
export interface ModalityTranslation {
  /** Concise natural-language description composed from real model outputs. */
  summary: string;
  /** Which modality was translated (echoes the resolved modality). */
  modality: Modality;
  /** Which expert model produced the evidence (e.g. `prott3-protein`). */
  model: string;
  /** Whether the modality was auto-detected (`detected`) or caller-supplied (`explicit`). */
  modalitySource: 'explicit' | 'detected';
}
