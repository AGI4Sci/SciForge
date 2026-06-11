// Template-conformant result envelope (see ../../Servic_Module_Template.md).
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

// --- vision_translate operation ---------------------------------------------

/** One image to translate. Exactly one of `url` / `base64` must be present. */
export interface VisionImageInput {
  /** Direct URL or `data:image/...;base64,...` URL, forwarded as-is to the model. */
  url?: string;
  /** Raw base64 (no data: prefix); combined with `mime` into a data URL. */
  base64?: string;
  /** MIME type for `base64`, e.g. `image/png`. Defaults to `image/png`. */
  mime?: string;
}

export interface VisionTranslateRequest {
  /** Optional user context so the translator knows what matters. NOT a task to solve. */
  instruction?: string;
  image: VisionImageInput;
  /** Opaque id echoed back into provenance/descriptor (e.g. the upload object id). */
  objectId?: string;
  requestId?: string;
}

/** The natural-language translation of the visual input. */
export interface VisionTranslation {
  /** Concise natural-language description of the image. */
  summary: string;
  /** Optional discrete observations (visible text, fields, layout, uncertainty). */
  observations?: string[];
  model: string;
}
