---
name: full_protein_analysis
description: "Full Protein Analysis - Comprehensive protein sequence and structure analysis including functional annotation, domain identification, post-translational modification prediction, and variant impact assessment. Use this skill for complete protein characterization combining multiple bioinformatics tools."
metadata:
  scpToolId: "full_protein_analysis"
  scpCategory: "life_science"
  scpHubUrl: "https://scphub.intern-ai.org.cn/skill/full_protein_analysis"
  categoryLabel: "生命科学"
  tags: ["生命科学", "蛋白质分析", "功能注释", "结构预测"]
---

# Full Protein Analysis

## Usage

### 1. MCP Server Definition

```python
import json
from mcp.client.streamable_http import streamablehttp_client
from mcp import ClientSession

class ProteinAnalysisClient:
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

### 2. Full Protein Analysis Workflow

**Workflow Steps:**

1. **Sequence Input** - Provide UniProt ID or amino acid sequence
2. **Property Calculation** - Calculate physicochemical properties
3. **Domain Analysis** - Identify protein domains and motifs
4. **Variant Assessment** - Evaluate clinical and functional impacts
5. **Structure Prediction** - Generate 3D structure predictions

**Implementation:**

```python
# Connect to Protein Analysis server
client = ProteinAnalysisClient("https://scp.intern-ai.org.cn/api/v1/mcp/17/BioInfo-Tools")
if not await client.connect():
    print("Connection failed")
    exit()

# Full protein analysis request
analysis_data = {
    "query": "P53_HUMAN",  # UniProt ID or sequence
    "analysis_types": [
        "properties",
        "domains",
        "ptms",
        "variants",
        "structure"
    ],
    "organism": "homo_sapiens"
}

result = await client.session.call_tool(
    "analyze_protein_full",
    arguments=analysis_data
)
data = client.parse_result(result)

print(f"Full Protein Analysis: {json.dumps(data, indent=2, ensure_ascii=False)}")

await client.disconnect()
```

### Tool Descriptions

**BioInfo-Tools Server:**
- `analyze_protein_full`: Comprehensive protein analysis
  - Args:
    - `query` (str): UniProt ID or amino acid sequence
    - `analysis_types` (list): List of analysis modules to run
    - `organism` (str): Source organism (optional)
  - Returns:
    - Complete protein characterization report

- `predict_structure`: Predict protein 3D structure
  - Args:
    - `sequence` (str): Amino acid sequence
    - `method` (str): Prediction method (AlphaFold, ESMFold, etc.)
  - Returns:
    - 3D structure coordinates and confidence scores

- `identify_domains`: Identify functional domains
  - Args:
    - `sequence` (str): Protein sequence
    - `database` (str): Domain database (Pfam, CDD, InterPro)
  - Returns:
    - Domain annotations with start/end positions

- `predict_ptms`: Predict post-translational modifications
  - Args:
    - `sequence` (str): Protein sequence
    - `modification_types` (list): PTM types to predict
  - Returns:
    - Predicted modification sites with confidence

### Input/Output

**Input:**
- UniProt ID or amino acid sequence
- Organism specification
- Selected analysis modules

**Output:**
- Physicochemical properties
- Domain and motif annotations
- PTM site predictions
- Variant impact scores
- 3D structure predictions

### Use Cases

- Characterize novel proteins from genomic data
- Identify functional domains and active sites
- Predict disease-causing variants
- Support drug target identification
- Generate structural models for docking

### Performance Notes

- **Execution time**: 120-600 seconds depending on analysis depth
- **Timeout recommendation**: Set to at least 900 seconds (15 minutes)
- **Recommended input**: Valid UniProt ID or 50+ AA sequence

### Web Portal Access

Access this tool via SCP Hub: https://scphub.intern-ai.org.cn/skill/full_protein_analysis

Direct API endpoint: `https://scp.intern-ai.org.cn/api/v1/mcp/17/BioInfo-Tools`
