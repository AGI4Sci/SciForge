import { isRecord } from '../gateway-utils.js';
import { normalizeGenericActionRisk } from './actions.js';
import type { GenericVisionAction } from './types.js';

export function packagePlanToGenericAction(
  plan: Record<string, unknown>,
  activeAction?: GenericVisionAction,
  grounding?: Record<string, unknown>,
): GenericVisionAction {
  const type = (stringAt(plan, 'kind') ?? stringAt(plan, 'type') ?? activeAction?.type ?? 'wait') as GenericVisionAction['type'];
  const target = recordAt(plan, 'target');
  const targetDescription = stringAt(target, 'description') ?? stringAt(plan, 'targetDescription') ?? activeAction?.targetDescription;
  const targetRegionDescription = stringAt(target, 'region_description') ?? stringAt(target, 'targetRegionDescription') ?? activeAction?.targetRegionDescription;
  const riskLevel = parseRiskLevel(stringAt(plan, 'risk_level') ?? stringAt(plan, 'riskLevel') ?? activeAction?.riskLevel);
  const base = {
    targetDescription,
    targetRegionDescription,
    riskLevel,
    requiresConfirmation: Boolean(plan.requires_confirmation ?? plan.requiresConfirmation ?? activeAction?.requiresConfirmation),
    confirmationText: stringAt(plan, 'confirmationText') ?? activeAction?.confirmationText,
  };
  const groundingMetadata = recordAt(grounding, 'metadata');
  const x = numberAt(grounding?.x)
    ?? numberAt(groundingMetadata?.executorX)
    ?? (activeAction && 'x' in activeAction ? numberAt(activeAction.x) : undefined);
  const y = numberAt(grounding?.y)
    ?? numberAt(groundingMetadata?.executorY)
    ?? (activeAction && 'y' in activeAction ? numberAt(activeAction.y) : undefined);
  if (type === 'click') return normalizeGenericActionRisk({ ...base, type: 'click', x, y });
  if (type === 'double_click') return normalizeGenericActionRisk({ ...base, type: 'double_click', x, y });
  if (type === 'drag') {
    const fromX = numberAt(grounding?.x)
      ?? numberAt(groundingMetadata?.executorFromX)
      ?? numberAt(groundingMetadata?.localFromX)
      ?? (activeAction && 'fromX' in activeAction ? numberAt(activeAction.fromX) : undefined);
    const fromY = numberAt(grounding?.y)
      ?? numberAt(groundingMetadata?.executorFromY)
      ?? numberAt(groundingMetadata?.localFromY)
      ?? (activeAction && 'fromY' in activeAction ? numberAt(activeAction.fromY) : undefined);
    const toX = numberAt(groundingMetadata?.executorToX)
      ?? numberAt(groundingMetadata?.localToX)
      ?? (activeAction && 'toX' in activeAction ? numberAt(activeAction.toX) : undefined);
    const toY = numberAt(groundingMetadata?.executorToY)
      ?? numberAt(groundingMetadata?.localToY)
      ?? (activeAction && 'toY' in activeAction ? numberAt(activeAction.toY) : undefined);
    return normalizeGenericActionRisk({
      ...base,
      type,
      fromX,
      fromY,
      toX,
      toY,
      fromTargetDescription: activeAction && 'fromTargetDescription' in activeAction ? activeAction.fromTargetDescription : undefined,
      toTargetDescription: activeAction && 'toTargetDescription' in activeAction ? activeAction.toTargetDescription : undefined,
    });
  }
  if (type === 'type_text') return normalizeGenericActionRisk({ ...base, type, text: stringAt(plan, 'text') ?? (activeAction && 'text' in activeAction ? activeAction.text : '') });
  if (type === 'press_key') return normalizeGenericActionRisk({ ...base, type, key: stringAt(plan, 'key') ?? (activeAction && 'key' in activeAction ? activeAction.key : '') });
  if (type === 'hotkey') return normalizeGenericActionRisk({ ...base, type, keys: stringList(plan.keys).length ? stringList(plan.keys) : activeAction && 'keys' in activeAction ? activeAction.keys : [] });
  if (type === 'scroll') return normalizeGenericActionRisk({ ...base, type, direction: scrollDirection(stringAt(plan, 'direction') ?? (activeAction && 'direction' in activeAction ? activeAction.direction : 'down')), amount: numberAt(plan.amount) });
  if (type === 'open_app') return normalizeGenericActionRisk({ ...base, type, appName: stringAt(plan, 'appName') ?? stringAt(plan, 'app_name') ?? (activeAction && 'appName' in activeAction ? activeAction.appName : '') });
  return normalizeGenericActionRisk({ ...base, type: 'wait', ms: activeAction && 'ms' in activeAction ? activeAction.ms : 500 });
}

function recordAt(value: unknown, key: string) {
  if (!isRecord(value)) return undefined;
  const item = value[key];
  return isRecord(item) ? item : undefined;
}

function stringAt(value: unknown, key: string) {
  if (!isRecord(value)) return undefined;
  const item = value[key];
  return typeof item === 'string' && item.trim() ? item : undefined;
}

function numberAt(value: unknown) {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) ? numeric : undefined;
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function scrollDirection(value: string | undefined): 'up' | 'down' | 'left' | 'right' {
  return value === 'up' || value === 'left' || value === 'right' ? value : 'down';
}

function parseRiskLevel(value: string | undefined): 'low' | 'medium' | 'high' | undefined {
  return value === 'low' || value === 'medium' || value === 'high' ? value : undefined;
}
