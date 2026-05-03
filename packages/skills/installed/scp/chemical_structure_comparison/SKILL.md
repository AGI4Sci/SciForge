---
name: chemical_structure_comparison
description: "Chemical Structure Comparison - Compare molecular structures using SMILES, molecular fingerprints, and structural similarity metrics. Use this skill for molecular similarity analysis, scaffold comparison, R-group analysis, and structure-activity relationship studies. Combines PubChem data with similarity algorithms."
metadata:
  scpToolId: "chemical_structure_comparison"
  scpCategory: "chemistry"
  scpHubUrl: "https://scphub.intern-ai.org.cn/skill/chemical_structure_comparison"
  categoryLabel: "化学"
  tags: ["化学", "分子结构", "结构相似性", "药物化学"]
---

# Chemical Structure Comparison

## Usage

### 1. MCP Server Definition

```python
import json
from mcp.client.streamable_http import streamablehttp_client
from mcp import ClientSession

class ChemicalComparisonClient:
    def __init__(self, server_url: str):
        self.server_url = server_url
        self.session = None
        
    async def connect(self):
        try:
            self.transport = streamablehttp_client(
                url=self.server_url,
                headers={"SCP-HUB-API-KEY": "<YOUR_SCP_HUB_API_KEY>"}
            )
            self.read, self.write, self.get_session_id = await self.transport.__aenter__()
            self.session_ctx = ClientSession(self.read, self.write)
            self.session = await self.session_ctx.__aenter__()
            await self.session.initialize()
            return True
        except Exception as e:
            print(f"Connection failed: {e}")
            return False
    
    async def disconnect(self):
        if self.session:
            await self.session_ctx.__aexit__(None, None, None)
        if hasattr(self, 'transport'):
            await self.transport.__aexit__(None, None, None)
    
    def parse_result(self, result):
        try:
            if hasattr(result, 'content') and result.content:
                content = result.content[0]
                if hasattr(content, 'text'):
                    return json.loads(content.text)
            return str(result)
        except:
            return str(result)
```

### 2. Chemical Structure Comparison Workflow

**Workflow Steps:**

1. **Structure Input** - Provide SMILES strings or molecule identifiers
2. **Fingerprint Generation** - Generate molecular fingerprints (ECFP, MACCS, etc.)
3. **Similarity Calculation** - Compute Tanimoto/Jaccard similarity
4. **Result Analysis** - Interpret similarity scores and structural relationships

**Implementation:**

```python
# Connect to PubChem/Structure Comparison server
client = ChemicalComparisonClient("https://scp.intern-ai.org.cn/api/v1/mcp/8/Origene-PubChem")
if not await client.connect():
    print("Connection failed")
    exit()

# Compare two molecular structures
comparison_data = {
    "smiles_1": "CC(=O)OC1=CC=CC=C1C(=O)O",  # Aspirin
    "smiles_2": "CC(=O)OC1=CC=CC=C1C(=O)O",  # Reference structure
    "fingerprint_type": "ECFP4",
    "similarity_metric": "tanimoto"
}

result = await client.session.call_tool(
    "compare_structures",
    arguments=comparison_data
)
data = client.parse_result(result)

print(f"Structure Comparison Results: {json.dumps(data, indent=2, ensure_ascii=False)}")

await client.disconnect()
```

### Tool Descriptions

**Origene-PubChem Server:**
- `compare_structures`: Compare two molecular structures by SMILES
  - Args:
    - `smiles_1` (str): First molecule SMILES string
    - `smiles_2` (str): Second molecule SMILES string
    - `fingerprint_type` (str): Fingerprint type (ECFP4, MACCS, etc.)
    - `similarity_metric` (str): Similarity metric (tanimoto, dice, etc.)
  - Returns:
    - Similarity score and structural relationship analysis

- `get_similar_compounds`: Find similar compounds from PubChem
  - Args:
    - `smiles` (str): Query molecule SMILES
    - `similarity_threshold` (float): Minimum similarity (0-1)
    - `max_results` (int): Maximum number of results
  - Returns:
    - List of similar compounds with scores and PubChem IDs

- `substructure_match`: Check substructure relationships
  - Args:
    - `parent_smiles` (str): Parent/core structure SMILES
    - `sub_smiles` (str): Substructure SMILES to match
  - Returns:
    - Boolean match result and alignment positions

### Input/Output

**Input:**
- SMILES strings or molecule identifiers
- Fingerprint type selection
- Similarity threshold parameters

**Output:**
- Similarity scores (Tanimoto, Dice, etc.)
- Structural alignment information
- Similar compound lists from databases

### Use Cases

- Compare molecular similarity for lead optimization
- Identify scaffold hop candidates
- Perform R-group analysis for SAR studies
- Find similar active compounds in databases

### Performance Notes

- **Execution time**: 5-30 seconds depending on database size
- **Timeout recommendation**: Set to at least 120 seconds
- **Recommended similarity threshold**: 0.7-0.9 for focused results

### Web Portal Access

Access this tool via SCP Hub: https://scphub.intern-ai.org.cn/skill/chemical_structure_comparison

Direct API endpoint: `https://scp.intern-ai.org.cn/api/v1/mcp/8/Origene-PubChem`
