---
name: biomarker_discovery
description: "Biomarker Discovery - Identify and validate diagnostic, prognostic, and predictive biomarkers from omics data. Use this skill for biomarker tasks involving gene expression differential analysis pathway enrichment disease signature discovery. Combines multiple tools from SCP servers for multi-omics biomarker identification."
metadata:
  scpToolId: "110"
  scpCategory: "life_science"
  scpHubUrl: "https://scphub.intern-ai.org.cn/skill/biomarker_discovery"
  categoryLabel: "生命科学"
  tags: ["生命科学", "生物标志物", "精准医疗"]
---

# Biomarker Discovery

## Usage

### 1. MCP Server Definition

```python
import json
from mcp.client.streamable_http import streamablehttp_client
from mcp import ClientSession

class BiomarkerClient:    
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

### 2. Biomarker Discovery Workflow

**Workflow Steps:**

1. **Differential Expression Analysis** - Identify differentially expressed genes/proteins
2. **Pathway Enrichment** - Map biomarkers to biological pathways
3. **Biomarker Validation** - Cross-reference with known disease signatures
4. **Clinical Relevance** - Assess diagnostic/prognostic potential

**Implementation:**

```python
# Connect to Biomarker Discovery server
client = BiomarkerClient("https://scp.intern-ai.org.cn/api/v1/mcp/17/BioInfo-Tools")
if not await client.connect():
    print("Connection failed")
    exit()

# Discover biomarkers from gene expression data
expression_data = {
    "case_samples": [...],  # Disease/case samples
    "control_samples": [...],  # Healthy/control samples
    "gene_ids": ["BRCA1", "TP53", "EGFR", "HER2"]
}

result = await client.session.call_tool(
    "discover_biomarkers",
    arguments=expression_data
)
data = client.parse_result(result)

print(f"Biomarker Discovery Results: {json.dumps(data, indent=2, ensure_ascii=False)}")

await client.disconnect()
```

### Tool Descriptions

**BioInfo-Tools Server:**
- `discover_biomarkers`: Identify potential biomarkers from expression data
  - Args:
    - `case_samples` (list): Disease/case sample expression values
    - `control_samples` (list): Control sample expression values
    - `gene_ids` (list): Gene/protein identifiers
  - Returns:
    - Differentially expressed genes with fold change and p-values

- `validate_biomarker`: Validate biomarker candidates against databases
  - Args:
    - `biomarker_list` (list): List of biomarker candidates
    - `disease_context` (str): Disease type for validation
  - Returns:
    - Validated biomarkers with supporting evidence

- `pathway_enrichment`: Perform pathway enrichment for biomarkers
  - Args:
    - `gene_list` (list): List of biomarker genes
    - `database` (str): Pathway database (KEGG, Reactome, GO)
  - Returns:
    - Enriched pathways with statistical significance

### Input/Output

**Input:**
- Gene/protein expression data (case vs control)
- Biomarker candidates or gene lists
- Disease context for validation

**Output:**
- Differentially expressed biomarkers
- Pathway enrichment results
- Validation status and clinical relevance scores

### Use Cases

- Identify diagnostic biomarkers for early disease detection
- Discover prognostic biomarkers for patient stratification
- Find predictive biomarkers for treatment response
- Map biomarker signatures to biological pathways

### Performance Notes

- **Execution time**: 60-300 seconds depending on dataset size
- **Timeout recommendation**: Set to at least 600 seconds (10 minutes)
- **Recommended input**: 3+ samples per group for reliable results

### Web Portal Access

Access this tool via SCP Hub: https://scphub.intern-ai.org.cn/skill/biomarker_discovery

Direct API endpoint: `https://scp.intern-ai.org.cn/api/v1/mcp/17/BioInfo-Tools`