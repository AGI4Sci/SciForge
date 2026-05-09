export type BuiltInScenarioId =
  | 'literature-evidence-review'
  | 'structure-exploration'
  | 'omics-differential-exploration'
  | 'biomedical-knowledge-graph';

export type ScenarioInstanceId = BuiltInScenarioId | (string & {});

export interface ScenarioPackageRef {
  id: string;
  version: string;
  source: 'built-in' | 'workspace' | 'generated';
}
