export const MAIN_CHAT_IMAGE_UNDERSTANDING_LIVE_MATRIX_SCHEMA_VERSION =
  'sciforge.model-router.main-chat-image-understanding-live-matrix.cases.v1' as const;

export const requiredMainChatImageUnderstandingCategories = [
  'scientific-chart',
  'microscopy-experimental-image',
  'ui-screenshot',
  'dense-annotated-image',
] as const;

export type MainChatImageUnderstandingCategory =
  typeof requiredMainChatImageUnderstandingCategories[number];

export type MainChatImageUnderstandingLiveMatrixCase = {
  id: string;
  category: MainChatImageUnderstandingCategory;
  title: string;
  material: {
    ref: string;
    sha256: `sha256:${string}`;
    width: number;
    height: number;
    sourceKind: 'fixed-release-material';
    licenseNote: string;
  };
  prompts: string[];
  evidenceRequirements: string[];
  answerRubric: {
    minAnswerTextLength: number;
    requiredConcepts: Array<{
      id: string;
      anyOf: string[];
    }>;
  };
};

const materialRoot = 'docs/test-artifacts/main-chat-image-understanding-live-matrix/materials';

export const mainChatImageUnderstandingLiveMatrixCases: MainChatImageUnderstandingLiveMatrixCase[] = [
  {
    id: 'scientific-chart-legend-axis',
    category: 'scientific-chart',
    title: 'Scientific chart with legend and axes',
    material: {
      ref: `${materialRoot}/scientific-chart-legend-axis.png`,
      sha256: 'sha256:8b89f07ad423d142f70eddbfbb6e49420d66dfaf08bd3d6f4c259bb45f6f3879',
      width: 1280,
      height: 800,
      sourceKind: 'fixed-release-material',
      licenseNote: 'Release material must be a checked refs-first image file or documented permissive fixture.',
    },
    prompts: [
      'Quote the exact visible text for the chart title, x/y axis labels, and legend labels, then compare the two main groups and mention uncertainty or error bar markers if present.',
    ],
    evidenceRequirements: [
      'answer-text-digest',
      'model-router-trace-ref',
      'trace-audit-pass',
      'no-inline-image-bytes',
    ],
    answerRubric: {
      minAnswerTextLength: 96,
      requiredConcepts: [
        { id: 'chart-title', anyOf: ['response by condition'] },
        { id: 'axis-labels', anyOf: ['timepoint', 'mean signal'] },
        { id: 'legend-groups', anyOf: ['control', 'treated'] },
        { id: 'uncertainty-markers', anyOf: ['uncertainty', 'error bar', 'error bars', 'markers'] },
      ],
    },
  },
  {
    id: 'microscopy-experimental-contrast',
    category: 'microscopy-experimental-image',
    title: 'Microscopy or experimental image with visible sample contrast',
    material: {
      ref: `${materialRoot}/microscopy-experimental-contrast.png`,
      sha256: 'sha256:edf5459968270109ffd64e5bcaf5b93074e021ae17b7a793279b405be5b09398',
      width: 1280,
      height: 800,
      sourceKind: 'fixed-release-material',
      licenseNote: 'Release material must be a checked refs-first image file or documented permissive fixture.',
    },
    prompts: [
      'Quote exact visible text labels when legible, then describe the visible sample regions, annotations, and any apparent control-versus-treated contrast differences without inventing measurements.',
    ],
    evidenceRequirements: [
      'answer-text-digest',
      'model-router-trace-ref',
      'trace-audit-pass',
      'no-inline-image-bytes',
    ],
    answerRubric: {
      minAnswerTextLength: 96,
      requiredConcepts: [
        { id: 'sample-groups', anyOf: ['control', 'treated'] },
        { id: 'visible-regions', anyOf: ['sample region', 'sample regions', 'regions', 'panel'] },
        { id: 'annotations', anyOf: ['annotation', 'annotations', 'bright puncta'] },
        { id: 'contrast-difference', anyOf: ['contrast', 'difference', 'shift'] },
      ],
    },
  },
  {
    id: 'ui-screenshot-state',
    category: 'ui-screenshot',
    title: 'UI screenshot with buttons, menus, and status text',
    material: {
      ref: `${materialRoot}/ui-screenshot-state.png`,
      sha256: 'sha256:caf50c7f6707620a87d5e1ebc7b1abcb0a6279c2e302863dd8996e1f0a9db5b8',
      width: 1440,
      height: 900,
      sourceKind: 'fixed-release-material',
      licenseNote: 'Release material must be a checked refs-first image file or documented permissive fixture.',
    },
    prompts: [
      'Quote exact visible text for the main UI state, active controls, references or ref/status labels, and any status or error text that a user would need to act on.',
    ],
    evidenceRequirements: [
      'answer-text-digest',
      'model-router-trace-ref',
      'trace-audit-pass',
      'no-inline-image-bytes',
    ],
    answerRubric: {
      minAnswerTextLength: 96,
      requiredConcepts: [
        { id: 'visible-state', anyOf: ['active run', 'running', 'status'] },
        { id: 'main-surface', anyOf: ['chat', 'workbench'] },
        { id: 'controls', anyOf: ['plan', 'debug', 'multitask', 'image', 'models'] },
        { id: 'references', anyOf: ['references', 'ref'] },
      ],
    },
  },
  {
    id: 'dense-annotated-small-text',
    category: 'dense-annotated-image',
    title: 'Dense annotated image with small text, legend, and local labels',
    material: {
      ref: `${materialRoot}/dense-annotated-small-text.png`,
      sha256: 'sha256:0d77825520bd51e460af0249f27a15e02f7c36196abe1058b895ff9571be5d0a',
      width: 1600,
      height: 1000,
      sourceKind: 'fixed-release-material',
      licenseNote: 'Release material must be a checked refs-first image file or documented permissive fixture.',
    },
    prompts: [
      'Quote exact visible text for the dense map title, axis labels, legend/classes, and local annotations; summarize only labels that are legible and call out uncertainty for small text.',
    ],
    evidenceRequirements: [
      'answer-text-digest',
      'model-router-trace-ref',
      'trace-audit-pass',
      'no-inline-image-bytes',
    ],
    answerRubric: {
      minAnswerTextLength: 96,
      requiredConcepts: [
        { id: 'dense-map-title', anyOf: ['dense annotated field map'] },
        { id: 'legend', anyOf: ['legend', 'class'] },
        { id: 'axis-labels', anyOf: ['axis x', 'axis y', 'region index', 'signal locality'] },
        { id: 'small-text-uncertainty', anyOf: ['small text', 'confidence', 'mixed', 'uncertain'] },
      ],
    },
  },
];
