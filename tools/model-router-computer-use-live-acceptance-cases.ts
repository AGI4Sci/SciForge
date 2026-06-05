export const MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_CASES_SCHEMA_VERSION =
  'sciforge.model-router.computer-use-live-acceptance-cases.v1' as const;

export const requiredModelRouterComputerUseLiveAcceptanceCategories = [
  'browser-research',
  'docs-sheets-edit',
  'file-management',
  'ide-terminal',
  'cross-window-recovery-verifier',
] as const;

export type ModelRouterComputerUseLiveAcceptanceCategory =
  typeof requiredModelRouterComputerUseLiveAcceptanceCategories[number];

export type ModelRouterComputerUseLiveAcceptanceEvidenceKind =
  | 'screenshot'
  | 'file'
  | 'artifact'
  | 'terminal'
  | 'verifier';

export type ModelRouterComputerUseLiveAcceptanceCase = {
  id: ModelRouterComputerUseLiveAcceptanceCategory;
  category: ModelRouterComputerUseLiveAcceptanceCategory;
  title: string;
  taskShape: string;
  requiredCapabilityIds: string[];
  requiredEvidenceKinds: ModelRouterComputerUseLiveAcceptanceEvidenceKind[];
  allowedExecutorKinds: readonly ['desktop-native-host', 'native-host', 'app-window'];
};

const modelRouterComputerUseCoreCapabilityIds = [
  'model-router.capability.computer-use.planner',
  'model-router.capability.computer-use.screenshot-translator',
  'model-router.capability.computer-use.grounding-translator',
  'model-router.capability.computer-use.verifier-translator',
] as const;

export const modelRouterComputerUseLiveAcceptanceCases: ModelRouterComputerUseLiveAcceptanceCase[] = [
  {
    id: 'browser-research',
    category: 'browser-research',
    title: 'Browser research through generic Computer Use',
    taskShape: 'Use a browser window to research a current scientific topic and produce a bounded evidence artifact.',
    requiredCapabilityIds: [...modelRouterComputerUseCoreCapabilityIds],
    requiredEvidenceKinds: ['screenshot', 'artifact', 'verifier'],
    allowedExecutorKinds: ['desktop-native-host', 'native-host', 'app-window'],
  },
  {
    id: 'docs-sheets-edit',
    category: 'docs-sheets-edit',
    title: 'Document and spreadsheet editing through generic Computer Use',
    taskShape: 'Edit document and spreadsheet files via visible app windows and preserve current-run file/artifact refs.',
    requiredCapabilityIds: [...modelRouterComputerUseCoreCapabilityIds],
    requiredEvidenceKinds: ['screenshot', 'file', 'artifact', 'verifier'],
    allowedExecutorKinds: ['desktop-native-host', 'native-host', 'app-window'],
  },
  {
    id: 'file-management',
    category: 'file-management',
    title: 'File management through generic Computer Use',
    taskShape: 'Use the platform file manager to organize files and record before/after file refs plus verifier evidence.',
    requiredCapabilityIds: [...modelRouterComputerUseCoreCapabilityIds],
    requiredEvidenceKinds: ['screenshot', 'file', 'verifier'],
    allowedExecutorKinds: ['desktop-native-host', 'native-host', 'app-window'],
  },
  {
    id: 'ide-terminal',
    category: 'ide-terminal',
    title: 'IDE and terminal workflow through generic Computer Use',
    taskShape: 'Operate an editor and terminal window with generic GUI actions and preserve terminal/file/verifier refs.',
    requiredCapabilityIds: [...modelRouterComputerUseCoreCapabilityIds],
    requiredEvidenceKinds: ['screenshot', 'file', 'terminal', 'verifier'],
    allowedExecutorKinds: ['desktop-native-host', 'native-host', 'app-window'],
  },
  {
    id: 'cross-window-recovery-verifier',
    category: 'cross-window-recovery-verifier',
    title: 'Cross-window recovery with verifier recheck',
    taskShape: 'Recover from an interrupted multi-window workflow and prove completion with verifier recheck refs.',
    requiredCapabilityIds: [...modelRouterComputerUseCoreCapabilityIds],
    requiredEvidenceKinds: ['screenshot', 'artifact', 'terminal', 'verifier'],
    allowedExecutorKinds: ['desktop-native-host', 'native-host', 'app-window'],
  },
];
