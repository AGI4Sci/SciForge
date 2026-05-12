import type { ScenarioId } from '../data';
import type { ObjectReference, SciForgeRun, SciForgeSession, UIManifestSlot, ViewPlanSection } from '../domain';
import type { ResultFocusMode } from './results/ResultShell';
import {
  filterHiddenResultSlots,
  itemsForFocusMode,
  resolveViewPlan,
  selectDefaultResultItems,
  viewPlanSectionLabel,
  type ResolvedViewPlanItem,
  type RuntimeResolvedViewPlan,
} from './results/viewPlanResolver';
import { runPresentationState, shouldOpenRunAuditDetails, type RunPresentationState } from './results-renderer-execution-model';

const deferredSectionOrder: ViewPlanSection[] = ['supporting', 'provenance', 'raw', 'primary'];

export type ResultsRendererEmptyStateModel = {
  title: string;
  detail: string;
  dismissedAllInFilter: boolean;
};

export type ResultsRendererSectionModel = {
  section: ViewPlanSection;
  title: string;
  items: ResolvedViewPlanItem[];
};

export type ResultsRendererManifestDiagnostic = {
  id: string;
  moduleId: string;
  artifactType?: string;
  reason?: string;
  title: string;
};

export type ResultsRendererViewModel = {
  viewPlan: RuntimeResolvedViewPlan;
  primaryTitle: string;
  visibleItems: ResolvedViewPlanItem[];
  deferredItems: ResolvedViewPlanItem[];
  deferredSections: ResultsRendererSectionModel[];
  emptyState?: ResultsRendererEmptyStateModel;
  auditOpen: boolean;
  manifestDiagnostics: ResultsRendererManifestDiagnostic[];
};

export function createResultsRendererViewModel({
  scenarioId,
  session,
  defaultSlots,
  activeRun,
  focusedObjectReference,
  pinnedObjectReferences = [],
  focusMode,
}: {
  scenarioId: ScenarioId;
  session: SciForgeSession;
  defaultSlots?: UIManifestSlot[];
  activeRun?: SciForgeRun;
  focusedObjectReference?: ObjectReference;
  pinnedObjectReferences?: ObjectReference[];
  focusMode: ResultFocusMode;
}): ResultsRendererViewModel {
  const viewPlan = resolveViewPlan({
    scenarioId,
    session,
    defaultSlots,
    activeRun,
    focusedObjectReference,
    pinnedObjectReferences,
  });
  return projectResultsRendererViewModel({ session, activeRun, viewPlan, focusMode });
}

export function projectResultsRendererViewModel({
  session,
  activeRun,
  viewPlan,
  focusMode,
}: {
  session: SciForgeSession;
  activeRun?: SciForgeRun;
  viewPlan: RuntimeResolvedViewPlan;
  focusMode: ResultFocusMode;
}): ResultsRendererViewModel {
  const slotLimit = focusMode === 'visual' || focusMode === 'all' ? 8 : 4;
  const focusModeItems = itemsForFocusMode(viewPlan, focusMode);
  const visibleAfterDismiss = filterHiddenResultSlots(focusModeItems, session);
  const planItems = visibleAfterDismiss.slice(0, slotLimit);
  const dismissedAllInFilter = focusModeItems.length > 0 && visibleAfterDismiss.length === 0;
  const { visibleItems, deferredItems } = selectDefaultResultItems(planItems, focusMode);
  const presentationState = runPresentationState(session, activeRun, viewPlan);
  return {
    viewPlan,
    primaryTitle: primaryResultSectionTitle(focusMode),
    visibleItems,
    deferredItems,
    deferredSections: projectDeferredSections(deferredItems),
    emptyState: planItems.length ? undefined : emptyResultsState(focusMode, dismissedAllInFilter, presentationState),
    auditOpen: shouldOpenRunAuditDetails(session, activeRun),
    manifestDiagnostics: projectManifestDiagnostics(viewPlan.allItems),
  };
}

export function primaryResultSectionTitle(focusMode: ResultFocusMode) {
  if (focusMode === 'execution') return '执行记录';
  if (focusMode === 'evidence') return '证据重点';
  return '核心结果';
}

export function emptyResultsState(focusMode: ResultFocusMode, dismissedAllInFilter: boolean, presentationState?: RunPresentationState): ResultsRendererEmptyStateModel {
  if (dismissedAllInFilter) {
    return {
      title: '当前筛选下的视图已全部从界面移除',
      detail: '这是仅影响呈现的隐藏列表，artifact 与工作区文件未被删除。新开聊天会清空该列表。',
      dismissedAllInFilter,
    };
  }
  if (focusMode === 'all') {
    if (presentationState && presentationState.kind !== 'ready') {
      return {
        title: presentationState.title,
        detail: [
          presentationState.reason,
          presentationState.nextSteps.length ? `下一步：${presentationState.nextSteps[0]}` : undefined,
        ].filter(Boolean).join(' '),
        dismissedAllInFilter,
      };
    }
    return {
      title: '还没有可展示的关键结果',
      detail: '发送请求后，这里只展示真实产物、当前 run 结果和被点选/引用的对象；空的系统模块会默认隐藏。',
      dismissedAllInFilter,
    };
  }
  return {
    title: '当前筛选没有匹配内容',
    detail: '切回“全部”，或运行一个会生成对应 artifact 的任务。',
    dismissedAllInFilter,
  };
}

export function projectDeferredSections(items: ResolvedViewPlanItem[]): ResultsRendererSectionModel[] {
  return deferredSectionOrder
    .map((section) => ({
      section,
      title: viewPlanSectionLabel(section),
      items: items.filter((item) => item.section === section),
    }))
    .filter((section) => section.items.length > 0);
}

export function projectManifestDiagnostics(items: ResolvedViewPlanItem[]): ResultsRendererManifestDiagnostic[] {
  return items.map((item) => ({
    id: item.id,
    moduleId: item.module.moduleId,
    artifactType: item.artifact?.type,
    reason: item.reason ?? item.module.description,
    title: item.slot.title ?? item.module.title,
  }));
}

export { selectDefaultResultItems, viewPlanSectionLabel };
export type { ResolvedViewPlanItem, RuntimeResolvedViewPlan };
