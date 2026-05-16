import {
  resultPresentationFromPayload,
  validateResultPresentationContract,
  type ResultPresentationContract,
} from '@sciforge-ui/runtime-contract/result-presentation';
import type { ToolPayload } from '../runtime-types.js';
import { isRecord, toRecordList } from '../gateway-utils.js';
import {
  attachTaskOutcomeProjection,
  type GatewayTaskOutcomeProjectionContext,
} from './task-outcome-projection.js';

export { validateResultPresentationContract };
export type { ResultPresentationContract };

export interface ResultPresentationMaterializerInput {
  payload?: unknown;
  request?: unknown;
  harness?: unknown;
  objectReferences?: Array<Record<string, unknown>>;
  fallbackTitle?: string;
}

export function materializeResultPresentationContract(input: ToolPayload | ResultPresentationMaterializerInput): ResultPresentationContract {
  const record = isRecord(input) ? input : {};
  const payload = isRecord(record.payload) ? record.payload : record;
  const request = isRecord(record.request) ? record.request : {};
  return resultPresentationFromPayload({
    payload,
    objectReferences: toRecordList(record.objectReferences),
    fallbackTitle: stringField(record.fallbackTitle) ?? stringField(request.prompt) ?? 'Result completed.',
  });
}

export function attachResultPresentationContract(
  payload: ToolPayload,
  context: GatewayTaskOutcomeProjectionContext = {},
): ToolPayload {
  const displayIntent = isRecord(payload.displayIntent) ? payload.displayIntent : {};
  const existing = displayIntent.resultPresentation;
  const projectionContext = {
    ...context,
    forceRecomputeProjection: context.forceRecomputeProjection ?? Boolean(context.request),
  };
  if (validateResultPresentationContract(existing).ok) {
    return withProjectionAwareResultPresentation(attachTaskOutcomeProjection({
      ...payload,
      displayIntent,
    }, projectionContext));
  }

  const payloadWithPresentation = {
    ...payload,
    displayIntent: {
      ...displayIntent,
      resultPresentation: materializeResultPresentationContract({ payload }),
    },
  };
  const payloadWithOutcome = attachTaskOutcomeProjection(payloadWithPresentation, projectionContext);
  const outcomeDisplayIntent = isRecord(payloadWithOutcome.displayIntent) ? payloadWithOutcome.displayIntent : {};
  const resultPresentation = isRecord(outcomeDisplayIntent.resultPresentation) ? outcomeDisplayIntent.resultPresentation : undefined;
  const taskRunCard = isRecord(outcomeDisplayIntent.taskRunCard) ? outcomeDisplayIntent.taskRunCard : undefined;
  return withProjectionAwareResultPresentation({
    ...payloadWithOutcome,
    displayIntent: {
      ...outcomeDisplayIntent,
      resultPresentation: resultPresentation
        ? {
          ...resultPresentation,
          conversationProjectionSummary: taskRunCard?.conversationProjectionSummary ?? resultPresentation.conversationProjectionSummary,
        }
        : outcomeDisplayIntent.resultPresentation,
    },
  });
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function withProjectionAwareResultPresentation(payload: ToolPayload): ToolPayload {
  const displayIntent = isRecord(payload.displayIntent) ? payload.displayIntent : {};
  const resultPresentation = isRecord(displayIntent.resultPresentation) ? displayIntent.resultPresentation : undefined;
  const taskRunCard = isRecord(displayIntent.taskRunCard) ? displayIntent.taskRunCard : undefined;
  if (!resultPresentation || !taskRunCard || taskRunCard.taskOutcome === 'satisfied') return payload;
  if (resultPresentation.status !== 'complete') return payload;
  const answerBlocks = Array.isArray(resultPresentation.answerBlocks)
    ? resultPresentation.answerBlocks.filter(isRecord)
    : [];
  const originalAnswerText = answerBlocks
    .map((block) => stringField(block.text))
    .filter((text): text is string => Boolean(text))
    .join('\n\n');
  const nextStep = stringField(taskRunCard.nextStep);
  return {
    ...payload,
    displayIntent: {
      ...displayIntent,
      resultPresentation: {
        ...resultPresentation,
        status: resultPresentation.status === 'complete' ? 'partial' : resultPresentation.status,
        answerBlocks: [
          {
            id: 'answer-needs-work',
            kind: 'paragraph',
            text: [
              'Partial result artifacts are available, but the user goal is not fully satisfied yet.',
              nextStep ? `Next step: ${nextStep}` : undefined,
            ].filter(Boolean).join('\n\n'),
          },
          ...(originalAnswerText
            ? [{
                id: 'answer-draft-summary',
                kind: 'paragraph',
                text: `Draft result summary: ${originalAnswerText}`,
              }]
            : []),
          ...answerBlocks.filter((block) => stringField(block.id) !== 'answer-summary'),
        ],
      },
    },
  };
}
