import type { ObjectAction, ObjectReference, RuntimeArtifact, SciForgeConfig, SciForgeSession } from '../domain';
import {
  artifactForObjectReference,
  pathForObjectReference,
} from '../../../../packages/support/object-references';
import { createLocalUserActionApi, type UserActionApi } from './projectionApi';
import { createOpenCommandTextUIAction, type CommandTextUIAction, type SelectObjectUIAction } from './uiActionBoundary';
import type { ResultPaneTab } from './results/ResultShell';
import { focusResultPaneRouteForObjectReference } from './results/resultPaneContract';

type WorkspaceOpenObjectAction = Extract<ObjectAction, 'open-external' | 'reveal-in-folder'>;

export type ObjectReferenceActionPlan =
  | {
    kind: 'focus-right-pane';
    reference: ObjectReference;
    activeRunId?: string;
    notice: string;
  }
  | {
    kind: 'inspect';
    artifact?: RuntimeArtifact;
    error?: string;
  }
  | {
    kind: 'pin';
    reference: ObjectReference;
    pinnedObjectReferences: ObjectReference[];
    notice: string;
  }
  | {
    kind: 'copy-path';
    path?: string;
    notice?: string;
    error?: string;
  }
  | {
    kind: 'open-workspace-object';
    action: WorkspaceOpenObjectAction;
    path?: string;
    notice?: string;
    error?: string;
  };

export type ObjectReferenceActionResult = {
  activeRunId?: string;
  commandTextAction?: CommandTextUIAction;
  error?: string;
  focusReference?: ObjectReference;
  inspectedArtifact?: RuntimeArtifact;
  notice?: string;
  pinnedObjectReferences?: ObjectReference[];
  resultTab?: ResultPaneTab;
  sourceAction?: SelectObjectUIAction;
};

export type PerformObjectReferenceActionOptions = {
  action: ObjectAction;
  config: SciForgeConfig;
  pinnedObjectReferences: ObjectReference[];
  reference: ObjectReference;
  session: SciForgeSession;
  userActionApi?: Pick<UserActionApi, 'selectObject'>;
  writeClipboard?: (text: string) => Promise<void>;
};

export function resolveObjectReferenceActionPlan({
  action,
  pinnedObjectReferences,
  reference,
  session,
}: Pick<PerformObjectReferenceActionOptions, 'action' | 'pinnedObjectReferences' | 'reference' | 'session'>): ObjectReferenceActionPlan {
  if (action === 'focus-right-pane') {
    return {
      kind: 'focus-right-pane',
      reference,
      activeRunId: reference.runId,
      notice: '已聚焦到右侧结果。',
    };
  }
  if (action === 'inspect') {
    const artifact = artifactForObjectReference(reference, session);
    return artifact
      ? { kind: 'inspect', artifact }
      : { kind: 'inspect', error: `无法解析 artifact：${reference.ref}` };
  }
  if (action === 'pin' || action === 'compare') {
    return {
      kind: 'pin',
      reference,
      pinnedObjectReferences: nextPinnedObjectReferences(pinnedObjectReferences, reference),
      notice: action === 'compare' ? '已加入对比/固定列表。' : '已固定到结果区。',
    };
  }
  if (action === 'copy-path') {
    const path = pathForObjectReference(reference, session);
    return path
      ? { kind: 'copy-path', path, notice: `已复制路径：${path}` }
      : { kind: 'copy-path', error: `没有可复制路径：${reference.title}` };
  }
  const path = pathForObjectReference(reference, session);
  return path
    ? {
      kind: 'open-workspace-object',
      action,
      path,
      notice: action === 'reveal-in-folder' ? '已请求在文件夹中显示。' : '已请求系统打开文件。',
    }
    : { kind: 'open-workspace-object', action, error: `没有可打开路径：${reference.title}` };
}

export function nextPinnedObjectReferences(current: ObjectReference[], reference: ObjectReference): ObjectReference[];
export function nextPinnedObjectReferences(current: ObjectReference[], reference: ObjectReference): ObjectReference[] {
  return current.some((item) => item.id === reference.id)
    ? current.filter((item) => item.id !== reference.id)
    : [...current, reference].slice(-4);
}

export async function performObjectReferenceAction({
  action,
  pinnedObjectReferences,
  reference,
  session,
  userActionApi = createLocalUserActionApi(),
  writeClipboard = writeClipboardText,
}: PerformObjectReferenceActionOptions): Promise<ObjectReferenceActionResult> {
  const plan = resolveObjectReferenceActionPlan({ action, pinnedObjectReferences, reference, session });
  const sourceAction = await selectedObjectActionForReference({ action, reference, session, userActionApi });
  if (plan.kind === 'focus-right-pane') {
    return {
      activeRunId: plan.activeRunId,
      focusReference: plan.reference,
      notice: plan.notice,
      resultTab: resultTabForObjectReference(plan.reference),
      sourceAction,
    };
  }
  if (plan.kind === 'inspect') return plan.artifact ? { inspectedArtifact: plan.artifact, sourceAction } : { error: plan.error, sourceAction };
  if (plan.kind === 'pin') {
    return {
      focusReference: plan.reference,
      notice: plan.notice,
      pinnedObjectReferences: plan.pinnedObjectReferences,
      resultTab: resultTabForObjectReference(plan.reference),
      sourceAction,
    };
  }
  if (plan.kind === 'copy-path') {
    if (!plan.path) return { error: plan.error };
    try {
      await writeClipboard(plan.path);
      return { notice: plan.notice };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }
  if (!plan.path) return { error: plan.error };
  const commandTextAction = createOpenCommandTextUIAction({
    session,
    id: actionId('command-open'),
    createdAt: new Date().toISOString(),
    pathOrRef: plan.path,
    reveal: plan.action === 'reveal-in-folder',
    label: plan.notice,
  });
  return {
    commandTextAction,
    notice: `${plan.notice} 已生成命令：${commandTextAction.commandText}`,
  };
}

export function resultTabForObjectReference(reference: ObjectReference): ResultPaneTab {
  return focusResultPaneRouteForObjectReference(reference).pane;
}

async function selectedObjectActionForReference({
  action,
  reference,
  session,
  userActionApi,
}: {
  action: ObjectAction;
  reference: ObjectReference;
  session: SciForgeSession;
  userActionApi: Pick<UserActionApi, 'selectObject'>;
}): Promise<SelectObjectUIAction | undefined> {
  const intent = selectObjectIntentForObjectAction(action);
  if (!intent) return undefined;
  const result = await userActionApi.selectObject({
    session,
    objectRef: reference.ref,
    intent,
  });
  return result.action?.type === 'select-object' ? result.action : undefined;
}

function selectObjectIntentForObjectAction(action: ObjectAction): SelectObjectUIAction['intent'] | undefined {
  if (action === 'focus-right-pane' || action === 'inspect') return 'inspect';
  if (action === 'compare') return 'compare';
  if (action === 'pin') return 'pin';
  return undefined;
}

export function objectActionLabel(action: ObjectAction) {
  if (action === 'focus-right-pane') return '聚焦';
  if (action === 'inspect') return '检查数据';
  if (action === 'open-external') return '系统打开';
  if (action === 'reveal-in-folder') return '打开文件夹';
  if (action === 'copy-path') return '复制路径';
  if (action === 'compare') return '对比';
  return 'Pin';
}

async function writeClipboardText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    if (!document.execCommand('copy')) throw new Error('浏览器拒绝复制路径，请手动复制。');
  } finally {
    document.body.removeChild(textarea);
  }
}

function actionId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}
