export const TOOL_PAYLOAD_SHAPE_CONTRACT_ID = 'sciforge.tool-payload-shape.v1' as const;
export const TOOL_PAYLOAD_ARRAY_FIELDS = ['claims', 'uiManifest', 'executionUnits', 'artifacts'] as const;

export interface ToolPayloadShapeContract {
  contractId: typeof TOOL_PAYLOAD_SHAPE_CONTRACT_ID;
  arrayFields: typeof TOOL_PAYLOAD_ARRAY_FIELDS;
  uiManifestShape: {
    type: 'array';
    slot: {
      componentId: 'string';
      artifactRef: 'string?';
      title: 'string?';
      priority: 'number?';
    };
    forbiddenShape: string;
    contentRule: string;
  };
}

export function toolPayloadShapeContract(): ToolPayloadShapeContract {
  return {
    contractId: TOOL_PAYLOAD_SHAPE_CONTRACT_ID,
    arrayFields: TOOL_PAYLOAD_ARRAY_FIELDS,
    uiManifestShape: {
      type: 'array',
      slot: { componentId: 'string', artifactRef: 'string?', title: 'string?', priority: 'number?' },
      forbiddenShape: 'object descriptor with preferredView/views/items',
      contentRule: 'put rows, markdown, provider traces, and layout/content data in artifacts, not uiManifest',
    },
  };
}

export function toolPayloadShapeContractSummary() {
  const contract = toolPayloadShapeContract();
  return {
    contractId: contract.contractId,
    arrayFields: [...contract.arrayFields],
    uiManifest: `${contract.uiManifestShape.type} of component slots; each slot is { componentId, artifactRef?, title?, priority? }; never an object containing preferredView/views/items`,
    contentRule: contract.uiManifestShape.contentRule,
  };
}
