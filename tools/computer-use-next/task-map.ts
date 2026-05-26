import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ComputerUseLongTaskPool } from '../computer-use-long-task-pool/internal.js';
import { loadComputerUseLongTaskPool } from '../computer-use-long-task-pool/internal.js';
import defaultTaskMap from './task-map.json';

export const CU_NEXT_TASK_MAP_SCHEMA_VERSION = 'sciforge.computer-use.cu-next-task-map.v1' as const;
export const DEFAULT_CU_NEXT_TASK_MAP_PATH = resolve(dirname(fileURLToPath(import.meta.url)), 'task-map.json');

export type CuNextTaskId = string;

export type CuNextRequirement =
  | 'l2-artifact-refs'
  | 'l3-workflow-refs'
  | 'approval-chain'
  | 'repair-continuity'
  | 'dense-grounding'
  | 'no-dom-playwright-accessibility';

export interface CuNextTaskMapping {
  taskId: CuNextTaskId;
  title: string;
  slug: string;
  priority: number;
  primaryScenarioId: string;
  longScenarioIds: string[];
  requirements: CuNextRequirement[];
  recommendedTargetMode: 'active-window' | 'app-window' | 'window-id' | 'display';
  recommendedTargetApp?: string;
  recommendedMaxSteps: number;
}

export interface CuNextTaskMap {
  schemaVersion: typeof CU_NEXT_TASK_MAP_SCHEMA_VERSION;
  tasks: CuNextTaskMapping[];
}

export const DEFAULT_CU_NEXT_TASK_MAP = defaultTaskMap as CuNextTaskMap;
export const CU_NEXT_TASK_MAPPINGS = DEFAULT_CU_NEXT_TASK_MAP.tasks;

const CU_NEXT_TASK_ID_PATTERN = /^CU-NEXT-\d{2,}$/;

const validRequirements = new Set<CuNextRequirement>([
  'l2-artifact-refs',
  'l3-workflow-refs',
  'approval-chain',
  'repair-continuity',
  'dense-grounding',
  'no-dom-playwright-accessibility',
]);

const validTargetModes = new Set<CuNextTaskMapping['recommendedTargetMode']>([
  'active-window',
  'app-window',
  'window-id',
  'display',
]);

export async function loadCuNextTaskMap(path = DEFAULT_CU_NEXT_TASK_MAP_PATH): Promise<CuNextTaskMap> {
  return JSON.parse(await readFile(path, 'utf8')) as CuNextTaskMap;
}

export async function loadValidatedCuNextTaskMap(path?: string): Promise<CuNextTaskMap> {
  const [map, longPool] = await Promise.all([
    loadCuNextTaskMap(path),
    loadComputerUseLongTaskPool(),
  ]);
  const issues = validateCuNextTaskMap(map, longPool);
  if (issues.length) {
    throw new Error(`Invalid CU-NEXT task map:\n${issues.join('\n')}`);
  }
  return map;
}

export function validateCuNextTaskMap(map: CuNextTaskMap, longPool: ComputerUseLongTaskPool): string[] {
  const issues: string[] = [];
  if (map.schemaVersion !== CU_NEXT_TASK_MAP_SCHEMA_VERSION) {
    issues.push(`schemaVersion must be ${CU_NEXT_TASK_MAP_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(map.tasks)) {
    issues.push('tasks must be an array');
    return issues;
  }
  const longScenarioIds = new Set(longPool.scenarios.map((scenario) => scenario.id));
  const seen = new Set<string>();
  if (map.tasks.length === 0) issues.push('tasks must include at least one CU-NEXT task');

  for (const task of map.tasks) {
    if (!isCuNextTaskId(task.taskId)) issues.push(`${task.taskId}: taskId must match ${CU_NEXT_TASK_ID_PATTERN}`);
    if (seen.has(task.taskId)) issues.push(`${task.taskId}: duplicate taskId`);
    seen.add(task.taskId);
    if (!task.title?.trim()) issues.push(`${task.taskId}: title is required`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(task.slug || '')) issues.push(`${task.taskId}: slug must be kebab-case`);
    if (!Number.isInteger(task.priority) || task.priority < 1) issues.push(`${task.taskId}: priority must be a positive integer`);
    if (!task.longScenarioIds.includes(task.primaryScenarioId)) {
      issues.push(`${task.taskId}: primaryScenarioId must be included in longScenarioIds`);
    }
    if (!task.longScenarioIds.length) issues.push(`${task.taskId}: longScenarioIds is required`);
    for (const scenarioId of task.longScenarioIds) {
      if (!/^CU-LONG-\d{3}$/.test(scenarioId)) issues.push(`${task.taskId}: invalid scenario id ${scenarioId}`);
      if (!longScenarioIds.has(scenarioId)) issues.push(`${task.taskId}: unknown scenario id ${scenarioId}`);
    }
    if (!task.requirements.includes('no-dom-playwright-accessibility')) {
      issues.push(`${task.taskId}: must require no-dom-playwright-accessibility`);
    }
    for (const requirement of task.requirements) {
      if (!validRequirements.has(requirement)) issues.push(`${task.taskId}: unknown requirement ${requirement}`);
    }
    if (!validTargetModes.has(task.recommendedTargetMode)) {
      issues.push(`${task.taskId}: invalid recommendedTargetMode ${task.recommendedTargetMode}`);
    }
    if (!Number.isInteger(task.recommendedMaxSteps) || task.recommendedMaxSteps < 1) {
      issues.push(`${task.taskId}: recommendedMaxSteps must be a positive integer`);
    }
  }

  return issues;
}

export function getCuNextTaskMapping(map: CuNextTaskMap, taskId: CuNextTaskId): CuNextTaskMapping {
  const mapping = map.tasks.find((task) => task.taskId === taskId);
  if (!mapping) throw new Error(`Unknown CU-NEXT task: ${taskId}`);
  return mapping;
}

export function scenarioIdsForCuNextTask(
  mapping: CuNextTaskMapping,
  mode: 'primary' | 'all' = 'primary',
): string[] {
  return mode === 'all' ? mapping.longScenarioIds : [mapping.primaryScenarioId];
}

export function isCuNextTaskId(value: string): value is CuNextTaskId {
  return CU_NEXT_TASK_ID_PATTERN.test(value);
}
