import type {
  ResearchProviderDiagnostic,
  ResearchSearchProvider,
  ResearchSearchProviderResult,
  ResearchSearchRequest
} from '../types.js';

/** Runs the configured/keyed provider first and only spends a public fallback
 * request when the primary is unavailable or yields no usable web results. */
export class FallbackWebResearchProvider implements ResearchSearchProvider {
  readonly id = 'tavily' as const;

  constructor(
    private readonly primary: ResearchSearchProvider,
    private readonly fallback: ResearchSearchProvider
  ) {}

  async search(request: ResearchSearchRequest): Promise<ResearchSearchProviderResult> {
    const deadline = Date.now() + request.timeoutMs;
    let primaryResult: ResearchSearchProviderResult;
    try {
      primaryResult = await this.primary.search({
        ...request,
        timeoutMs: Math.max(1, Math.floor(request.timeoutMs * 0.6))
      });
    } catch {
      primaryResult = {
        papers: [],
        webResults: [],
        diagnostics: [{
          id: this.primary.id,
          enabled: true,
          available: false,
          role: 'primary',
          reason: 'Primary provider request failed; keyless fallback was used'
        }]
      };
    }
    const primaryDiagnostics = withRole(primaryResult.diagnostics, 'primary');
    if (primaryResult.webResults.length > 0) {
      return {
        ...primaryResult,
        diagnostics: primaryDiagnostics
      };
    }

    const fallbackResult = await this.fallback.search({
      ...request,
      timeoutMs: remainingTimeout(deadline)
    });
    return {
      papers: [...primaryResult.papers, ...fallbackResult.papers],
      webResults: fallbackResult.webResults,
      diagnostics: [
        ...markPrimaryFallbackReason(primaryDiagnostics),
        ...withRole(fallbackResult.diagnostics, 'fallback')
      ]
    };
  }
}

function remainingTimeout(deadline: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return 1;
  return remaining;
}

function withRole(
  diagnostics: ResearchProviderDiagnostic[] | undefined,
  role: 'primary' | 'fallback'
): ResearchProviderDiagnostic[] {
  return (diagnostics ?? []).map((diagnostic) => ({ ...diagnostic, role }));
}

function markPrimaryFallbackReason(
  diagnostics: ResearchProviderDiagnostic[]
): ResearchProviderDiagnostic[] {
  return diagnostics.map((diagnostic) => diagnostic.reason
    ? diagnostic
    : { ...diagnostic, reason: 'Primary provider returned no results; keyless fallback was used' });
}
